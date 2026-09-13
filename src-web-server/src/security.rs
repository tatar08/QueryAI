use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use axum::extract::Request;
use axum::http::header::{
    HeaderName, HeaderValue, ACCESS_CONTROL_ALLOW_CREDENTIALS, ACCESS_CONTROL_ALLOW_HEADERS,
    ACCESS_CONTROL_ALLOW_METHODS, ACCESS_CONTROL_ALLOW_ORIGIN, ACCESS_CONTROL_MAX_AGE,
    CONTENT_SECURITY_POLICY, ORIGIN, REFERRER_POLICY, RETRY_AFTER, STRICT_TRANSPORT_SECURITY, VARY,
    X_CONTENT_TYPE_OPTIONS, X_FRAME_OPTIONS,
};
use axum::http::{Method, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

pub static PERMISSIONS_POLICY: HeaderName = HeaderName::from_static("permissions-policy");

#[derive(Clone, Debug)]
pub struct SecurityPolicy {
    pub allowed_origins: Vec<String>,
    pub enable_hsts: bool,
}

impl SecurityPolicy {
    pub fn new(allowed_origins: Vec<String>, enable_hsts: bool) -> Self {
        Self {
            allowed_origins,
            enable_hsts,
        }
    }

    pub fn is_origin_allowed(&self, origin: &str) -> bool {
        self.allowed_origins.iter().any(|allowed| allowed == origin)
    }
}

impl Default for SecurityPolicy {
    fn default() -> Self {
        Self {
            allowed_origins: vec!["http://localhost:5173".to_string()],
            enable_hsts: false,
        }
    }
}

#[derive(Clone, Debug)]
struct RateBucket {
    tokens: f64,
    last_updated: Instant,
}

#[derive(Clone, Debug)]
pub struct RateLimiter {
    per_minute: u32,
    burst: u32,
    buckets: Arc<Mutex<HashMap<String, RateBucket>>>,
}

impl RateLimiter {
    pub fn new(per_minute: u32, burst: u32) -> Self {
        Self {
            per_minute,
            burst,
            buckets: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn check(&self, key: &str) -> Result<(), u64> {
        let mut buckets = self.buckets.lock().unwrap_or_else(|p| p.into_inner());
        let now = Instant::now();
        let fill_rate = (self.per_minute as f64) / 60.0;
        let burst = self.burst as f64;

        if buckets.len() > 10_000 {
            buckets.retain(|_, b| now.duration_since(b.last_updated).as_secs() < 300);
        }

        let bucket = buckets
            .entry(key.to_string())
            .or_insert_with(|| RateBucket {
                tokens: burst,
                last_updated: now,
            });

        let elapsed = now.duration_since(bucket.last_updated).as_secs_f64();
        bucket.tokens = (bucket.tokens + elapsed * fill_rate).min(burst);
        bucket.last_updated = now;

        if bucket.tokens >= 1.0 {
            bucket.tokens -= 1.0;
            Ok(())
        } else {
            let missing = 1.0 - bucket.tokens;
            let wait_secs = (missing / fill_rate).ceil() as u64;
            Err(wait_secs.max(1))
        }
    }
}

impl Default for RateLimiter {
    fn default() -> Self {
        Self::new(120, 30)
    }
}

pub async fn security_headers_middleware(
    policy: SecurityPolicy,
    request: Request,
    next: Next,
) -> Response {
    let mut response = next.run(request).await;
    let headers = response.headers_mut();

    headers.insert(X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    headers.insert(X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    headers.insert(
        REFERRER_POLICY,
        HeaderValue::from_static("strict-origin-when-cross-origin"),
    );
    headers.insert(
        CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
        ),
    );
    headers.insert(
        PERMISSIONS_POLICY.clone(),
        HeaderValue::from_static("geolocation=(), camera=(), microphone=()"),
    );

    if policy.enable_hsts {
        headers.insert(
            STRICT_TRANSPORT_SECURITY,
            HeaderValue::from_static("max-age=31536000; includeSubDomains"),
        );
    }

    response
}

pub async fn cors_and_csrf_middleware(
    policy: SecurityPolicy,
    request: Request,
    next: Next,
) -> Response {
    let origin_header = request
        .headers()
        .get(ORIGIN)
        .and_then(|h| h.to_str().ok())
        .map(|s| s.to_string());

    let sec_fetch_site = request
        .headers()
        .get("sec-fetch-site")
        .and_then(|h| h.to_str().ok())
        .map(|s| s.to_string());

    // 1. Handle preflight OPTIONS
    if request.method() == Method::OPTIONS {
        if let Some(ref origin) = origin_header {
            if policy.is_origin_allowed(origin) {
                let mut response = StatusCode::NO_CONTENT.into_response();
                let headers = response.headers_mut();
                if let Ok(origin_val) = HeaderValue::from_str(origin) {
                    headers.insert(ACCESS_CONTROL_ALLOW_ORIGIN, origin_val);
                }
                headers.insert(
                    ACCESS_CONTROL_ALLOW_METHODS,
                    HeaderValue::from_static("GET, POST, PUT, PATCH, DELETE, OPTIONS"),
                );
                headers.insert(
                    ACCESS_CONTROL_ALLOW_HEADERS,
                    HeaderValue::from_static(
                        "content-type, cookie, authorization, x-requested-with, x-csrf-token",
                    ),
                );
                headers.insert(
                    ACCESS_CONTROL_ALLOW_CREDENTIALS,
                    HeaderValue::from_static("true"),
                );
                headers.insert(ACCESS_CONTROL_MAX_AGE, HeaderValue::from_static("86400"));
                headers.insert(VARY, HeaderValue::from_static("Origin"));
                return response;
            }
        }
        return StatusCode::FORBIDDEN.into_response();
    }

    // 2. Check CSRF on mutating requests
    let is_mutating = matches!(
        *request.method(),
        Method::POST | Method::PUT | Method::PATCH | Method::DELETE
    );

    if is_mutating {
        if let Some(ref site) = sec_fetch_site {
            if site == "cross-site" {
                return (
                    StatusCode::FORBIDDEN,
                    Json(json!({
                        "code": "CSRF_DETECTED",
                        "message": "Cross-site mutating requests are not allowed"
                    })),
                )
                    .into_response();
            }
        }

        if let Some(ref origin) = origin_header {
            if !policy.is_origin_allowed(origin) {
                return (
                    StatusCode::FORBIDDEN,
                    Json(json!({
                        "code": "CSRF_ORIGIN_REJECTED",
                        "message": "Origin not allowed for mutating request"
                    })),
                )
                    .into_response();
            }
        }
    }

    // 3. Forward request and apply CORS headers if allowed origin
    let mut response = next.run(request).await;
    if let Some(ref origin) = origin_header {
        if policy.is_origin_allowed(origin) {
            let headers = response.headers_mut();
            if let Ok(origin_val) = HeaderValue::from_str(origin) {
                headers.insert(ACCESS_CONTROL_ALLOW_ORIGIN, origin_val);
            }
            headers.insert(
                ACCESS_CONTROL_ALLOW_CREDENTIALS,
                HeaderValue::from_static("true"),
            );
            headers.insert(VARY, HeaderValue::from_static("Origin"));
        }
    }

    response
}

pub async fn rate_limit_middleware(
    rate_limiter: RateLimiter,
    request: Request,
    next: Next,
) -> Response {
    let path = request.uri().path();
    if path == "/health/live" || path == "/health/ready" {
        return next.run(request).await;
    }

    let client_ip = request
        .headers()
        .get("x-forwarded-for")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "default".to_string());

    match rate_limiter.check(&client_ip) {
        Ok(()) => next.run(request).await,
        Err(wait_secs) => {
            let mut response = (
                StatusCode::TOO_MANY_REQUESTS,
                Json(json!({
                    "code": "RATE_LIMIT_EXCEEDED",
                    "message": "Rate limit exceeded. Please try again later."
                })),
            )
                .into_response();
            if let Ok(val) = HeaderValue::from_str(&wait_secs.to_string()) {
                response.headers_mut().insert(RETRY_AFTER, val);
            }
            response
        }
    }
}

#[cfg(test)]
mod tests;
