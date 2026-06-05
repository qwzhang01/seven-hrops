use tauri::{AppHandle, Manager};
use std::fs;
use uuid::Uuid;

use super::{
    EmailAccount, EmailDraft, EmailMessage, ImapSmtpConfig, SendEmailPayload,
    imap_client, smtp_client, keychain,
    oauth::{OAuthProvider, get_auth_url},
};

const ACCOUNTS_FILE: &str = "email_accounts.json";

/// Load accounts from app data dir (metadata only, no credentials)
fn load_accounts_from_disk(app: &AppHandle) -> Vec<EmailAccount> {
    let path = app
        .path()
        .app_data_dir()
        .map(|p| p.join(ACCOUNTS_FILE))
        .unwrap_or_default();

    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Save accounts to app data dir
fn save_accounts_to_disk(app: &AppHandle, accounts: &[EmailAccount]) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create dir: {}", e))?;

    let path = dir.join(ACCOUNTS_FILE);
    let json = serde_json::to_string_pretty(accounts)
        .map_err(|e| format!("Serialization error: {}", e))?;

    fs::write(&path, json).map_err(|e| format!("Failed to write accounts: {}", e))
}

/// List all saved email accounts
#[tauri::command]
pub fn list_accounts(app: AppHandle) -> Vec<EmailAccount> {
    load_accounts_from_disk(&app)
}

/// Save or test an IMAP/SMTP account configuration
#[tauri::command]
pub async fn save_account(app: AppHandle, config: ImapSmtpConfig) -> Result<EmailAccount, String> {
    // Test IMAP connection first
    imap_client::test_connection(
        &config.imap_host,
        config.imap_port,
        &config.username,
        &config.password,
    )?;

    // Test SMTP connection
    smtp_client::test_smtp_connection(
        &config.smtp_host,
        config.smtp_port,
        &config.username,
        &config.password,
    )
    .await?;

    if config.test_only {
        // Return a dummy account for test-only mode
        return Ok(EmailAccount {
            id: "test".to_string(),
            email: config.email.clone(),
            display_name: config.display_name.clone(),
            account_type: super::AccountType::Imap,
            imap_host: Some(config.imap_host.clone()),
            imap_port: Some(config.imap_port),
            smtp_host: Some(config.smtp_host.clone()),
            smtp_port: Some(config.smtp_port),
            status: super::ConnectionStatus::Connected,
        });
    }

    let account_id = Uuid::new_v4().to_string();

    // Save password to Keychain
    keychain::save_token(&account_id, "password", &config.password)?;

    let account = EmailAccount {
        id: account_id,
        email: config.email,
        display_name: config.display_name,
        account_type: super::AccountType::Imap,
        imap_host: Some(config.imap_host),
        imap_port: Some(config.imap_port),
        smtp_host: Some(config.smtp_host),
        smtp_port: Some(config.smtp_port),
        status: super::ConnectionStatus::Connected,
    };

    // Persist account metadata
    let mut accounts = load_accounts_from_disk(&app);
    accounts.push(account.clone());
    save_accounts_to_disk(&app, &accounts)?;

    Ok(account)
}

/// Delete an email account and its credentials
#[tauri::command]
pub fn delete_account(app: AppHandle, account_id: String) -> Result<(), String> {
    keychain::delete_all_tokens(&account_id)?;

    let mut accounts = load_accounts_from_disk(&app);
    accounts.retain(|a| a.id != account_id);
    save_accounts_to_disk(&app, &accounts)
}

/// Fetch inbox messages for an account
#[tauri::command]
pub fn fetch_inbox(
    app: AppHandle,
    account_id: String,
    limit: Option<usize>,
) -> Result<Vec<EmailMessage>, String> {
    let accounts = load_accounts_from_disk(&app);
    let account = accounts
        .iter()
        .find(|a| a.id == account_id)
        .ok_or_else(|| format!("Account '{}' not found", account_id))?;

    let host = account
        .imap_host
        .as_deref()
        .ok_or("Account has no IMAP host")?;
    let port = account.imap_port.ok_or("Account has no IMAP port")?;

    imap_client::fetch_inbox(&account_id, host, port, &account.email, limit.unwrap_or(50))
}

/// Fetch a full email thread
#[tauri::command]
pub fn get_thread(
    app: AppHandle,
    account_id: String,
    message_id: String,
) -> Result<Vec<EmailMessage>, String> {
    let accounts = load_accounts_from_disk(&app);
    let account = accounts
        .iter()
        .find(|a| a.id == account_id)
        .ok_or_else(|| format!("Account '{}' not found", account_id))?;

    let host = account
        .imap_host
        .as_deref()
        .ok_or("Account has no IMAP host")?;
    let port = account.imap_port.ok_or("Account has no IMAP port")?;

    imap_client::get_thread(&account_id, host, port, &account.email, &message_id)
}

/// Send an email via SMTP
#[tauri::command]
pub async fn send_email(
    app: AppHandle,
    account_id: String,
    payload: SendEmailPayload,
) -> Result<(), String> {
    let accounts = load_accounts_from_disk(&app);
    let account = accounts
        .iter()
        .find(|a| a.id == account_id)
        .ok_or_else(|| format!("Account '{}' not found", account_id))?;

    let smtp_host = account
        .smtp_host
        .as_deref()
        .ok_or("Account has no SMTP host")?;
    let smtp_port = account.smtp_port.ok_or("Account has no SMTP port")?;

    smtp_client::send_email(
        &account_id,
        smtp_host,
        smtp_port,
        &account.email,
        &account.email,
        &payload,
    )
    .await
}

/// Save a draft to app data dir
#[tauri::command]
pub fn save_draft(app: AppHandle, draft: EmailDraft) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create dir: {}", e))?;

    let drafts_file = dir.join("email_drafts.json");
    let mut drafts: Vec<EmailDraft> = fs::read_to_string(&drafts_file)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();

    // Update or insert
    if let Some(existing) = drafts.iter_mut().find(|d| d.id == draft.id) {
        *existing = draft;
    } else {
        drafts.push(draft);
    }

    let json = serde_json::to_string_pretty(&drafts)
        .map_err(|e| format!("Serialization error: {}", e))?;
    fs::write(&drafts_file, json).map_err(|e| format!("Failed to write drafts: {}", e))
}

/// Start OAuth flow — returns the authorization URL
#[tauri::command]
pub fn start_oauth(
    provider: String,
    client_id: String,
    client_secret_or_tenant: String,
) -> Result<String, String> {
    let oauth_provider = match provider.as_str() {
        "gmail" => OAuthProvider::Gmail,
        "outlook" => OAuthProvider::Outlook,
        _ => return Err(format!("Unknown OAuth provider: {}", provider)),
    };

    let response = get_auth_url(&oauth_provider, &client_id, &client_secret_or_tenant)?;
    Ok(response.auth_url)
}
