pub mod keychain;
pub mod imap_client;
pub mod smtp_client;
pub mod oauth;
pub mod commands;

use serde::{Deserialize, Serialize};

/// Email account type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AccountType {
    Gmail,
    Outlook,
    Imap,
}

/// Account connection status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionStatus {
    Connected,
    Disconnected,
    Error,
    ReauthRequired,
}

/// Email account metadata (no credentials stored here)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailAccount {
    pub id: String,
    pub email: String,
    pub display_name: Option<String>,
    pub account_type: AccountType,
    pub imap_host: Option<String>,
    pub imap_port: Option<u16>,
    pub smtp_host: Option<String>,
    pub smtp_port: Option<u16>,
    pub status: ConnectionStatus,
}

/// Email message metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailMessage {
    pub id: String,
    pub account_id: String,
    pub uid: u32,
    pub message_id: Option<String>,
    pub in_reply_to: Option<String>,
    pub from_name: Option<String>,
    pub from_email: String,
    pub to: Vec<String>,
    pub cc: Vec<String>,
    pub subject: String,
    pub snippet: String,
    pub body_html: Option<String>,
    pub body_text: Option<String>,
    pub is_read: bool,
    pub date: String,
    pub thread_id: Option<String>,
}

/// Email draft
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailDraft {
    pub id: String,
    pub account_id: String,
    pub to: Vec<String>,
    pub cc: Vec<String>,
    pub subject: String,
    pub body_html: String,
    pub in_reply_to: Option<String>,
    pub updated_at: String,
}

/// Payload for sending an email
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendEmailPayload {
    pub to: Vec<String>,
    pub cc: Vec<String>,
    pub subject: String,
    pub body_html: String,
    pub body_text: String,
    pub in_reply_to: Option<String>,
}

/// IMAP/SMTP manual config for account setup
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImapSmtpConfig {
    pub email: String,
    pub display_name: Option<String>,
    pub imap_host: String,
    pub imap_port: u16,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub username: String,
    pub password: String,
    pub test_only: bool,
}
