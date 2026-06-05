//! Agent manifest — see HSAS Spec §六.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::{Metadata, PermissionRule};

/// Discriminator for agent execution mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum AgentMode {
    Primary,
    Subagent,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct AgentTools {
    pub allowed: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub deny: Option<Vec<String>>,
    #[serde(rename = "autoApprove", skip_serializing_if = "Option::is_none", default)]
    pub auto_approve: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct AgentInheritFrom {
    pub name: String,
    pub overrides: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct AgentModelConfig {
    pub provider: String,
    #[serde(rename = "modelID")]
    pub model_id: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub temperature: Option<f64>,
    #[serde(rename = "maxTokens", skip_serializing_if = "Option::is_none", default)]
    pub max_tokens: Option<u32>,
    #[serde(rename = "topP", skip_serializing_if = "Option::is_none", default)]
    pub top_p: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct AgentResources {
    #[serde(rename = "maxTokensPerSession", skip_serializing_if = "Option::is_none", default)]
    pub max_tokens_per_session: Option<u32>,
    #[serde(rename = "maxToolCallsPerMinute", skip_serializing_if = "Option::is_none", default)]
    pub max_tool_calls_per_minute: Option<u32>,
    #[serde(rename = "maxConcurrentSessions", skip_serializing_if = "Option::is_none", default)]
    pub max_concurrent_sessions: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct AgentNetwork {
    #[serde(rename = "allowedHosts")]
    pub allowed_hosts: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct AgentFilesystem {
    #[serde(rename = "readPaths", skip_serializing_if = "Option::is_none", default)]
    pub read_paths: Option<Vec<String>>,
    #[serde(rename = "writePaths", skip_serializing_if = "Option::is_none", default)]
    pub write_paths: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct AgentCapabilityBinding {
    #[serde(rename = "capabilityId")]
    pub capability_id: String,
    #[serde(rename = "autoCreate", skip_serializing_if = "Option::is_none", default)]
    pub auto_create: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct AgentSpec {
    pub mode: AgentMode,
    #[serde(rename = "basePrompt")]
    pub base_prompt: String,
    #[serde(rename = "contextTemplate", skip_serializing_if = "Option::is_none", default)]
    pub context_template: Option<String>,
    #[serde(rename = "contextKeys", skip_serializing_if = "Option::is_none", default)]
    pub context_keys: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub skills: Option<Vec<String>>,
    #[serde(rename = "inheritFrom", skip_serializing_if = "Option::is_none", default)]
    pub inherit_from: Option<AgentInheritFrom>,
    pub tools: AgentTools,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub permission: Option<Vec<PermissionRule>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub model: Option<AgentModelConfig>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub resources: Option<AgentResources>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub network: Option<AgentNetwork>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub filesystem: Option<AgentFilesystem>,
    #[serde(rename = "capabilityBinding", skip_serializing_if = "Option::is_none", default)]
    pub capability_binding: Option<AgentCapabilityBinding>,
}

/// Top-level Agent manifest object.
///
/// Note: `kind` is hard-coded to `"Agent"` via `tag = "kind"` on `AnyManifest`,
/// but here in the standalone struct we still serialize it explicitly so a
/// stand-alone `agent.yaml` round-trips faithfully.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct AgentManifest {
    #[serde(rename = "apiVersion")]
    pub api_version: String,
    pub kind: AgentKindTag,
    pub metadata: Metadata,
    pub spec: AgentSpec,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub enum AgentKindTag {
    Agent,
}

#[cfg(test)]
mod tests {
    use super::super::*;
    use super::*;

    /// 最小必填 fixture（所有 Option 为 None）
    fn fixture() -> AgentManifest {
        AgentManifest {
            api_version: API_VERSION_V1.to_string(),
            kind: AgentKindTag::Agent,
            metadata: Metadata {
                name: "test-agent".to_string(),
                display_name: "Test Agent".to_string(),
                description: "test agent".to_string(),
                source: Source::Builtin,
                version: "1.0.0".to_string(),
                author: None,
                author_email: None,
                icon: None,
                tags: None,
                created_at: "2026-05-28T00:00:00Z".to_string(),
                updated_at: None,
                deprecated: None,
                deprecated_reason: None,
                homepage: None,
                signature: None,
            },
            spec: AgentSpec {
                mode: AgentMode::Primary,
                base_prompt: "x".repeat(50),
                context_template: None,
                context_keys: None,
                skills: Some(vec!["test-skill".to_string()]),
                inherit_from: None,
                tools: AgentTools {
                    allowed: vec!["read_file".to_string()],
                    deny: None,
                    auto_approve: None,
                },
                permission: None,
                model: None,
                resources: None,
                network: None,
                filesystem: None,
                capability_binding: None,
            },
        }
    }

    /// 全量 fixture（所有 Option 都填值，涵盖所有字段与可选枚举）
    fn fixture_full() -> AgentManifest {
        AgentManifest {
            api_version: API_VERSION_V1.to_string(),
            kind: AgentKindTag::Agent,
            metadata: Metadata {
                name: "full-agent".to_string(),
                display_name: "Full Agent".to_string(),
                description: "agent with all optional fields populated".to_string(),
                source: Source::User,
                version: "2.3.4".to_string(),
                author: Some("Seven".to_string()),
                author_email: Some("seven@example.com".to_string()),
                icon: Some("🤖".to_string()),
                tags: Some(vec!["hr".to_string(), "interview".to_string()]),
                created_at: "2026-05-28T00:00:00Z".to_string(),
                updated_at: Some("2026-05-28T01:00:00Z".to_string()),
                deprecated: Some(false),
                deprecated_reason: Some("none".to_string()),
                homepage: Some("https://example.com".to_string()),
                signature: Some("sig-xyz".to_string()),
            },
            spec: AgentSpec {
                mode: AgentMode::Subagent,
                base_prompt: "y".repeat(80),
                context_template: Some("hello {{user}}".to_string()),
                context_keys: Some(vec!["session.user".to_string()]),
                skills: Some(vec!["skill-a".to_string(), "skill-b".to_string()]),
                inherit_from: Some(AgentInheritFrom {
                    name: "base-agent".to_string(),
                    overrides: vec!["spec.basePrompt".to_string()],
                }),
                tools: AgentTools {
                    allowed: vec!["read_file".to_string(), "parse_pdf".to_string()],
                    deny: Some(vec!["webserver_publish".to_string()]),
                    auto_approve: Some(vec!["read_file".to_string()]),
                },
                permission: Some(vec![PermissionRule {
                    permission: "fs.read".to_string(),
                    pattern: "~/Documents/**".to_string(),
                    action: PermissionAction::Allow,
                }]),
                model: Some(AgentModelConfig {
                    provider: "openai".to_string(),
                    model_id: "gpt-4o-mini".to_string(),
                    temperature: Some(0.2),
                    max_tokens: Some(4096),
                    top_p: Some(0.95),
                }),
                resources: Some(AgentResources {
                    max_tokens_per_session: Some(100_000),
                    max_tool_calls_per_minute: Some(60),
                    max_concurrent_sessions: Some(4),
                }),
                network: Some(AgentNetwork {
                    allowed_hosts: vec!["api.openai.com".to_string()],
                }),
                filesystem: Some(AgentFilesystem {
                    read_paths: Some(vec!["~/Documents".to_string()]),
                    write_paths: Some(vec!["~/.seven-hrops/output".to_string()]),
                }),
                capability_binding: Some(AgentCapabilityBinding {
                    capability_id: "test-capability".to_string(),
                    auto_create: Some(true),
                }),
            },
        }
    }

    #[test]
    fn agent_yaml_roundtrip() {
        let m = fixture();
        let yaml = serde_yaml::to_string(&m).unwrap();
        let back: AgentManifest = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(m, back);
    }

    #[test]
    fn agent_json_roundtrip_camel_case() {
        let m = fixture();
        let json = serde_json::to_string(&m).unwrap();
        assert!(json.contains("\"apiVersion\""));
        assert!(json.contains("\"basePrompt\""));
        let back: AgentManifest = serde_json::from_str(&json).unwrap();
        assert_eq!(m, back);
    }

    /// Phase B Task 0.9 验收口径：yaml → struct → json → struct → yaml 字段级等价
    ///
    /// 实现思路：
    ///   1. 先以原始 fixture serialize 成 yaml1；
    ///   2. yaml1 → struct → json → struct → yaml2；
    ///   3. 同时断言两个 struct 相等（字段级）与 yaml1 == yaml2（文本级）。
    fn assert_full_roundtrip(original: AgentManifest) {
        let yaml1 = serde_yaml::to_string(&original).unwrap();
        let from_yaml: AgentManifest = serde_yaml::from_str(&yaml1).unwrap();
        let json = serde_json::to_string(&from_yaml).unwrap();
        let from_json: AgentManifest = serde_json::from_str(&json).unwrap();
        let yaml2 = serde_yaml::to_string(&from_json).unwrap();
        assert_eq!(original, from_yaml, "yaml → struct 丢字段");
        assert_eq!(from_yaml, from_json, "json 中转后 struct 不一致");
        assert_eq!(yaml1, yaml2, "两次 yaml 序列化文本不一致");
    }

    #[test]
    fn agent_full_pipeline_roundtrip_minimal() {
        assert_full_roundtrip(fixture());
    }

    #[test]
    fn agent_full_pipeline_roundtrip_full_fixture() {
        assert_full_roundtrip(fixture_full());
    }
}
