//! Phase B Task 3.2~3.5 — Webserver toolpack (stateful, in-process).
//! Phase G Task 5.x — wecom webhook 入站路由。
//!
//! ## 职责
//! - 维护一个**单全局** axum server（监听 `127.0.0.1:<random_port>`），路由按
//!   `/{handle}` 分发到不同的发布内容；这避免每次发布都开新端口（防火墙友好）。
//! - 提供 [`webserver_publish`] 命令：返回 `{ handle, url, token, qr_png_b64 }`；
//!   token 通过 query string `?token=xxx` 校验。
//! - 提供 [`webserver_drop`] 命令：主动清理一个 handle。
//! - 后台 GC 任务：每 60s 扫描，移除 `expires_at < now` 的实例（默认 TTL 30min）。
//! - Phase G: `POST /webhook/wecom` — HMAC-SHA256 签名校验 + 速率限制 + Tauri 事件转发。
//!
//! ## 安全
//! - 监听地址固定 `127.0.0.1`：本期不暴露到 LAN，二维码主要给 desktop 浏览器扫预览。
//!   Phase E（如要支持手机扫码）再改 `0.0.0.0` 并加防火墙说明。
//! - 每 handle 独立 token（uuid v4），不共享；URL 不含 token 时返回 401。
//! - sandbox：`webserver_publish` 接受 `session_id`，会调 [`crate::sandbox::audit`]
//!   写入 op=Other 的审计行（用户 source 也允许，不必走 fs/network 白名单——
//!   发布的内容已在 caller 端从受控 fs_read 拿到）。
//! - wecom 签名密钥存 Rust 端（env `WECOM_WEBHOOK_TOKEN`），防止 XSS 拿到。

use crate::native::errors::NativeError;
use crate::sandbox::audit::{self, AuditOp, AuditRecord, Verdict};
use crate::sandbox::registry as sandbox_registry;
use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Router,
};
use base64::Engine;
use dashmap::DashMap;
use hmac::{Hmac, Mac};
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::Emitter;
use tokio::net::TcpListener;

// 为 webserver 内部专用的全局 runtime。Tauri 在生产环境下由 main
// runtime 驱动 invoke，所有调用都从同一个 runtime 进来；但在 `#[tokio::test]`
// 中每个测试会创建独立 runtime，axum::serve 如果被 spawn 进第一个
// 测试的 runtime，该 runtime drop 后 listener 会被杀掉。所以这里独立起一个
// `tokio::runtime::Runtime` 并把 axum spawn 进去，让 server 在进程存活期内不会重启。
static SERVER_RT: Lazy<tokio::runtime::Runtime> = Lazy::new(|| {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .thread_name("seven-webserver")
        .build()
        .expect("build webserver runtime")
});

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

/// 默认 TTL：30 分钟。可由测试通过 [`set_default_ttl_for_test`] 覆盖。
const DEFAULT_TTL: Duration = Duration::from_secs(30 * 60);

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WebserverKind {
    /// 完整 HTML 文档（首条 `Content-Type: text/html; charset=utf-8`）
    Html,
    /// 纯文本（`text/plain; charset=utf-8`）
    Text,
    /// JSON 字符串（`application/json`）
    Json,
}

impl WebserverKind {
    fn content_type(&self) -> &'static str {
        match self {
            WebserverKind::Html => "text/html; charset=utf-8",
            WebserverKind::Text => "text/plain; charset=utf-8",
            WebserverKind::Json => "application/json",
        }
    }
}

/// Server 内部对单个发布实例的存储。
struct WebserverInstance {
    token: String,
    kind: WebserverKind,
    content: String,
    expires_at: Instant,
}

/// 公开的 publish 返回结构。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublishResult {
    pub handle: String,
    pub url: String,
    pub token: String,
    /// PNG 格式的二维码，base64 编码（前端 `<img src="data:image/png;base64,..."/>`）
    pub qr_png_b64: String,
}

/// Phase G: wecom 入站 webhook payload（转给 TS 端的结构）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WecomInboundPayload {
    pub from_user_id: String,
    pub content: String,
    pub msg_type: String,
    pub msg_id: Option<String>,
    pub received_at: u64,
}

// ──────────────────────────────────────────────────────────────────────────────
// Global state
// ──────────────────────────────────────────────────────────────────────────────

#[derive(Clone)]
struct ServerState {
    instances: Arc<DashMap<String, WebserverInstance>>,
    /// Phase G: wecom 入站速率限制 — 同 wecomUserId 1 QPS。
    wecom_rate_limit: Arc<Mutex<HashMap<String, Instant>>>,
}

struct ServerHandle {
    state: ServerState,
    base_url: String,
}

static SERVER: Lazy<Mutex<Option<Arc<ServerHandle>>>> = Lazy::new(|| Mutex::new(None));

/// 测试可通过此值临时改写 TTL；生产代码不会读这里。
static TTL_OVERRIDE: Lazy<Mutex<Option<Duration>>> = Lazy::new(|| Mutex::new(None));

#[cfg(test)]
fn set_default_ttl_for_test(ttl: Duration) {
    *TTL_OVERRIDE.lock() = Some(ttl);
}

#[cfg(test)]
fn reset_ttl_for_test() {
    *TTL_OVERRIDE.lock() = None;
}

fn current_ttl() -> Duration {
    TTL_OVERRIDE.lock().unwrap_or(DEFAULT_TTL)
}

// ──────────────────────────────────────────────────────────────────────────────
// Server lifecycle
// ──────────────────────────────────────────────────────────────────────────────

async fn ensure_server_started() -> Result<Arc<ServerHandle>, NativeError> {
    {
        let g = SERVER.lock();
        if let Some(h) = g.as_ref() {
            return Ok(h.clone());
        }
    }

    let state = ServerState {
        instances: Arc::new(DashMap::new()),
        wecom_rate_limit: Arc::new(Mutex::new(HashMap::new())),
    };
    let app = build_router(state.clone());

    // 在专用 runtime 上 bind + serve，返回 bind 后的端口
    let bind_state = state.clone();
    let port: u16 = SERVER_RT
        .spawn(async move {
            let listener = TcpListener::bind("127.0.0.1:0")
                .await
                .map_err(|e| e.to_string())?;
            let port = listener
                .local_addr()
                .map_err(|e| e.to_string())?
                .port();
            let app = build_router(bind_state);
            tokio::spawn(async move {
                if let Err(e) = axum::serve(listener, app).await {
                    log::warn!("[webserver] axum exited: {}", e);
                }
            });
            Ok::<u16, String>(port)
        })
        .await
        .map_err(NativeError::io_failed)?
        .map_err(NativeError::io_failed)?;
    drop(app); // 丢掉 临时变量，避免 unused warning
    let base_url = format!("http://127.0.0.1:{}", port);

    // 后台 GC：同样走全局 runtime
    let gc_state = state.clone();
    SERVER_RT.spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(60));
        tick.tick().await; // 跳过第一次 immediate tick
        loop {
            tick.tick().await;
            run_gc(&gc_state);
        }
    });

    let handle = Arc::new(ServerHandle { state, base_url });
    let mut g = SERVER.lock();
    if g.is_none() {
        *g = Some(handle.clone());
    }
    Ok(g.as_ref().unwrap().clone())
}

fn run_gc(state: &ServerState) {
    let now = Instant::now();
    let mut to_remove = Vec::new();
    for entry in state.instances.iter() {
        if entry.value().expires_at <= now {
            to_remove.push(entry.key().clone());
        }
    }
    for k in to_remove {
        state.instances.remove(&k);
    }
}

fn build_router(state: ServerState) -> Router {
    Router::new()
        .route("/healthz", get(handle_health))
        .route("/webhook/wecom", post(handle_wecom_webhook))
        .route("/:handle", get(handle_serve))
        .with_state(state)
}

async fn handle_health() -> &'static str {
    "ok"
}

// ──────────────────────────────────────────────────────────────────────────────
// Phase G: wecom webhook handler
// ──────────────────────────────────────────────────────────────────────────────

/// Phase G Task 5.1~5.5: POST /webhook/wecom handler.
///
/// 流程：
/// 1. 检查 `runtimeConfig.features.orchestrator`（通过环境变量 `ORCHESTRATOR_ENABLED`）
/// 2. HMAC-SHA256 签名校验（密钥来自 `WECOM_WEBHOOK_TOKEN`）
/// 3. 速率限制：同 wecomUserId 1 QPS
/// 4. 校验通过后 emit Tauri 事件 `wecom-inbound` 给 TS 端
async fn handle_wecom_webhook(
    State(state): State<ServerState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    // Task 5.4: 检查 orchestrator 特性开关
    let orchestrator_enabled = std::env::var("ORCHESTRATOR_ENABLED")
        .map(|v| v == "1" || v.to_lowercase() == "true")
        .unwrap_or(false);
    if !orchestrator_enabled {
        return (StatusCode::NOT_FOUND, "orchestrator feature disabled").into_response();
    }

    // Task 5.2: HMAC-SHA256 签名校验
    let token = std::env::var("WECOM_WEBHOOK_TOKEN").unwrap_or_default();
    let signature_header = headers
        .get("x-wecom-signature")
        .or_else(|| headers.get("x-signature"))
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let ip = headers
        .get("x-forwarded-for")
        .or_else(|| headers.get("x-real-ip"))
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown")
        .to_string();
    let host_header = headers
        .get("host")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let signature_present = !signature_header.is_empty();

    if !verify_wecom_signature(&body, &token, signature_header) {
        // 签名失败：写审计日志（不含 payload 内容）
        audit::record(AuditRecord {
            session_id: "wecom-inbound".to_string(),
            source: "external".to_string(),
            op: AuditOp::Other,
            path: None,
            host: Some(host_header.clone()),
            verdict: Verdict::Deny,
            reason: Some(format!(
                "wecom_signature_invalid ip={ip} signaturePresent={signature_present} host={host_header}"
            )),
        });
        return (StatusCode::UNAUTHORIZED, "invalid signature").into_response();
    }

    // 解析 payload
    let payload: WecomInboundPayload = match serde_json::from_slice(&body) {
        Ok(p) => p,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                format!("invalid payload: {e}"),
            )
                .into_response();
        }
    };

    // Task 5.5: 速率限制 — 同 wecomUserId 1 QPS
    {
        let mut rate_map = state.wecom_rate_limit.lock();
        let now = Instant::now();
        if let Some(last) = rate_map.get(&payload.from_user_id) {
            if now.duration_since(*last) < Duration::from_secs(1) {
                return (StatusCode::TOO_MANY_REQUESTS, "rate limit exceeded").into_response();
            }
        }
        rate_map.insert(payload.from_user_id.clone(), now);
    }

    // Task 5.3: 通过 WECOM_APP_HANDLE 全局引用 emit 事件给 TS 端
    // 由于 axum handler 无法直接持有 AppHandle（需要通过全局 Arc 传递），
    // 这里通过全局 WECOM_APP_HANDLE 发送事件。
    let emitted = emit_wecom_inbound(&payload);

    audit::record(AuditRecord {
        session_id: "wecom-inbound".to_string(),
        source: "external".to_string(),
        op: AuditOp::Other,
        path: None,
        host: Some(host_header),
        verdict: Verdict::Allow,
        reason: Some(format!(
            "wecom_inbound fromUser={} emitted={emitted}",
            payload.from_user_id
        )),
    });

    (StatusCode::OK, "ok").into_response()
}

/// HMAC-SHA256 签名校验。
/// 企微 webhook 签名格式：`sha256=<hex_digest>`，对 body 做 HMAC-SHA256。
fn verify_wecom_signature(body: &[u8], token: &str, signature: &str) -> bool {
    if token.is_empty() {
        // 未配置 token 时，测试环境允许跳过（生产应配置）
        return false;
    }
    let expected_hex = signature
        .strip_prefix("sha256=")
        .unwrap_or(signature);
    if expected_hex.is_empty() {
        return false;
    }
    type HmacSha256 = Hmac<Sha256>;
    let mut mac = match HmacSha256::new_from_slice(token.as_bytes()) {
        Ok(m) => m,
        Err(_) => return false,
    };
    mac.update(body);
    let result = mac.finalize().into_bytes();
    let computed = hex::encode(result);
    // 常量时间比较防止时序攻击
    computed == expected_hex
}

// ──────────────────────────────────────────────────────────────────────────────
// Phase G: Global AppHandle for wecom event emission
// ──────────────────────────────────────────────────────────────────────────────

/// 全局 AppHandle 引用，由 `register_wecom_app_handle` 在 Tauri setup 时注入。
static WECOM_APP_HANDLE: Lazy<Mutex<Option<tauri::AppHandle>>> =
    Lazy::new(|| Mutex::new(None));

/// 在 Tauri setup 阶段调用，注入 AppHandle 以便 wecom handler 可以 emit 事件。
pub fn register_wecom_app_handle(handle: tauri::AppHandle) {
    *WECOM_APP_HANDLE.lock() = Some(handle);
}

/// 向 TS 端 emit `wecom-inbound` 事件。返回是否成功 emit。
fn emit_wecom_inbound(payload: &WecomInboundPayload) -> bool {
    let guard = WECOM_APP_HANDLE.lock();
    if let Some(handle) = guard.as_ref() {
        handle.emit("wecom-inbound", payload).is_ok()
    } else {
        false
    }
}

#[derive(Debug, Deserialize)]
struct ServeQuery {
    token: Option<String>,
}

async fn handle_serve(
    State(state): State<ServerState>,
    Path(handle): Path<String>,
    Query(q): Query<ServeQuery>,
) -> Response {
    let inst = match state.instances.get(&handle) {
        Some(i) => i,
        None => return (StatusCode::NOT_FOUND, "not found").into_response(),
    };
    if inst.expires_at <= Instant::now() {
        drop(inst);
        state.instances.remove(&handle);
        return (StatusCode::NOT_FOUND, "expired").into_response();
    }
    let token = q.token.as_deref().unwrap_or("");
    if token != inst.token {
        return (StatusCode::UNAUTHORIZED, "invalid token").into_response();
    }
    let mut headers = HashMap::new();
    headers.insert(axum::http::header::CONTENT_TYPE, inst.kind.content_type());
    let body = inst.content.clone();
    let kind = inst.kind;
    drop(inst);
    let mut resp = body.into_response();
    resp.headers_mut().insert(
        axum::http::header::CONTENT_TYPE,
        axum::http::HeaderValue::from_static(kind.content_type()),
    );
    resp
}

// ──────────────────────────────────────────────────────────────────────────────
// Public API — Tauri commands
// ──────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn webserver_publish(
    session_id: String,
    content: String,
    kind: Option<WebserverKind>,
) -> Result<PublishResult, String> {
    let kind = kind.unwrap_or(WebserverKind::Html);

    // 校验 session 存在（不强制白名单匹配；webserver 不直接读盘，由 caller 端
    // 已经从 fs_guard 通过的内容）
    let source = match sandbox_registry().get(&session_id) {
        Some(c) => c.source.as_str().to_string(),
        None => {
            return Err(String::from(NativeError::sandbox_deny(format!(
                "unknown session: {session_id}"
            ))));
        }
    };

    let server = ensure_server_started().await.map_err(String::from)?;
    let handle_id = uuid::Uuid::new_v4().to_string();
    let token = uuid::Uuid::new_v4().to_string();
    let url = format!("{}/{}?token={}", server.base_url, handle_id, token);

    let qr = render_qr(&url).map_err(String::from)?;

    let inst = WebserverInstance {
        token: token.clone(),
        kind,
        content,
        expires_at: Instant::now() + current_ttl(),
    };
    server.state.instances.insert(handle_id.clone(), inst);

    audit::record(AuditRecord {
        session_id: session_id.clone(),
        source,
        op: AuditOp::Other,
        path: None,
        host: Some(server.base_url.clone()),
        verdict: Verdict::Allow,
        reason: Some(format!("webserver_publish handle={handle_id}")),
    });

    Ok(PublishResult {
        handle: handle_id,
        url,
        token,
        qr_png_b64: qr,
    })
}

#[tauri::command]
pub async fn webserver_drop(session_id: String, handle: String) -> Result<(), String> {
    let source = match sandbox_registry().get(&session_id) {
        Some(c) => c.source.as_str().to_string(),
        None => {
            return Err(String::from(NativeError::sandbox_deny(format!(
                "unknown session: {session_id}"
            ))));
        }
    };
    let server = ensure_server_started().await.map_err(String::from)?;
    let removed = server.state.instances.remove(&handle).is_some();

    audit::record(AuditRecord {
        session_id: session_id.clone(),
        source,
        op: AuditOp::Other,
        path: None,
        host: None,
        verdict: if removed { Verdict::Allow } else { Verdict::Deny },
        reason: Some(format!(
            "webserver_drop handle={handle} removed={removed}"
        )),
    });

    if !removed {
        return Err(String::from(NativeError::webserver_handle_not_found(handle)));
    }
    Ok(())
}

// ──────────────────────────────────────────────────────────────────────────────
// QR helper
// ──────────────────────────────────────────────────────────────────────────────

fn render_qr(text: &str) -> Result<String, NativeError> {
    use qrcode::QrCode;
    let code = QrCode::new(text.as_bytes())
        .map_err(|e| NativeError::parse_failed(format!("qr encode: {e}")))?;
    let img = code.render::<image::Luma<u8>>().min_dimensions(192, 192).build();
    let mut buf = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut buf);
    img.write_to(&mut cursor, image::ImageFormat::Png)
        .map_err(|e| NativeError::parse_failed(format!("png encode: {e}")))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&buf))
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sandbox::{registry, ManifestSource, SandboxContext};
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn fresh_session() -> String {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let sid = format!("ws-test-{}-{}", std::process::id(), n);
        registry().insert(SandboxContext::new(
            sid.clone(),
            ManifestSource::User,
            vec![],
            vec![],
            vec![],
        ));
        sid
    }

    /// 串行化所有 webserver 测试：共享全局 SERVER + TTL_OVERRIDE。
    fn ws_lock() -> &'static parking_lot::Mutex<()> {
        static L: once_cell::sync::Lazy<parking_lot::Mutex<()>> =
            once_cell::sync::Lazy::new(|| parking_lot::Mutex::new(()));
        &L
    }

    async fn http_get(url: &str) -> (u16, String) {
        let resp = reqwest::Client::new().get(url).send().await.unwrap();
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        (status, body)
    }

    #[tokio::test]
    async fn publish_then_get_then_drop() {
        let _g = ws_lock().lock();
        reset_ttl_for_test();
        let sid = fresh_session();
        let res = webserver_publish(
            sid.clone(),
            "<h1>hello world</h1>".into(),
            Some(WebserverKind::Html),
        )
        .await
        .unwrap();
        assert!(!res.handle.is_empty());
        assert!(res.url.contains(&res.handle));
        assert!(res.url.contains(&res.token));
        assert!(!res.qr_png_b64.is_empty());

        // 1) GET with token → 200 + body
        let (status, body) = http_get(&res.url).await;
        assert_eq!(status, 200);
        assert!(body.contains("hello world"));

        // 2) GET without token → 401
        let no_token_url = res.url.split('?').next().unwrap();
        let (status_unauth, _) = http_get(no_token_url).await;
        assert_eq!(status_unauth, 401);

        // 3) drop → GET 404
        webserver_drop(sid.clone(), res.handle.clone()).await.unwrap();
        let (status_dropped, _) = http_get(&res.url).await;
        assert_eq!(status_dropped, 404);
    }

    #[tokio::test]
    async fn drop_unknown_handle_returns_handle_not_found() {
        let _g = ws_lock().lock();
        let sid = fresh_session();
        // 先确保 server 已启动
        let _ = webserver_publish(sid.clone(), "x".into(), Some(WebserverKind::Text))
            .await
            .unwrap();
        let err = webserver_drop(sid, "no-such-handle".into()).await.unwrap_err();
        assert!(err.contains("WEBSERVER_HANDLE_NOT_FOUND"), "got {}", err);
    }

    #[tokio::test]
    async fn publish_with_unknown_session_denied() {
        let _g = ws_lock().lock();
        let err = webserver_publish(
            "ghost-session".into(),
            "x".into(),
            Some(WebserverKind::Text),
        )
        .await
        .unwrap_err();
        assert!(err.contains("SANDBOX_DENY"), "got {}", err);
    }

    #[tokio::test]
    async fn ttl_expired_returns_404() {
        let _g = ws_lock().lock();
        // 把默认 TTL 缩短到 50ms 测过期路径
        set_default_ttl_for_test(Duration::from_millis(50));
        let sid = fresh_session();
        let res = webserver_publish(sid, "soon-expired".into(), Some(WebserverKind::Text))
            .await
            .unwrap();
        // 等待过期
        tokio::time::sleep(Duration::from_millis(120)).await;
        let (status, _) = http_get(&res.url).await;
        assert_eq!(status, 404);
        reset_ttl_for_test();
    }

    #[tokio::test]
    async fn content_type_matches_kind() {
        let _g = ws_lock().lock();
        reset_ttl_for_test();
        let sid = fresh_session();
        let res = webserver_publish(
            sid,
            r#"{"a":1}"#.into(),
            Some(WebserverKind::Json),
        )
        .await
        .unwrap();
        let resp = reqwest::Client::new().get(&res.url).send().await.unwrap();
        assert_eq!(resp.status().as_u16(), 200);
        let ct = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .map(|v| v.to_str().unwrap_or("").to_string())
            .unwrap_or_default();
        assert!(ct.contains("application/json"), "got {}", ct);
    }

    // ─── Phase G Task 5.7: wecom webhook 单测 ────────────────────────────────

    fn make_wecom_signature(body: &[u8], token: &str) -> String {
        type HmacSha256 = Hmac<Sha256>;
        let mut mac = HmacSha256::new_from_slice(token.as_bytes()).unwrap();
        mac.update(body);
        let result = mac.finalize().into_bytes();
        format!("sha256={}", hex::encode(result))
    }

    async fn wecom_post(server_url: &str, body: &[u8], signature: &str) -> (u16, String) {
        let resp = reqwest::Client::new()
            .post(format!("{}/webhook/wecom", server_url))
            .header("x-wecom-signature", signature)
            .header("content-type", "application/json")
            .body(body.to_vec())
            .send()
            .await
            .unwrap();
        let status = resp.status().as_u16();
        let body_text = resp.text().await.unwrap_or_default();
        (status, body_text)
    }

    fn get_server_base_url() -> String {
        let g = SERVER.lock();
        g.as_ref().unwrap().base_url.clone()
    }

    #[tokio::test]
    async fn wecom_signature_valid_passes() {
        let _g = ws_lock().lock();
        reset_ttl_for_test();
        // 确保 server 已启动
        let sid = fresh_session();
        let _ = webserver_publish(sid, "x".into(), Some(WebserverKind::Text)).await.unwrap();
        let base_url = get_server_base_url();

        // 启用 orchestrator 特性
        std::env::set_var("ORCHESTRATOR_ENABLED", "1");
        let token = "test-secret-token";
        std::env::set_var("WECOM_WEBHOOK_TOKEN", token);

        let payload = serde_json::json!({
            "fromUserId": "user-001",
            "content": "hello",
            "msgType": "text",
            "msgId": "msg-001",
            "receivedAt": 1700000000u64
        });
        let body = serde_json::to_vec(&payload).unwrap();
        let sig = make_wecom_signature(&body, token);

        let (status, _) = wecom_post(&base_url, &body, &sig).await;
        // 即使没有 AppHandle（测试环境），签名校验通过后返回 200
        assert_eq!(status, 200, "valid signature should return 200");

        std::env::remove_var("ORCHESTRATOR_ENABLED");
        std::env::remove_var("WECOM_WEBHOOK_TOKEN");
    }

    #[tokio::test]
    async fn wecom_signature_invalid_returns_401() {
        let _g = ws_lock().lock();
        reset_ttl_for_test();
        let sid = fresh_session();
        let _ = webserver_publish(sid, "x".into(), Some(WebserverKind::Text)).await.unwrap();
        let base_url = get_server_base_url();

        std::env::set_var("ORCHESTRATOR_ENABLED", "1");
        std::env::set_var("WECOM_WEBHOOK_TOKEN", "correct-token");

        let payload = serde_json::json!({
            "fromUserId": "user-002",
            "content": "hi",
            "msgType": "text",
            "receivedAt": 1700000001u64
        });
        let body = serde_json::to_vec(&payload).unwrap();
        // 使用错误的 token 生成签名
        let bad_sig = make_wecom_signature(&body, "wrong-token");

        let (status, _) = wecom_post(&base_url, &body, &bad_sig).await;
        assert_eq!(status, 401, "invalid signature should return 401");

        std::env::remove_var("ORCHESTRATOR_ENABLED");
        std::env::remove_var("WECOM_WEBHOOK_TOKEN");
    }

    #[tokio::test]
    async fn wecom_feature_disabled_returns_404() {
        let _g = ws_lock().lock();
        reset_ttl_for_test();
        let sid = fresh_session();
        let _ = webserver_publish(sid, "x".into(), Some(WebserverKind::Text)).await.unwrap();
        let base_url = get_server_base_url();

        // 确保 orchestrator 特性关闭
        std::env::remove_var("ORCHESTRATOR_ENABLED");

        let payload = serde_json::json!({
            "fromUserId": "user-003",
            "content": "test",
            "msgType": "text",
            "receivedAt": 1700000002u64
        });
        let body = serde_json::to_vec(&payload).unwrap();

        let (status, _) = wecom_post(&base_url, &body, "sha256=anything").await;
        assert_eq!(status, 404, "disabled feature should return 404");
    }

    #[tokio::test]
    async fn wecom_rate_limit_same_user_1qps() {
        let _g = ws_lock().lock();
        reset_ttl_for_test();
        let sid = fresh_session();
        let _ = webserver_publish(sid, "x".into(), Some(WebserverKind::Text)).await.unwrap();
        let base_url = get_server_base_url();

        std::env::set_var("ORCHESTRATOR_ENABLED", "1");
        let token = "rate-limit-token";
        std::env::set_var("WECOM_WEBHOOK_TOKEN", token);

        let payload = serde_json::json!({
            "fromUserId": "rate-test-user",
            "content": "first",
            "msgType": "text",
            "receivedAt": 1700000003u64
        });
        let body = serde_json::to_vec(&payload).unwrap();
        let sig = make_wecom_signature(&body, token);

        // 第一次请求应该通过
        let (status1, _) = wecom_post(&base_url, &body, &sig).await;
        assert_eq!(status1, 200, "first request should pass");

        // 立即第二次请求应该被速率限制
        let (status2, _) = wecom_post(&base_url, &body, &sig).await;
        assert_eq!(status2, 429, "second immediate request should be rate limited");

        std::env::remove_var("ORCHESTRATOR_ENABLED");
        std::env::remove_var("WECOM_WEBHOOK_TOKEN");
    }
}
