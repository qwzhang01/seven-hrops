use keyring::Entry;

const SERVICE_NAME: &str = "seven-hrops-email";

/// Save a token (access_token, refresh_token, or password) to system Keychain
pub fn save_token(account_id: &str, key: &str, value: &str) -> Result<(), String> {
    let entry_key = format!("{}:{}", account_id, key);
    let entry = Entry::new(SERVICE_NAME, &entry_key)
        .map_err(|e| format!("Failed to create keychain entry: {}", e))?;
    entry
        .set_password(value)
        .map_err(|e| format!("Failed to save token to keychain: {}", e))
}

/// Retrieve a token from system Keychain
pub fn get_token(account_id: &str, key: &str) -> Result<String, String> {
    let entry_key = format!("{}:{}", account_id, key);
    let entry = Entry::new(SERVICE_NAME, &entry_key)
        .map_err(|e| format!("Failed to create keychain entry: {}", e))?;
    entry
        .get_password()
        .map_err(|e| format!("Failed to get token from keychain: {}", e))
}

/// Delete a token from system Keychain
pub fn delete_token(account_id: &str, key: &str) -> Result<(), String> {
    let entry_key = format!("{}:{}", account_id, key);
    let entry = Entry::new(SERVICE_NAME, &entry_key)
        .map_err(|e| format!("Failed to create keychain entry: {}", e))?;
    entry
        .delete_credential()
        .map_err(|e| format!("Failed to delete token from keychain: {}", e))
}

/// Delete all tokens for an account (called when removing an account)
pub fn delete_all_tokens(account_id: &str) -> Result<(), String> {
    let keys = ["access_token", "refresh_token", "password"];
    for key in &keys {
        // Ignore errors for keys that don't exist
        let _ = delete_token(account_id, key);
    }
    Ok(())
}
