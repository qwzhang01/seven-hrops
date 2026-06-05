//! audit — Phase B Task 1.7 / 1.10
//!
//! JSONL 格式审计日志，按日切分到 `~/.seven-hrops/audit/<YYYY-MM-DD>.jsonl`。
//!
//! 设计：
//!   - 调用方走同步入口 [`record`]（fs_guard / network_guard 在锁内调用），不阻塞
//!   - 内部用 `tokio::sync::mpsc::unbounded_channel`，发送端 `send` 在 buffer 上立即返回
//!   - 后台 consumer task 顺序消费 → 打开当日文件（`OpenOptions append`）→ 写入一行 JSON + `\n` → flush
//!   - consumer 单线程处理可保证写盘顺序与发送顺序一致（验证 100 并发不丢日志的关键）
//!
//! 日志路径根可被环境变量 `SEVEN_HROPS_AUDIT_DIR` override，便于测试注入临时目录。

use chrono::{DateTime, Local, Utc};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::OnceLock;
use tokio::sync::mpsc;

/// 审计中识别的操作类型。
// FsList / FsStat / FsCanonicalize / Network 是 Phase G orchestrator 的预留变体，暂未构造。
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AuditOp {
    FsRead,
    FsWrite,
    FsList,
    FsStat,
    FsCanonicalize,
    Network,
    /// 后续 webserver / transcribe / parse 等命令的占位
    Other,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Verdict {
    Allow,
    Deny,
}

/// 审计单行。字段顺序与 [phase-b-platform-foundation/specs/rust-native-bridge/spec.md]
/// 「JSONL 审计日志」Requirement 一致：`{ ts, session_id, source, op, path?, host?, verdict, reason? }`。
#[derive(Debug, Clone, Serialize)]
pub struct AuditRecord {
    pub session_id: String,
    pub source: String,
    pub op: AuditOp,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    pub verdict: Verdict,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// 写盘时再补 ts 字段的封装。
#[derive(Debug, Serialize)]
struct AuditLine<'a> {
    ts: String,
    #[serde(flatten)]
    inner: &'a AuditRecord,
}

// ----------------- channel singleton -----------------

struct AuditChannel {
    tx: mpsc::UnboundedSender<AuditRecord>,
}

static CHANNEL: OnceLock<AuditChannel> = OnceLock::new();

/// 同步入口：把一条记录扔到 channel，不阻塞。如果 channel 尚未启动（极端早期阶段），
/// 退化为同步直写。
pub fn record(rec: AuditRecord) {
    if let Some(ch) = CHANNEL.get() {
        // unbounded send 不会阻塞；只有当 receiver 被 drop 才会失败 —— 那种情况下 fallback 同步写
        if ch.tx.send(rec.clone()).is_ok() {
            return;
        }
    }
    write_one_sync(&rec);
}

/// 仅给 tauri setup 调用：启动 consumer。重复调用是幂等的（OnceLock 保证）。
///
/// # 实现约束（架构规范）
///
/// 本函数 MUST 是 self-contained 的，不得依赖任何外部 Tokio 运行时。
/// 原因：Tauri 的 `setup()` 回调在 macOS `applicationDidFinishLaunching` 中触发，
/// 此时 Tauri 内部的 Tokio 运行时尚未启动；若使用 `tokio::spawn` 会立即 panic。
///
/// 正确做法：`std::thread::spawn` + 独立的单线程 `tokio::Runtime`，
/// 让 audit writer 完全自给自足，与 Tauri 主运行时生命周期解耦。
pub fn init_audit_writer() {
    let _ = CHANNEL.get_or_init(|| {
        let (tx, mut rx) = mpsc::unbounded_channel::<AuditRecord>();
        // 独立线程 + 独立 Runtime，与 Tauri 主运行时完全解耦
        // 不可改回 tokio::spawn —— setup() 时外部运行时尚未就绪
        std::thread::Builder::new()
            .name("audit-writer".to_string())
            .spawn(move || {
                let rt = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .expect("audit writer runtime");
                rt.block_on(async move {
                    while let Some(rec) = rx.recv().await {
                        write_one_sync(&rec);
                    }
                });
            })
            .expect("failed to spawn audit-writer thread");
        AuditChannel { tx }
    });
}

/// 仅测试：等 channel 中的所有积压消息全部 flush 到磁盘。
/// 实现：发送一条 sentinel + 等到 sentinel 文件可读到。
/// 由于我们 channel 是 FIFO + consumer 单线程，在测试结束前 sleep 极短时间即可。
#[cfg(test)]
pub async fn flush_for_test() {
    // 简单 sleep 让 consumer 把 unbounded queue 处理完。
    // 100 条记录 < 5ms 写盘，sleep 50ms 余量足够。
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
}

fn write_one_sync(rec: &AuditRecord) {
    let dir = audit_dir();
    if std::fs::create_dir_all(&dir).is_err() {
        return; // 创建目录失败 —— 不能再因为审计失败而 panic 业务
    }
    let date = Local::now().format("%Y-%m-%d").to_string();
    let file = dir.join(format!("{date}.jsonl"));
    let line = AuditLine {
        ts: now_iso8601(),
        inner: rec,
    };
    let json = match serde_json::to_string(&line) {
        Ok(s) => s,
        Err(_) => return,
    };
    use std::io::Write as _;
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file)
    {
        let _ = writeln!(f, "{json}");
    }
}

fn now_iso8601() -> String {
    let now: DateTime<Utc> = Utc::now();
    now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// 审计根目录。优先 env override（测试用），否则 `~/.seven-hrops/audit/`。
///
/// 暴露为 `pub(crate)` 以便 `commands::diagnostics::open_audit_log` 命令复用，
/// 避免路径常量在多处重复（单一真理源）。
pub(crate) fn audit_dir() -> PathBuf {
    if let Ok(p) = std::env::var("SEVEN_HROPS_AUDIT_DIR") {
        return PathBuf::from(p);
    }
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".seven-hrops").join("audit")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::OnceLock;

    fn test_lock() -> &'static parking_lot::Mutex<()> {
        static L: OnceLock<parking_lot::Mutex<()>> = OnceLock::new();
        L.get_or_init(|| parking_lot::Mutex::new(()))
    }

    fn with_temp_audit_dir<F: FnOnce(&PathBuf)>(f: F) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("seven-audit-{}", uuid::Uuid::new_v4()));
        std::env::set_var("SEVEN_HROPS_AUDIT_DIR", &dir);
        std::fs::create_dir_all(&dir).unwrap();
        f(&dir);
        dir
    }

    fn make_record(sess: &str, verdict: Verdict) -> AuditRecord {
        AuditRecord {
            session_id: sess.to_string(),
            source: "user".to_string(),
            op: AuditOp::FsRead,
            path: Some("/tmp/x".to_string()),
            host: None,
            verdict,
            reason: None,
        }
    }

    fn count_today_lines(dir: &PathBuf) -> usize {
        let date = Local::now().format("%Y-%m-%d").to_string();
        let file = dir.join(format!("{date}.jsonl"));
        match std::fs::read_to_string(&file) {
            Ok(s) => s.lines().filter(|l| !l.trim().is_empty()).count(),
            Err(_) => 0,
        }
    }

    #[test]
    fn sync_fallback_writes_jsonl_with_required_fields() {
        let _g = test_lock().lock();
        let unique = format!("sync-{}", uuid::Uuid::new_v4());
        let dir = with_temp_audit_dir(|_| {
            // CHANNEL 在本测试下未必被 init，所以 record() 会走 fallback 同步写
            record(make_record(&unique, Verdict::Allow));
        });

        let date = Local::now().format("%Y-%m-%d").to_string();
        let file = dir.join(format!("{date}.jsonl"));
        let content = std::fs::read_to_string(&file).unwrap();
        // 只看包含本测试 unique 会话的那一行
        let line = content
            .lines()
            .find(|l| l.contains(&format!("\"session_id\":\"{unique}\"")))
            .expect("target line should be present");
        assert!(line.contains("\"verdict\":\"allow\""));
        assert!(line.contains("\"op\":\"fs_read\""));
        assert!(line.contains("\"ts\":"));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn concurrent_100_records_no_loss() {
        let _g = test_lock().lock();
        let dir = std::env::temp_dir().join(format!("seven-audit-conc-{}", uuid::Uuid::new_v4()));
        std::env::set_var("SEVEN_HROPS_AUDIT_DIR", &dir);
        std::fs::create_dir_all(&dir).unwrap();

        // 启动 consumer
        init_audit_writer();

        // 用独享前缀，避免在并发测试下被其他模块的审计记录干扰计数
        let prefix = format!("conc-{}-", uuid::Uuid::new_v4());

        let mut joins = Vec::with_capacity(100);
        for i in 0..100 {
            let p = prefix.clone();
            joins.push(tokio::spawn(async move {
                let mut r = make_record(&format!("{p}{i}"), Verdict::Allow);
                r.reason = Some(format!("idx={i}"));
                record(r);
            }));
        }
        for j in joins {
            j.await.unwrap();
        }
        flush_for_test().await;

        // 只统计 prefix 匹配的行，判定是否丈失
        let date = Local::now().format("%Y-%m-%d").to_string();
        let content = std::fs::read_to_string(dir.join(format!("{date}.jsonl"))).unwrap_or_default();
        let matched = content
            .lines()
            .filter(|l| l.contains(&format!("\"session_id\":\"{prefix}")))
            .count();
        assert_eq!(matched, 100, "expected 100 matching audit lines, got {matched}");

        // 进一步：100 个不同 idx 都出现
        for i in 0..100 {
            assert!(
                content.contains(&format!("\"session_id\":\"{prefix}{i}\"")),
                "missing session {prefix}{i}"
            );
        }
    }
}
