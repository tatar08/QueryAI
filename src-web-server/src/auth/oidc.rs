use std::future::Future;
use std::pin::Pin;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use sha2::{Digest, Sha256};

use crate::config::OidcConfig;

pub const OIDC_FLOW_COOKIE_NAME: &str = "tabularis_oidc_flow";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OidcClaims {
    pub issuer: String,
    pub subject: String,
    pub email: Option<String>,
    pub display_name: Option<String>,
}

pub type OidcFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, String>> + Send + 'a>>;

pub trait OidcClient: Send + Sync {
    fn authorization_url(&self, state: &str, code_challenge: &str) -> String;
    fn exchange_code<'a>(
        &'a self,
        code: &'a str,
        code_verifier: &'a str,
    ) -> OidcFuture<'a, OidcClaims>;
}

pub fn generate_pkce_challenge(verifier: &str) -> String {
    let hash = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(hash)
}

#[derive(Clone)]
pub struct StandardOidcClient {
    config: OidcConfig,
    metadata: openidconnect::core::CoreProviderMetadata,
    redirect: openidconnect::RedirectUrl,
    http: reqwest::Client,
}

impl StandardOidcClient {
    pub async fn new(config: OidcConfig) -> Result<Self, String> {
        use openidconnect::{core::CoreProviderMetadata, IssuerUrl, RedirectUrl};
        let http = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .map_err(|e| e.to_string())?;
        let issuer = IssuerUrl::new(config.issuer_url.clone()).map_err(|e| e.to_string())?;
        let redirect = RedirectUrl::new(config.redirect_uri.clone()).map_err(|e| e.to_string())?;
        let metadata = CoreProviderMetadata::discover_async(issuer, &http)
            .await
            .map_err(|e| e.to_string())?;
        if metadata.token_endpoint().is_none() {
            return Err("OIDC provider has no token endpoint".into());
        }
        if config.issuer_url.starts_with("https://")
            && (metadata.authorization_endpoint().url().scheme() != "https"
                || metadata
                    .token_endpoint()
                    .is_some_and(|url| url.url().scheme() != "https")
                || metadata.jwks_uri().url().scheme() != "https")
        {
            return Err("OIDC endpoints must use HTTPS".into());
        }
        Ok(Self {
            config,
            metadata,
            redirect,
            http,
        })
    }
}

impl OidcClient for StandardOidcClient {
    fn authorization_url(&self, state: &str, code_challenge: &str) -> String {
        let mut url = self.metadata.authorization_endpoint().url().clone();
        url.query_pairs_mut().extend_pairs([
            ("response_type", "code"),
            ("client_id", self.config.client_id.as_str()),
            ("redirect_uri", self.config.redirect_uri.as_str()),
            ("scope", "openid profile email"),
            ("state", state),
            ("nonce", code_challenge),
            ("code_challenge", code_challenge),
            ("code_challenge_method", "S256"),
        ]);
        url.to_string()
    }

    fn exchange_code<'a>(
        &'a self,
        code: &'a str,
        code_verifier: &'a str,
    ) -> OidcFuture<'a, OidcClaims> {
        Box::pin(async move {
            use openidconnect::{
                core::CoreClient, AccessTokenHash, AuthorizationCode, ClientId, ClientSecret,
                Nonce, OAuth2TokenResponse, PkceCodeVerifier, TokenResponse,
            };
            let client = CoreClient::from_provider_metadata(
                self.metadata.clone(),
                ClientId::new(self.config.client_id.clone()),
                Some(ClientSecret::new(self.config.client_secret.clone())),
            )
            .set_redirect_uri(self.redirect.clone());
            let response = client
                .exchange_code(AuthorizationCode::new(code.to_owned()))
                .map_err(|e| e.to_string())?
                .set_pkce_verifier(PkceCodeVerifier::new(code_verifier.to_owned()))
                .request_async(&self.http)
                .await
                .map_err(|e| e.to_string())?;
            let token = response
                .id_token()
                .ok_or("OIDC provider omitted ID token")?;
            let verifier = client.id_token_verifier();
            let nonce = Nonce::new(generate_pkce_challenge(code_verifier));
            let claims = token.claims(&verifier, &nonce).map_err(|e| e.to_string())?;
            if let Some(expected) = claims.access_token_hash() {
                use openidconnect::{
                    core::{CoreHmacKey, CoreJwsSigningAlgorithm},
                    PrivateSigningKey,
                };
                let algorithm = token.signing_alg().map_err(|e| e.to_string())?;
                let symmetric_key;
                let key = if matches!(
                    algorithm,
                    CoreJwsSigningAlgorithm::HmacSha256
                        | CoreJwsSigningAlgorithm::HmacSha384
                        | CoreJwsSigningAlgorithm::HmacSha512
                ) {
                    symmetric_key = CoreHmacKey::new(self.config.client_secret.as_bytes())
                        .as_verification_key();
                    &symmetric_key
                } else {
                    token.signing_key(&verifier).map_err(|e| e.to_string())?
                };
                let actual = AccessTokenHash::from_token(response.access_token(), algorithm, key)
                    .map_err(|e| e.to_string())?;
                if actual != *expected {
                    return Err("OIDC access token hash mismatch".into());
                }
            }
            Ok(OidcClaims {
                issuer: claims.issuer().as_str().to_owned(),
                subject: claims.subject().as_str().to_owned(),
                email: claims
                    .email()
                    .filter(|_| claims.email_verified() == Some(true))
                    .map(|e| e.as_str().to_owned()),
                display_name: claims
                    .name()
                    .and_then(|n| n.get(None))
                    .map(|n| n.as_str().to_owned()),
            })
        })
    }
}

#[derive(Clone, Default)]
pub struct MockOidcClient {
    mock_claims: Option<OidcClaims>,
}

impl MockOidcClient {
    pub fn new(claims: OidcClaims) -> Self {
        Self {
            mock_claims: Some(claims),
        }
    }
}

impl OidcClient for MockOidcClient {
    fn authorization_url(&self, state: &str, code_challenge: &str) -> String {
        format!("https://idp.example.com/auth?state={state}&code_challenge={code_challenge}")
    }

    fn exchange_code<'a>(
        &'a self,
        code: &'a str,
        code_verifier: &'a str,
    ) -> OidcFuture<'a, OidcClaims> {
        Box::pin(async move {
            if code.is_empty() || code_verifier.is_empty() {
                return Err("Invalid code or verifier".to_string());
            }
            Ok(self.mock_claims.clone().unwrap_or(OidcClaims {
                issuer: "https://idp.example.com".to_string(),
                subject: format!("user-{code}"),
                email: Some(format!("user-{code}@example.com")),
                display_name: Some(format!("User {code}")),
            }))
        })
    }
}
