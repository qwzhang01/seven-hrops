//! network — Phase F Task 1.1–1.3
//!
//! Provides `http_get_json`: a sandbox-gated HTTP GET command that returns
//! parsed JSON. The host is validated against the sandbox `network_guard`
//! before any request is sent.
//!
//! Design ref: openspec/changes/roll-out-7-capabilities/design.md §D3

use crate::sandbox::network_guard;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;

/// Static whitelist of hosts allowed for builtin-source agents.
/// This is the *application-level* default; the sandbox `network_guard` performs
/// the actual per-session check using `SandboxContext.network_hosts`.
///
/// Hosts listed here are automatically added to builtin sandbox sessions.
pub static ALLOWED_HOSTS_BUILTIN: &[&str] = &[
    "api.openweathermap.org",
    "127.0.0.1",
    "localhost",
];

#[derive(Debug, Serialize)]
pub struct HttpGetResult {
    pub status: u16,
    pub body: serde_json::Value,
    pub headers: HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct HttpGetArgs {
    pub url: String,
    #[serde(default)]
    pub headers: Option<HashMap<String, String>>,
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u64,
    pub session_id: String,
}

#[allow(dead_code)]
fn default_timeout_ms() -> u64 {
    10_000
}

/// Extract the host from a URL string.
fn extract_host(url: &str) -> Result<String, String> {
    let parsed = url::Url::parse(url)
        .map_err(|e| format!("INVALID_URL: failed to parse URL '{}': {}", url, e))?;
    parsed
        .host_str()
        .map(|h| h.to_string())
        .ok_or_else(|| format!("INVALID_URL: no host in URL '{}'", url))
}

/// Tauri command: perform a sandbox-gated HTTP GET and return parsed JSON.
///
/// Validation order (fail-fast):
///   1. Parse URL → extract host
///   2. `network_guard::check_network(session_id, host)` → deny if not whitelisted
///   3. Send HTTP GET with timeout
///   4. Parse response as JSON
#[tauri::command]
pub async fn http_get_json(
    url: String,
    headers: Option<HashMap<String, String>>,
    timeout_ms: Option<u64>,
    session_id: String,
) -> Result<HttpGetResult, String> {
    // 1. Extract host
    let host = extract_host(&url)?;

    // 2. Sandbox network guard check
    network_guard::check_network(&session_id, &host).map_err(|e| {
        format!("{}:{}", e.code, e.message)
    })?;

    // 3. Build and send request
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(10_000));
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|e| format!("HTTP_CLIENT_ERROR: {}", e))?;

    let mut req = client.get(&url);
    if let Some(hdrs) = headers {
        for (k, v) in hdrs {
            req = req.header(&k, &v);
        }
    }

    let response = req.send().await.map_err(|e| {
        if e.is_timeout() {
            format!("HTTP_TIMEOUT: request to '{}' timed out after {}ms", url, timeout.as_millis())
        } else if e.is_connect() {
            format!("HTTP_CONNECT_ERROR: failed to connect to '{}': {}", host, e)
        } else {
            format!("HTTP_REQUEST_ERROR: {}", e)
        }
    })?;

    let status = response.status().as_u16();
    let resp_headers: HashMap<String, String> = response
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();

    // 4. Parse body as JSON
    let body: serde_json::Value = response.json().await.map_err(|e| {
        format!("HTTP_PARSE_ERROR: failed to parse response as JSON: {}", e)
    })?;

    Ok(HttpGetResult {
        status,
        body,
        headers: resp_headers,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_host_valid() {
        assert_eq!(
            extract_host("https://api.openweathermap.org/data/2.5/weather?q=Beijing").unwrap(),
            "api.openweathermap.org"
        );
    }

    #[test]
    fn extract_host_localhost() {
        assert_eq!(
            extract_host("http://127.0.0.1:8080/path").unwrap(),
            "127.0.0.1"
        );
    }

    #[test]
    fn extract_host_invalid() {
        assert!(extract_host("not-a-url").is_err());
    }

    #[test]
    fn allowed_hosts_contains_expected() {
        assert!(ALLOWED_HOSTS_BUILTIN.contains(&"api.openweathermap.org"));
        assert!(ALLOWED_HOSTS_BUILTIN.contains(&"127.0.0.1"));
        assert!(ALLOWED_HOSTS_BUILTIN.contains(&"localhost"));
    }
}
