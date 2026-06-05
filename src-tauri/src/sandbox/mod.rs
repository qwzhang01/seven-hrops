//! Sandbox subsystem — Phase B Task 1.x
//!
//! 每会话隔离的 fs / network 白名单 + JSONL 审计日志。
//!
//! 架构：
//!   - `SandboxContext`：单个 session 的白名单快照（read_paths / write_paths / network_hosts）
//!   - `SandboxRegistry`：全局单例（Arc<RwLock<HashMap<String, SandboxContext>>>），按 session_id 管理生命周期
//!   - `fs_guard`：fs_read / fs_write / canonicalize 校验
//!   - `network_guard`：host 域名校验
//!   - `audit`：异步 mpsc 通道 → JSONL append 到 `~/.seven-hrops/audit/<YYYY-MM-DD>.jsonl`
//!
//! 所有 fs / network native 命令在执行前必须先通过本模块的 `check_*`，否则视为协议违反。
//! 拒绝 / 放行均写审计日志，verdict 字段取 `allow` / `deny`。

pub mod audit;
pub mod errors;
pub mod fs_guard;
pub mod network_guard;

use once_cell::sync::Lazy;
use parking_lot::RwLock;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

// Phase G orchestrator 会通过 `sandbox::SandboxError` 访问；预留 re-export，暂时未被外部消费。
#[allow(unused_imports)]
pub use errors::{SandboxError, SandboxErrorCode};

/// Manifest 来源：决定是否走 builtin fast-path。
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ManifestSource {
    /// 内置 manifest（仓库内 `platform/manifests/`）—— fast-path：跳过白名单校验，但仍写审计。
    Builtin,
    /// 用户本地导入的 manifest —— 走完整白名单。
    User,
    /// Marketplace / 远程同步来源 —— 走完整白名单。
    Marketplace,
}

impl ManifestSource {
    /// builtin source 是否享受 fast-path（fs / network 校验直通）。
    #[inline]
    pub fn is_fast_path(self) -> bool {
        matches!(self, ManifestSource::Builtin)
    }

    pub fn as_str(self) -> &'static str {
        match self {
            ManifestSource::Builtin => "builtin",
            ManifestSource::User => "user",
            ManifestSource::Marketplace => "marketplace",
        }
    }
}

/// 单个 session 的沙箱白名单快照。
///
/// 字段语义（来自 [phase-b-platform-foundation/specs/rust-native-bridge/spec.md] 的
/// "每会话 SandboxContext 隔离" Requirement）：
///   - `read_paths`：允许 fs_read 的路径前缀（路径必须 canonicalize 后再前缀匹配）
///   - `write_paths`：允许 fs_write 的路径前缀
///   - `network_hosts`：允许 fetch 的 host 字符串列表（精确匹配，不做通配）
#[derive(Debug, Clone)]
pub struct SandboxContext {
    pub session_id: String,
    pub source: ManifestSource,
    pub read_paths: Vec<PathBuf>,
    pub write_paths: Vec<PathBuf>,
    /// Phase G orchestrator 出网校验时读取；当前 toolpack 不走网络，暂未被读取。
    #[allow(dead_code)]
    pub network_hosts: Vec<String>,
}

impl SandboxContext {
    /// 普通 user/marketplace session 构造器。
    pub fn new(
        session_id: impl Into<String>,
        source: ManifestSource,
        read_paths: Vec<PathBuf>,
        write_paths: Vec<PathBuf>,
        network_hosts: Vec<String>,
    ) -> Self {
        Self {
            session_id: session_id.into(),
            source,
            read_paths,
            write_paths,
            network_hosts,
        }
    }

    /// builtin fast-path session 构造器：白名单留空，由 fs_guard / network_guard
    /// 内部根据 `source.is_fast_path()` 短路放行。
    pub fn builtin(session_id: impl Into<String>) -> Self {
        Self {
            session_id: session_id.into(),
            source: ManifestSource::Builtin,
            read_paths: Vec::new(),
            write_paths: Vec::new(),
            network_hosts: Vec::new(),
        }
    }
}

/// 全局 sandbox 注册表。一次进程内单例。
pub struct SandboxRegistry {
    inner: RwLock<HashMap<String, Arc<SandboxContext>>>,
}

impl SandboxRegistry {
    fn new() -> Self {
        Self {
            inner: RwLock::new(HashMap::new()),
        }
    }

    /// 注册一个新 session。重复注册会覆盖（前端 hot-reload 友好）。
    pub fn insert(&self, ctx: SandboxContext) {
        let mut g = self.inner.write();
        g.insert(ctx.session_id.clone(), Arc::new(ctx));
    }

    /// 显式释放。返回是否真的移除了。
    pub fn remove(&self, session_id: &str) -> bool {
        let mut g = self.inner.write();
        g.remove(session_id).is_some()
    }

    /// 按 session_id 获取上下文（Arc 克隆，调用方拿到不锁全局）。
    pub fn get(&self, session_id: &str) -> Option<Arc<SandboxContext>> {
        let g = self.inner.read();
        g.get(session_id).cloned()
    }

    /// 仅测试：清空全部 session（避免测试间相互影响）。
    #[cfg(test)]
    pub fn clear(&self) {
        let mut g = self.inner.write();
        g.clear();
    }
}

/// 全局单例。所有 fs / network 命令统一通过 [`registry()`] 访问。
static REGISTRY: Lazy<SandboxRegistry> = Lazy::new(SandboxRegistry::new);

#[inline]
pub fn registry() -> &'static SandboxRegistry {
    &REGISTRY
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_source_fast_path_only_for_builtin() {
        assert!(ManifestSource::Builtin.is_fast_path());
        assert!(!ManifestSource::User.is_fast_path());
        assert!(!ManifestSource::Marketplace.is_fast_path());
    }

    #[test]
    fn registry_insert_get_remove_lifecycle() {
        let r = SandboxRegistry::new();
        let ctx = SandboxContext::new(
            "s-life-1",
            ManifestSource::User,
            vec![PathBuf::from("/tmp/a")],
            vec![],
            vec![],
        );
        r.insert(ctx);
        let got = r.get("s-life-1").expect("should be present");
        assert_eq!(got.session_id, "s-life-1");
        assert_eq!(got.source, ManifestSource::User);
        assert!(r.remove("s-life-1"));
        assert!(r.get("s-life-1").is_none());
        assert!(!r.remove("s-life-1"), "double-remove returns false");
    }

    #[test]
    fn registry_overwrite_on_duplicate_insert() {
        let r = SandboxRegistry::new();
        r.insert(SandboxContext::new(
            "dup", ManifestSource::User, vec![], vec![], vec![],
        ));
        r.insert(SandboxContext::new(
            "dup",
            ManifestSource::Marketplace,
            vec![PathBuf::from("/x")],
            vec![],
            vec![],
        ));
        let got = r.get("dup").unwrap();
        assert_eq!(got.source, ManifestSource::Marketplace);
        assert_eq!(got.read_paths, vec![PathBuf::from("/x")]);
    }

    #[test]
    fn builtin_constructor_marks_source_as_builtin_with_empty_lists() {
        let ctx = SandboxContext::builtin("b1");
        assert_eq!(ctx.source, ManifestSource::Builtin);
        assert!(ctx.read_paths.is_empty());
        assert!(ctx.write_paths.is_empty());
        assert!(ctx.network_hosts.is_empty());
    }
}
