//! fs_guard — Phase B Task 1.4
//!
//! 文件系统访问的白名单校验。流程：
//!   1. 取 [`crate::sandbox::registry`] 中 session 的上下文；缺失 → `SANDBOX_SESSION_NOT_FOUND`
//!   2. builtin source → fast-path 直接 allow（仍写审计）
//!   3. 否则把 path canonicalize（不存在就 normalize 父级），再前缀匹配白名单
//!   4. 命中 → allow；未命中 → `SANDBOX_DENY_READ` / `SANDBOX_DENY_WRITE`
//!   5. 任何分支结束前，必须把审计记录交给 [`crate::sandbox::audit`]
//!
//! canonicalize 的目的是防止 `~/SevenHROps/workspaces/x/../../etc/passwd` 这种路径穿越；
//! 文件不存在的写场景，会回退到"取存在父目录的 canonical 形式 + 拼回剩余尾巴"再校验。

use std::path::{Component, Path, PathBuf};

use super::audit::{self, AuditOp, AuditRecord, Verdict};
use super::errors::{SandboxError, SandboxErrorCode};
use super::{registry, SandboxContext};

/// 校验 fs_read。
pub fn check_read(session_id: &str, path: &Path) -> Result<PathBuf, SandboxError> {
    let ctx = require_session(session_id)?;
    let canonical = canonicalize_or_synthesize(path).map_err(|e| {
        write_audit(
            session_id,
            ctx.source.as_str(),
            AuditOp::FsRead,
            Some(path),
            None,
            Verdict::Deny,
            Some(format!("canonicalize failed: {e}")),
        );
        SandboxError::new(
            SandboxErrorCode::SandboxPathTraversal,
            "path canonicalization failed",
        )
        .with_reason(e)
    })?;

    // builtin fast-path
    if ctx.source.is_fast_path() {
        write_audit(
            session_id,
            ctx.source.as_str(),
            AuditOp::FsRead,
            Some(&canonical),
            None,
            Verdict::Allow,
            None,
        );
        return Ok(canonical);
    }

    if path_within_any(&canonical, &ctx.read_paths) {
        write_audit(
            session_id,
            ctx.source.as_str(),
            AuditOp::FsRead,
            Some(&canonical),
            None,
            Verdict::Allow,
            None,
        );
        Ok(canonical)
    } else {
        let reason = format!(
            "path {:?} not in read_paths whitelist (entries={})",
            canonical,
            ctx.read_paths.len()
        );
        write_audit(
            session_id,
            ctx.source.as_str(),
            AuditOp::FsRead,
            Some(&canonical),
            None,
            Verdict::Deny,
            Some(reason.clone()),
        );
        Err(
            SandboxError::new(SandboxErrorCode::SandboxDenyRead, "fs_read denied")
                .with_reason(reason),
        )
    }
}

/// 校验 fs_write。
pub fn check_write(session_id: &str, path: &Path) -> Result<PathBuf, SandboxError> {
    let ctx = require_session(session_id)?;
    let canonical = canonicalize_or_synthesize(path).map_err(|e| {
        write_audit(
            session_id,
            ctx.source.as_str(),
            AuditOp::FsWrite,
            Some(path),
            None,
            Verdict::Deny,
            Some(format!("canonicalize failed: {e}")),
        );
        SandboxError::new(
            SandboxErrorCode::SandboxPathTraversal,
            "path canonicalization failed",
        )
        .with_reason(e)
    })?;

    if ctx.source.is_fast_path() {
        write_audit(
            session_id,
            ctx.source.as_str(),
            AuditOp::FsWrite,
            Some(&canonical),
            None,
            Verdict::Allow,
            None,
        );
        return Ok(canonical);
    }

    if path_within_any(&canonical, &ctx.write_paths) {
        write_audit(
            session_id,
            ctx.source.as_str(),
            AuditOp::FsWrite,
            Some(&canonical),
            None,
            Verdict::Allow,
            None,
        );
        Ok(canonical)
    } else {
        let reason = format!(
            "path {:?} not in write_paths whitelist (entries={})",
            canonical,
            ctx.write_paths.len()
        );
        write_audit(
            session_id,
            ctx.source.as_str(),
            AuditOp::FsWrite,
            Some(&canonical),
            None,
            Verdict::Deny,
            Some(reason.clone()),
        );
        Err(
            SandboxError::new(SandboxErrorCode::SandboxDenyWrite, "fs_write denied")
                .with_reason(reason),
        )
    }
}

/// canonical-only 校验：用于 `fs_canonicalize` 自身命令；命中 read_paths 则放行。
/// 与 [`check_read`] 等价，但语义上单独暴露便于调用方理解。
pub fn check_canonical_within(session_id: &str, path: &Path) -> Result<PathBuf, SandboxError> {
    check_read(session_id, path)
}

// ---------------- helpers ----------------

fn require_session(session_id: &str) -> Result<std::sync::Arc<SandboxContext>, SandboxError> {
    registry().get(session_id).ok_or_else(|| {
        // 无 ctx 时也写一条审计（source = "unknown"），便于排查"前端忘了 create"
        write_audit(
            session_id,
            "unknown",
            AuditOp::FsRead, // 不区分 op，仅作为 session 不存在的痕迹
            None,
            None,
            Verdict::Deny,
            Some("session not registered".to_string()),
        );
        SandboxError::new(
            SandboxErrorCode::SandboxSessionNotFound,
            format!("sandbox session '{session_id}' not found"),
        )
    })
}

#[allow(clippy::too_many_arguments)]
fn write_audit(
    session_id: &str,
    source: &str,
    op: AuditOp,
    path: Option<&Path>,
    host: Option<&str>,
    verdict: Verdict,
    reason: Option<String>,
) {
    audit::record(AuditRecord {
        session_id: session_id.to_string(),
        source: source.to_string(),
        op,
        path: path.map(|p| p.to_string_lossy().into_owned()),
        host: host.map(|h| h.to_string()),
        verdict,
        reason,
    });
}

/// 把 path 转成 canonical 形式。如果 path 不存在，则向上找最近存在的祖先 canonicalize 后再拼回剩余尾段。
/// 失败返回原因字符串。
///
/// 关键约束：上溯时遇到的所有 `..` 段必须显式记录到 tail；不能依赖 `Path::file_name()`，
/// 因为后者对以 `..` 结尾的路径返回 `None`，会"静默吞掉" `..` 导致 traversal 检测失效。
fn canonicalize_or_synthesize(path: &Path) -> Result<PathBuf, String> {
    if let Ok(c) = std::fs::canonicalize(path) {
        return Ok(c);
    }

    // 先把 path 拆成 components，从尾向前找第一个存在的祖先。
    let comps: Vec<Component> = path.components().collect();
    let mut split_at: Option<usize> = None;
    for end in (0..=comps.len()).rev() {
        let head: PathBuf = comps[..end].iter().map(|c| c.as_os_str()).collect();
        if !head.as_os_str().is_empty() && head.exists() {
            split_at = Some(end);
            break;
        }
    }

    let split_at = match split_at {
        Some(n) => n,
        None => {
            // 完全找不到任何祖先存在 → fallback 到逻辑 normalize（不读盘）
            return normalize(path).ok_or_else(|| "path normalize failed".to_string());
        }
    };

    let head: PathBuf = comps[..split_at].iter().map(|c| c.as_os_str()).collect();
    let base = std::fs::canonicalize(&head).map_err(|e| e.to_string())?;

    // 拼回剩余尾段；任何 `..` 必须拒绝（jump out of existing ancestor）
    let mut full = base;
    for c in &comps[split_at..] {
        match c {
            Component::ParentDir => {
                return Err("traversal beyond existing ancestor".to_string());
            }
            Component::CurDir => {}
            other => full.push(other.as_os_str()),
        }
    }
    Ok(full)
}

/// 简单的逻辑 normalize（不读盘）：去掉 `.` 与 `..`（`..` 不能突破到根之上）。
fn normalize(p: &Path) -> Option<PathBuf> {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    return None;
                }
            }
            other => out.push(other.as_os_str()),
        }
    }
    Some(out)
}

fn path_within_any(target: &Path, allow: &[PathBuf]) -> bool {
    allow.iter().any(|root| path_starts_with(target, root))
}

fn path_starts_with(target: &Path, root: &Path) -> bool {
    // 直接 starts_with 在 macOS 上对 `/private/var` ↔ `/var` 等符号链接情况不友好；
    // 因此对 root 也尝试 canonicalize（失败则 fallback 原路径）。
    let root_canonical = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    target.starts_with(&root_canonical) || target.starts_with(root)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sandbox::{ManifestSource, SandboxContext};
    use parking_lot::Mutex;
    use std::fs;

    // 测试间共享全局 registry，需要串行；用 parking_lot::Mutex 避免 std::sync::Mutex 被 panic 污染后累计报 PoisonError。
    static TEST_LOCK: Mutex<()> = Mutex::new(());

    fn fresh_session(id: &str, source: ManifestSource, reads: Vec<PathBuf>, writes: Vec<PathBuf>) {
        // 不调 registry().clear()：多个测试模块并发跑 cargo test 时会互相抹除。
        // 改用 uuid session_id + insert 覆盖，并仅负责本测试该 session。
        registry().insert(SandboxContext::new(id, source, reads, writes, vec![]));
    }

    #[test]
    fn deny_read_outside_whitelist() {
        let _g = TEST_LOCK.lock();
        let tmp = tempdir();
        fresh_session("s-r-1", ManifestSource::User, vec![tmp.clone()], vec![]);

        // 写一个文件位于 /tmp 根（白名单是 tmp 子目录），而非 tmp 子树
        let outside = std::env::temp_dir().join("seven-sandbox-outside.txt");
        let _ = fs::write(&outside, "x");

        let err = check_read("s-r-1", &outside).unwrap_err();
        assert_eq!(err.code, "SANDBOX_DENY_READ");
        let _ = fs::remove_file(&outside);
    }

    #[test]
    fn deny_write_outside_whitelist() {
        let _g = TEST_LOCK.lock();
        let tmp = tempdir();
        fresh_session("s-w-1", ManifestSource::User, vec![], vec![tmp.clone()]);
        let outside = std::env::temp_dir().join("seven-sandbox-outside-w.txt");
        let err = check_write("s-w-1", &outside).unwrap_err();
        assert_eq!(err.code, "SANDBOX_DENY_WRITE");
    }

    #[test]
    fn deny_path_traversal() {
        let _g = TEST_LOCK.lock();
        let tmp = tempdir();
        fresh_session(
            "s-pt-1",
            ManifestSource::User,
            vec![tmp.clone()],
            vec![],
        );
        // tmp 内一个不存在的子路径通过 `..` 跳出
        let traversal = tmp.join("nested/../../escape.txt");
        let res = check_read("s-pt-1", &traversal);
        // 要么是 traversal 错误（命中 ".." 越界），要么 canonicalize 后仍在 tmp 内被允许 —— 都不应是 panic。
        // 这里语义：tmp/nested 不存在，会触发 "traversal beyond existing ancestor"
        assert!(res.is_err());
    }

    #[test]
    fn deny_unknown_session() {
        let _g = TEST_LOCK.lock();
        let ghost_id = format!("ghost-{}", uuid::Uuid::new_v4());
        let err = check_read(&ghost_id, Path::new("/tmp/x")).unwrap_err();
        assert_eq!(err.code, "SANDBOX_SESSION_NOT_FOUND");
    }

    #[test]
    fn allow_read_within_whitelist() {
        let _g = TEST_LOCK.lock();
        let tmp = tempdir();
        fresh_session("s-ok-1", ManifestSource::User, vec![tmp.clone()], vec![]);

        let f = tmp.join("a.txt");
        fs::write(&f, "hi").unwrap();
        let canon = check_read("s-ok-1", &f).unwrap();
        assert!(canon.ends_with("a.txt"));
    }

    #[test]
    fn allow_write_within_whitelist() {
        let _g = TEST_LOCK.lock();
        let tmp = tempdir();
        fresh_session("s-ok-2", ManifestSource::User, vec![], vec![tmp.clone()]);
        let f = tmp.join("new.txt"); // 文件还没写
        let canon = check_write("s-ok-2", &f).unwrap();
        assert!(canon.starts_with(&fs::canonicalize(&tmp).unwrap()));
    }

    #[test]
    fn builtin_fast_path_allows_anywhere() {
        let _g = TEST_LOCK.lock();
        let id = format!("b-fp-{}", uuid::Uuid::new_v4());
        registry().insert(SandboxContext::builtin(&id));
        // 任意已有路径 + 任意不存在路径都应放行
        let p = std::env::temp_dir();
        check_read(&id, &p).expect("builtin should allow read");
        // 写路径不存在，走 canonicalize_or_synthesize 后仍需 fast-path 放行
        let nonexistent = p.join(format!("anyfile-{}", uuid::Uuid::new_v4()));
        check_write(&id, &nonexistent).expect("builtin should allow write to non-existent path");
    }

    fn tempdir() -> PathBuf {
        let base = std::env::temp_dir().join(format!(
            "seven-sandbox-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&base).unwrap();
        std::fs::canonicalize(&base).unwrap()
    }
}
