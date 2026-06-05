use oauth2::{
    basic::BasicClient, AuthUrl, ClientId, ClientSecret, RedirectUrl, TokenUrl,
    AuthorizationCode, CsrfToken, Scope, TokenResponse,
};
use oauth2::reqwest::async_http_client;
use serde::{Deserialize, Serialize};

use super::keychain;

/// OAuth provider type
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OAuthProvider {
    Gmail,
    Outlook,
}

/// OAuth authorization URL response
#[derive(Debug, Serialize, Deserialize)]
pub struct OAuthAuthUrlResponse {
    pub auth_url: String,
    pub csrf_state: String,
}

/// OAuth callback result — Phase F (email capability) will construct this.
#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize)]
pub struct OAuthCallbackResult {
    pub email: String,
    pub access_token: String,
    pub refresh_token: Option<String>,
}

/// Gmail OAuth 2.0 configuration
fn gmail_client(client_id: &str, client_secret: &str) -> Result<BasicClient, String> {
    BasicClient::new(
        ClientId::new(client_id.to_string()),
        Some(ClientSecret::new(client_secret.to_string())),
        AuthUrl::new("https://accounts.google.com/o/oauth2/v2/auth".to_string())
            .map_err(|e| format!("Invalid auth URL: {}", e))?,
        Some(
            TokenUrl::new("https://oauth2.googleapis.com/token".to_string())
                .map_err(|e| format!("Invalid token URL: {}", e))?,
        ),
    )
    .set_redirect_uri(
        RedirectUrl::new("http://localhost:7878/oauth/callback".to_string())
            .map_err(|e| format!("Invalid redirect URI: {}", e))?,
    )
    .into_ok()
}

/// Outlook OAuth 2.0 configuration
fn outlook_client(client_id: &str, tenant_id: &str) -> Result<BasicClient, String> {
    let auth_url = format!(
        "https://login.microsoftonline.com/{}/oauth2/v2.0/authorize",
        tenant_id
    );
    let token_url = format!(
        "https://login.microsoftonline.com/{}/oauth2/v2.0/token",
        tenant_id
    );

    BasicClient::new(
        ClientId::new(client_id.to_string()),
        None, // Public client
        AuthUrl::new(auth_url).map_err(|e| format!("Invalid auth URL: {}", e))?,
        Some(TokenUrl::new(token_url).map_err(|e| format!("Invalid token URL: {}", e))?),
    )
    .set_redirect_uri(
        RedirectUrl::new("http://localhost:7878/oauth/callback".to_string())
            .map_err(|e| format!("Invalid redirect URI: {}", e))?,
    )
    .into_ok()
}

/// Generate OAuth authorization URL
pub fn get_auth_url(
    provider: &OAuthProvider,
    client_id: &str,
    client_secret_or_tenant: &str,
) -> Result<OAuthAuthUrlResponse, String> {
    let client = match provider {
        OAuthProvider::Gmail => gmail_client(client_id, client_secret_or_tenant)?,
        OAuthProvider::Outlook => outlook_client(client_id, client_secret_or_tenant)?,
    };

    let scopes = match provider {
        OAuthProvider::Gmail => vec![
            Scope::new("https://mail.google.com/".to_string()),
            Scope::new("email".to_string()),
            Scope::new("profile".to_string()),
        ],
        OAuthProvider::Outlook => vec![
            Scope::new("https://outlook.office.com/IMAP.AccessAsUser.All".to_string()),
            Scope::new("https://outlook.office.com/SMTP.Send".to_string()),
            Scope::new("offline_access".to_string()),
            Scope::new("email".to_string()),
        ],
    };

    let (auth_url, csrf_token) = client
        .authorize_url(CsrfToken::new_random)
        .add_scopes(scopes)
        .url();

    Ok(OAuthAuthUrlResponse {
        auth_url: auth_url.to_string(),
        csrf_state: csrf_token.secret().clone(),
    })
}

/// Exchange authorization code for tokens and save to Keychain — Phase F entry point.
#[allow(dead_code)]
pub async fn exchange_code(
    account_id: &str,
    provider: &OAuthProvider,
    client_id: &str,
    client_secret_or_tenant: &str,
    code: &str,
) -> Result<String, String> {
    let client = match provider {
        OAuthProvider::Gmail => gmail_client(client_id, client_secret_or_tenant)?,
        OAuthProvider::Outlook => outlook_client(client_id, client_secret_or_tenant)?,
    };

    let token_result = client
        .exchange_code(AuthorizationCode::new(code.to_string()))
        .request_async(async_http_client)
        .await
        .map_err(|e| format!("Token exchange error: {}", e))?;

    let access_token = token_result.access_token().secret().clone();

    // Save access token
    keychain::save_token(account_id, "access_token", &access_token)?;

    // Save refresh token if present
    if let Some(refresh_token) = token_result.refresh_token() {
        keychain::save_token(account_id, "refresh_token", refresh_token.secret())?;
    }

    Ok(access_token)
}

/// Refresh an expired access token using the stored refresh token — Phase F entry point.
#[allow(dead_code)]
pub async fn refresh_access_token(
    account_id: &str,
    provider: &OAuthProvider,
    client_id: &str,
    client_secret_or_tenant: &str,
) -> Result<String, String> {
    use oauth2::RefreshToken;

    let refresh_token_str = keychain::get_token(account_id, "refresh_token")
        .map_err(|_| "reauth_required".to_string())?;

    let client = match provider {
        OAuthProvider::Gmail => gmail_client(client_id, client_secret_or_tenant)?,
        OAuthProvider::Outlook => outlook_client(client_id, client_secret_or_tenant)?,
    };

    let token_result = client
        .exchange_refresh_token(&RefreshToken::new(refresh_token_str))
        .request_async(async_http_client)
        .await
        .map_err(|_| "reauth_required".to_string())?;

    let new_access_token = token_result.access_token().secret().clone();
    keychain::save_token(account_id, "access_token", &new_access_token)?;

    Ok(new_access_token)
}

trait IntoOk {
    fn into_ok(self) -> Result<BasicClient, String>;
}

impl IntoOk for BasicClient {
    fn into_ok(self) -> Result<BasicClient, String> {
        Ok(self)
    }
}
