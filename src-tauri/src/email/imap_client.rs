use imap::{Session, Connection};
use mailparse::{parse_mail, MailHeaderMap};

use super::{EmailMessage, keychain};

type ImapSession = Session<Connection>;

/// Build an authenticated IMAP session for the given account
fn connect_imap(
    account_id: &str,
    host: &str,
    port: u16,
    username: &str,
) -> Result<ImapSession, String> {
    let password = keychain::get_token(account_id, "password")
        .map_err(|e| format!("Failed to get IMAP password: {}", e))?;

    let client = imap::ClientBuilder::new(host, port)
        .connect()
        .map_err(|e| format!("IMAP connect error: {}", e))?;

    let session = client
        .login(username, &password)
        .map_err(|(e, _)| format!("IMAP login error: {}", e))?;

    Ok(session)
}

/// Parse a raw email body into an EmailMessage
fn parse_message(account_id: &str, uid: u32, raw: &[u8]) -> EmailMessage {
    let parsed = parse_mail(raw).unwrap_or_else(|_| parse_mail(b"").unwrap());
    let headers = parsed.get_headers();

    let message_id = headers.get_first_value("Message-ID");
    let in_reply_to = headers.get_first_value("In-Reply-To");
    let subject = headers
        .get_first_value("Subject")
        .unwrap_or_else(|| "(No Subject)".to_string());
    let date = headers
        .get_first_value("Date")
        .unwrap_or_else(|| "".to_string());

    // Parse From header
    let from_raw = headers
        .get_first_value("From")
        .unwrap_or_else(|| "".to_string());
    let (from_name, from_email) = parse_address(&from_raw);

    // Parse To/CC
    let to = headers
        .get_first_value("To")
        .map(|v| v.split(',').map(|s| s.trim().to_string()).collect())
        .unwrap_or_default();
    let cc = headers
        .get_first_value("Cc")
        .map(|v| v.split(',').map(|s| s.trim().to_string()).collect())
        .unwrap_or_default();

    // Extract body
    let mut body_text = None;
    let mut body_html = None;
    extract_body(&parsed, &mut body_text, &mut body_html);

    let snippet = body_text
        .as_deref()
        .unwrap_or("")
        .chars()
        .take(100)
        .collect::<String>();

    EmailMessage {
        id: format!("{}:{}", account_id, uid),
        account_id: account_id.to_string(),
        uid,
        message_id,
        in_reply_to: in_reply_to.clone(),
        from_name,
        from_email,
        to,
        cc,
        subject,
        snippet,
        body_html,
        body_text,
        is_read: false, // Will be updated from FLAGS
        date,
        thread_id: in_reply_to,
    }
}

/// Recursively extract text and HTML body parts
fn extract_body(
    mail: &mailparse::ParsedMail,
    text: &mut Option<String>,
    html: &mut Option<String>,
) {
    let mime = mail.ctype.mimetype.to_lowercase();
    if mime == "text/plain" && text.is_none() {
        *text = mail.get_body().ok();
    } else if mime == "text/html" && html.is_none() {
        *html = mail.get_body().ok();
    }
    for sub in &mail.subparts {
        extract_body(sub, text, html);
    }
}

/// Parse "Name <email>" or plain email address
fn parse_address(raw: &str) -> (Option<String>, String) {
    if let (Some(lt), Some(gt)) = (raw.find('<'), raw.find('>')) {
        let name = raw[..lt].trim().trim_matches('"').to_string();
        let email = raw[lt + 1..gt].trim().to_string();
        (if name.is_empty() { None } else { Some(name) }, email)
    } else {
        (None, raw.trim().to_string())
    }
}

/// Fetch the most recent `limit` messages from INBOX
pub fn fetch_inbox(
    account_id: &str,
    host: &str,
    port: u16,
    username: &str,
    limit: usize,
) -> Result<Vec<EmailMessage>, String> {
    let mut session = connect_imap(account_id, host, port, username)?;

    session
        .select("INBOX")
        .map_err(|e| format!("INBOX select error: {}", e))?;

    // Get total message count
    let mailbox = session
        .select("INBOX")
        .map_err(|e| format!("INBOX select error: {}", e))?;

    let total = mailbox.exists as usize;
    if total == 0 {
        let _ = session.logout();
        return Ok(vec![]);
    }

    let start = if total > limit { total - limit + 1 } else { 1 };
    let seq_set = format!("{}:{}", start, total);

    let messages = session
        .fetch(&seq_set, "(UID FLAGS RFC822)")
        .map_err(|e| format!("FETCH error: {}", e))?;

    let mut result: Vec<EmailMessage> = messages
        .iter()
        .filter_map(|m| {
            let uid = m.uid.unwrap_or(0);
            let raw = m.body()?;
            let mut msg = parse_message(account_id, uid, raw);
            // Check \Seen flag
            msg.is_read = m.flags().iter().any(|f| matches!(f, imap::types::Flag::Seen));
            Some(msg)
        })
        .collect();

    // Newest first
    result.reverse();

    let _ = session.logout();
    Ok(result)
}

/// Fetch a full email thread by message-id
pub fn get_thread(
    account_id: &str,
    host: &str,
    port: u16,
    username: &str,
    message_id: &str,
) -> Result<Vec<EmailMessage>, String> {
    let mut session = connect_imap(account_id, host, port, username)?;

    session
        .select("INBOX")
        .map_err(|e| format!("INBOX select error: {}", e))?;

    // Search for messages in the thread
    let search_query = format!("HEADER Message-ID \"{}\"", message_id);
    let uids = session
        .uid_search(&search_query)
        .map_err(|e| format!("SEARCH error: {}", e))?;

    if uids.is_empty() {
        let _ = session.logout();
        return Ok(vec![]);
    }

    let uid_set: Vec<String> = uids.iter().map(|u| u.to_string()).collect();
    let uid_str = uid_set.join(",");

    let messages = session
        .uid_fetch(&uid_str, "(UID FLAGS RFC822)")
        .map_err(|e| format!("UID FETCH error: {}", e))?;

    let mut result: Vec<EmailMessage> = messages
        .iter()
        .filter_map(|m| {
            let uid = m.uid.unwrap_or(0);
            let raw = m.body()?;
            let mut msg = parse_message(account_id, uid, raw);
            msg.is_read = m.flags().iter().any(|f| matches!(f, imap::types::Flag::Seen));
            Some(msg)
        })
        .collect();

    result.sort_by(|a, b| a.date.cmp(&b.date));

    let _ = session.logout();
    Ok(result)
}

/// Test IMAP connection with given credentials (used during account setup)
pub fn test_connection(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
) -> Result<(), String> {
    let client = imap::ClientBuilder::new(host, port)
        .connect()
        .map_err(|e| format!("IMAP connect error: {}", e))?;

    let mut session = client
        .login(username, password)
        .map_err(|(e, _)| format!("IMAP login error: {}", e))?;

    let _ = session.logout();
    Ok(())
}
