use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State, WebviewBuilder, WebviewUrl};
use tauri::{LogicalPosition, LogicalSize};

/// Global state holding the browser WebView instance.
/// None = not yet created or already destroyed.
pub type BrowserState = Arc<Mutex<Option<tauri::Webview>>>;

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Normalize a URL string: prepend https:// if no scheme is present.
fn normalize_url(url: &str) -> String {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return String::from("about:blank");
    }
    if trimmed.starts_with("http://")
        || trimmed.starts_with("https://")
        || trimmed.starts_with("about:")
    {
        trimmed.to_string()
    } else {
        format!("https://{}", trimmed)
    }
}

// ── Commands ──────────────────────────────────────────────────────────────────

/// Create (or re-use) the browser WebView and position it at (x, y) with the
/// given logical-pixel dimensions.
#[tauri::command]
pub async fn open_browser_webview(
    app: AppHandle,
    state: State<'_, BrowserState>,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;

    // If a WebView already exists, just navigate and show it.
    if let Some(ref webview) = *guard {
        let normalized = normalize_url(&url);
        webview
            .navigate(normalized.parse::<url::Url>().map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        webview.show().map_err(|e| e.to_string())?;
        return Ok(());
    }

    // Get the main window to attach the child WebView.
    let window = app
        .get_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;

    let normalized = normalize_url(&url);
    let builder = WebviewBuilder::new(
        "browser",
        WebviewUrl::External(
            normalized
                .parse::<url::Url>()
                .map_err(|e| e.to_string())?,
        ),
    );

    let webview = window
        .add_child(
            builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(width, height),
        )
        .map_err(|e| e.to_string())?;

    *guard = Some(webview);
    Ok(())
}

/// Navigate the existing browser WebView to a new URL.
/// No-op if WebView does not exist.
#[tauri::command]
pub async fn navigate_browser(
    state: State<'_, BrowserState>,
    url: String,
) -> Result<(), String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    if let Some(ref webview) = *guard {
        let normalized = normalize_url(&url);
        webview
            .navigate(normalized.parse::<url::Url>().map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Reload the current page in the browser WebView.
/// No-op if WebView does not exist.
#[tauri::command]
pub async fn reload_browser_webview(state: State<'_, BrowserState>) -> Result<(), String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    if let Some(ref webview) = *guard {
        webview
            .eval("location.reload()")
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Resize and reposition the browser WebView using logical pixels.
#[tauri::command]
pub async fn resize_browser_webview(
    state: State<'_, BrowserState>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    if let Some(ref webview) = *guard {
        webview
            .set_bounds(tauri::Rect {
                position: LogicalPosition::new(x, y).into(),
                size: LogicalSize::new(width, height).into(),
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Hide the browser WebView (keeps it alive, page state preserved).
/// Idempotent — safe to call when WebView does not exist.
#[tauri::command]
pub async fn hide_browser_webview(state: State<'_, BrowserState>) -> Result<(), String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    if let Some(ref webview) = *guard {
        webview.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Show the browser WebView.
/// Idempotent — safe to call when WebView does not exist.
#[tauri::command]
pub async fn show_browser_webview(state: State<'_, BrowserState>) -> Result<(), String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    if let Some(ref webview) = *guard {
        webview.show().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Destroy the browser WebView and release resources.
/// Idempotent — safe to call when WebView does not exist.
#[tauri::command]
pub async fn close_browser_webview(state: State<'_, BrowserState>) -> Result<(), String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    if let Some(webview) = guard.take() {
        webview.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}
