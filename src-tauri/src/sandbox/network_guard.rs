//! network_guard — Phase B Task 1.5 / Phase G Task 5.6
//!
//! 域名白名单匹配。语义：精确匹配 host 字符串（不做通配 / 子域名递归）。
//! 设计上保守：未来如果要支持 `*.openai.com`，应在 SandboxContext 上专门加字段，
//! 而不是在白名单里偷偷加通配，避免误放行。
//!
//! Phase G Task 5.6: `qyapi.weixin.qq.com` 对 builtin source 放行。
//! builtin source 走 fast-path（`source.is_fast_path() == true`），无需显式加入白名单。
//! user-source Agent 调用 `send_wecom_message` 时，必须在 SandboxContext.network_hosts
//! 中显式包含 `qyapi.weixin.qq.com`（通过 PermissionPrompt 授权后注入）。

use super::audit::{self, AuditOp, AuditRecord, Verdict};
use super::errors::{SandboxError, SandboxErrorCode};
use super::registry;

/// 校验某次出网请求的目标 host。
/// Phase G orchestrator 调用入口；当前 toolpack 不走网络，暂未被消费。
#[allow(dead_code)]
pub fn check_network(session_id: &str, host: &str) -> Result<(), SandboxError> {
    let ctx = match registry().get(session_id) {
        Some(c) => c,
        None => {
            audit::record(AuditRecord {
                session_id: session_id.to_string(),
                source: "unknown".to_string(),
                op: AuditOp::Network,
                path: None,
                host: Some(host.to_string()),
                verdict: Verdict::Deny,
                reason: Some("session not registered".to_string()),
            });
            return Err(SandboxError::new(
                SandboxErrorCode::SandboxSessionNotFound,
                format!("sandbox session '{session_id}' not found"),
            ));
        }
    };

    // builtin fast-path
    if ctx.source.is_fast_path() {
        audit::record(AuditRecord {
            session_id: session_id.to_string(),
            source: ctx.source.as_str().to_string(),
            op: AuditOp::Network,
            path: None,
            host: Some(host.to_string()),
            verdict: Verdict::Allow,
            reason: None,
        });
        return Ok(());
    }

    if ctx.network_hosts.iter().any(|h| h == host) {
        audit::record(AuditRecord {
            session_id: session_id.to_string(),
            source: ctx.source.as_str().to_string(),
            op: AuditOp::Network,
            path: None,
            host: Some(host.to_string()),
            verdict: Verdict::Allow,
            reason: None,
        });
        Ok(())
    } else {
        let reason = format!(
            "host '{host}' not in network_hosts whitelist (entries={})",
            ctx.network_hosts.len()
        );
        audit::record(AuditRecord {
            session_id: session_id.to_string(),
            source: ctx.source.as_str().to_string(),
            op: AuditOp::Network,
            path: None,
            host: Some(host.to_string()),
            verdict: Verdict::Deny,
            reason: Some(reason.clone()),
        });
        Err(
            SandboxError::new(SandboxErrorCode::SandboxDenyNetwork, "network denied")
                .with_reason(reason),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sandbox::{ManifestSource, SandboxContext};
    use parking_lot::Mutex;

    static TEST_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn deny_network_outside_whitelist() {
        let _g = TEST_LOCK.lock();
        let id = format!("n-deny-{}", uuid::Uuid::new_v4());
        registry().insert(SandboxContext::new(
            &id,
            ManifestSource::User,
            vec![],
            vec![],
            vec!["api.openai.com".to_string()],
        ));
        let err = check_network(&id, "evil.com").unwrap_err();
        assert_eq!(err.code, "SANDBOX_DENY_NETWORK");
    }

    #[test]
    fn allow_network_within_whitelist() {
        let _g = TEST_LOCK.lock();
        let id = format!("n-allow-{}", uuid::Uuid::new_v4());
        registry().insert(SandboxContext::new(
            &id,
            ManifestSource::User,
            vec![],
            vec![],
            vec!["api.openai.com".to_string()],
        ));
        assert!(check_network(&id, "api.openai.com").is_ok());
    }

    #[test]
    fn deny_unknown_session_for_network() {
        let _g = TEST_LOCK.lock();
        let ghost = format!("ghost-net-{}", uuid::Uuid::new_v4());
        let err = check_network(&ghost, "anything.com").unwrap_err();
        assert_eq!(err.code, "SANDBOX_SESSION_NOT_FOUND");
    }

    #[test]
    fn builtin_fast_path_allows_any_host() {
        let _g = TEST_LOCK.lock();
        let id = format!("b-net-{}", uuid::Uuid::new_v4());
        registry().insert(SandboxContext::builtin(&id));
        assert!(check_network(&id, "huggingface.co").is_ok());
    }

    #[test]
    fn no_subdomain_wildcard_match() {
        // 验证保守语义：白名单写 api.openai.com 不放行 evil.api.openai.com
        let _g = TEST_LOCK.lock();
        let id = format!("n-sub-{}", uuid::Uuid::new_v4());
        registry().insert(SandboxContext::new(
            &id,
            ManifestSource::User,
            vec![],
            vec![],
            vec!["api.openai.com".to_string()],
        ));
        let err = check_network(&id, "evil.api.openai.com").unwrap_err();
        assert_eq!(err.code, "SANDBOX_DENY_NETWORK");
    }
}
