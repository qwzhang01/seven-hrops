use lettre::{
    message::{header::ContentType, Mailbox, MultiPart, SinglePart},
    transport::smtp::authentication::Credentials,
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
};

use super::{SendEmailPayload, keychain};

/// Send an email via SMTP for the given account
pub async fn send_email(
    account_id: &str,
    smtp_host: &str,
    smtp_port: u16,
    username: &str,
    from_email: &str,
    payload: &SendEmailPayload,
) -> Result<(), String> {
    let password = keychain::get_token(account_id, "password")
        .map_err(|e| format!("Failed to get SMTP password: {}", e))?;

    // Build the email message
    let from: Mailbox = from_email
        .parse()
        .map_err(|e| format!("Invalid from address: {}", e))?;

    let mut builder = Message::builder().from(from);

    for to_addr in &payload.to {
        let mailbox: Mailbox = to_addr
            .parse()
            .map_err(|e| format!("Invalid to address '{}': {}", to_addr, e))?;
        builder = builder.to(mailbox);
    }

    for cc_addr in &payload.cc {
        let mailbox: Mailbox = cc_addr
            .parse()
            .map_err(|e| format!("Invalid cc address '{}': {}", cc_addr, e))?;
        builder = builder.cc(mailbox);
    }

    if let Some(ref reply_to) = payload.in_reply_to {
        builder = builder.in_reply_to(reply_to.clone());
    }

    let email = builder
        .subject(&payload.subject)
        .multipart(
            MultiPart::alternative()
                .singlepart(
                    SinglePart::builder()
                        .header(ContentType::TEXT_PLAIN)
                        .body(payload.body_text.clone()),
                )
                .singlepart(
                    SinglePart::builder()
                        .header(ContentType::TEXT_HTML)
                        .body(payload.body_html.clone()),
                ),
        )
        .map_err(|e| format!("Failed to build email: {}", e))?;

    // Create SMTP transport
    let creds = Credentials::new(username.to_string(), password);

    let mailer: AsyncSmtpTransport<Tokio1Executor> = AsyncSmtpTransport::<Tokio1Executor>::relay(smtp_host)
        .map_err(|e| format!("SMTP relay error: {}", e))?
        .port(smtp_port)
        .credentials(creds)
        .build();

    mailer
        .send(email)
        .await
        .map_err(|e| format!("SMTP send error: {}", e))?;

    Ok(())
}

/// Test SMTP connection with given credentials
pub async fn test_smtp_connection(
    smtp_host: &str,
    smtp_port: u16,
    username: &str,
    password: &str,
) -> Result<(), String> {
    let creds = Credentials::new(username.to_string(), password.to_string());

    let mailer: AsyncSmtpTransport<Tokio1Executor> = AsyncSmtpTransport::<Tokio1Executor>::relay(smtp_host)
        .map_err(|e| format!("SMTP relay error: {}", e))?
        .port(smtp_port)
        .credentials(creds)
        .build();

    mailer
        .test_connection()
        .await
        .map_err(|e| format!("SMTP connection test failed: {}", e))?;

    Ok(())
}
