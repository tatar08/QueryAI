use super::*;
use std::time::Duration;

#[test]
fn test_security_policy_origin_check() {
    let policy = SecurityPolicy::new(
        vec![
            "http://localhost:5173".to_string(),
            "https://app.tabularis.io".to_string(),
        ],
        true,
    );

    assert!(policy.is_origin_allowed("http://localhost:5173"));
    assert!(policy.is_origin_allowed("https://app.tabularis.io"));
    assert!(!policy.is_origin_allowed("http://attacker.com"));
    assert!(!policy.is_origin_allowed("https://evil.org"));
}

#[test]
fn test_rate_limiter_burst_and_exhaustion() {
    // 60 requests per minute = 1 per second. Burst = 3.
    let limiter = RateLimiter::new(60, 3);

    // Initial burst allowed: 3 tokens
    assert!(limiter.check("client1").is_ok());
    assert!(limiter.check("client1").is_ok());
    assert!(limiter.check("client1").is_ok());

    // 4th request must be rejected
    let res = limiter.check("client1");
    assert!(res.is_err());
    let wait_secs = res.unwrap_err();
    assert!(wait_secs >= 1);

    // Another client is unaffected
    assert!(limiter.check("client2").is_ok());
}

#[tokio::test]
async fn test_rate_limiter_token_replenishment() {
    // High refill: 120 per minute = 2 per second. Burst = 1.
    let limiter = RateLimiter::new(120, 1);

    assert!(limiter.check("client1").is_ok());
    assert!(limiter.check("client1").is_err());

    // Sleep for 600ms (should replenish ~1.2 tokens)
    tokio::time::sleep(Duration::from_millis(600)).await;
    assert!(limiter.check("client1").is_ok());
}
