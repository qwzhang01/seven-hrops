//! Capability manifest — see HSAS Spec §六.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

use super::Metadata;

/// HR-domain category enumeration.
///
/// Keep parity with `manifestSchema.ts`'s `CapabilityCategory` literal union.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum CapabilityCategory {
    HrScreening,
    HrJd,
    HrInterview,
    HrReport,
    HrInternal,
    Productivity,
    Entertainment,
    System,
    Custom,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct CapabilityInputField {
    pub key: String,
    pub label: String,
    #[serde(rename = "type")]
    pub r#type: String,
    /// `default` is `unknown` in TS — we keep it as serde_json::Value for parity.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub default: Option<JsonValue>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub options: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct CapabilityVisibility {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub enabled: Option<bool>,
    #[serde(rename = "requiredFeatureFlags", skip_serializing_if = "Option::is_none", default)]
    pub required_feature_flags: Option<Vec<String>>,
    #[serde(rename = "requiredRoles", skip_serializing_if = "Option::is_none", default)]
    pub required_roles: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct CapabilitySpec {
    #[serde(rename = "agentName")]
    pub agent_name: String,
    pub category: CapabilityCategory,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub order: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub badge: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub color: Option<String>,
    #[serde(rename = "contextKeys")]
    pub context_keys: Vec<String>,
    #[serde(rename = "entryPrompt", skip_serializing_if = "Option::is_none", default)]
    pub entry_prompt: Option<String>,
    #[serde(rename = "quickReplies", skip_serializing_if = "Option::is_none", default)]
    pub quick_replies: Option<Vec<String>>,
    #[serde(rename = "inputSchema", skip_serializing_if = "Option::is_none", default)]
    pub input_schema: Option<Vec<CapabilityInputField>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub visibility: Option<CapabilityVisibility>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub enum CapabilityKindTag {
    Capability,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct CapabilityManifest {
    #[serde(rename = "apiVersion")]
    pub api_version: String,
    pub kind: CapabilityKindTag,
    pub metadata: Metadata,
    pub spec: CapabilitySpec,
}

#[cfg(test)]
mod tests {
    use super::super::*;
    use super::*;
    use serde_json::json;

    fn fixture() -> CapabilityManifest {
        CapabilityManifest {
            api_version: API_VERSION_V1.to_string(),
            kind: CapabilityKindTag::Capability,
            metadata: Metadata {
                name: "test-capability".to_string(),
                display_name: "Test Capability".to_string(),
                description: "test capability".to_string(),
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
            spec: CapabilitySpec {
                agent_name: "test-agent".to_string(),
                category: CapabilityCategory::System,
                order: Some(0),
                badge: None,
                color: None,
                context_keys: vec!["session.user".to_string()],
                entry_prompt: None,
                quick_replies: None,
                input_schema: None,
                visibility: None,
            },
        }
    }

    fn fixture_full() -> CapabilityManifest {
        CapabilityManifest {
            api_version: API_VERSION_V1.to_string(),
            kind: CapabilityKindTag::Capability,
            metadata: Metadata {
                name: "full-capability".to_string(),
                display_name: "Full Capability".to_string(),
                description: "capability with all optional fields populated".to_string(),
                source: Source::User,
                version: "1.2.3".to_string(),
                author: Some("Seven".to_string()),
                author_email: Some("seven@example.com".to_string()),
                icon: Some("📊".to_string()),
                tags: Some(vec!["hr".to_string()]),
                created_at: "2026-05-28T00:00:00Z".to_string(),
                updated_at: Some("2026-05-28T01:00:00Z".to_string()),
                deprecated: Some(false),
                deprecated_reason: Some("none".to_string()),
                homepage: Some("https://example.com/cap".to_string()),
                signature: Some("sig-cap".to_string()),
            },
            spec: CapabilitySpec {
                agent_name: "full-agent".to_string(),
                category: CapabilityCategory::HrScreening,
                order: Some(10),
                badge: Some("new".to_string()),
                color: Some("#ff0000".to_string()),
                context_keys: vec!["session.user".to_string(), "job.id".to_string()],
                entry_prompt: Some("请输入 JD。".to_string()),
                quick_replies: Some(vec!["扎实".to_string(), "上传".to_string()]),
                input_schema: Some(vec![CapabilityInputField {
                    key: "jd_text".to_string(),
                    label: "JD文本".to_string(),
                    r#type: "string".to_string(),
                    default: Some(json!("默认 JD")),
                    options: Some(vec!["a".to_string(), "b".to_string()]),
                }]),
                visibility: Some(CapabilityVisibility {
                    enabled: Some(true),
                    required_feature_flags: Some(vec!["flag.beta".to_string()]),
                    required_roles: Some(vec!["hr-manager".to_string()]),
                }),
            },
        }
    }

    #[test]
    fn capability_yaml_roundtrip() {
        let m = fixture();
        let yaml = serde_yaml::to_string(&m).unwrap();
        let back: CapabilityManifest = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(m, back);
    }

    #[test]
    fn category_kebab_case_serialization() {
        let s = serde_json::to_string(&CapabilityCategory::HrScreening).unwrap();
        assert_eq!(s, "\"hr-screening\"");
    }

    /// Phase B Task 0.9 验收口径：yaml → struct → json → struct → yaml 字段级等价
    fn assert_full_roundtrip(original: CapabilityManifest) {
        let yaml1 = serde_yaml::to_string(&original).unwrap();
        let from_yaml: CapabilityManifest = serde_yaml::from_str(&yaml1).unwrap();
        let json = serde_json::to_string(&from_yaml).unwrap();
        let from_json: CapabilityManifest = serde_json::from_str(&json).unwrap();
        let yaml2 = serde_yaml::to_string(&from_json).unwrap();
        assert_eq!(original, from_yaml, "yaml → struct 丢字段");
        assert_eq!(from_yaml, from_json, "json 中转后 struct 不一致");
        assert_eq!(yaml1, yaml2, "两次 yaml 序列化文本不一致");
    }

    #[test]
    fn capability_full_pipeline_roundtrip_minimal() {
        assert_full_roundtrip(fixture());
    }

    #[test]
    fn capability_full_pipeline_roundtrip_full_fixture() {
        assert_full_roundtrip(fixture_full());
    }
}
