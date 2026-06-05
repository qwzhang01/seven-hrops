//! HSAS Manifest — single source of truth (Rust).
//!
//! The three Manifest kinds (Agent / Skill / Capability) are defined here
//! using `serde` + `schemars` so we can derive:
//!
//!   1. JSON Schema  — via `cargo run --bin gen_manifest_schema`
//!   2. TS types     — via `pnpm run codegen:types` (json-schema-to-typescript)
//!   3. YAML I/O     — via `serde_yaml`
//!
//! Spec reference: doc/agent-architecture/11-HSAS-Spec.md §六.
//!
//! Pipeline: Rust struct (truth) → schemars → JSON Schema (intermediate) →
//! json-schema-to-typescript → `src/types/manifest.generated.ts` (consumer).
//! Editing any struct here MUST be followed by `pnpm run codegen` (which
//! re-emits both `.schema.json` and `.generated.ts`).

pub mod agent;
pub mod capability;
pub mod skill;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

pub use agent::*;
pub use capability::*;
pub use skill::*;

/// `apiVersion` literal — only v1 is supported in Phase B.
pub const API_VERSION_V1: &str = "hsas.seven-hrops/v1";

/// Source of a manifest — controls sandbox fast-path and tool whitelist.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Builtin,
    User,
    Marketplace,
}

/// Permission rule — shared by Agent and certain Skills.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct PermissionRule {
    pub permission: String,
    pub pattern: String,
    pub action: PermissionAction,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum PermissionAction {
    Allow,
    Deny,
    Ask,
}

/// Shared metadata across all three manifest kinds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Metadata {
    pub name: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub description: String,
    pub source: Source,
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub author: Option<String>,
    #[serde(rename = "authorEmail", skip_serializing_if = "Option::is_none", default)]
    pub author_email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub tags: Option<Vec<String>>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt", skip_serializing_if = "Option::is_none", default)]
    pub updated_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub deprecated: Option<bool>,
    #[serde(rename = "deprecatedReason", skip_serializing_if = "Option::is_none", default)]
    pub deprecated_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub homepage: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub signature: Option<String>,
}

/// Discriminated union — useful for callers that don't yet know the kind.
///
/// Serde 采用 `untagged`：不在外部插入额外的 `kind` 辨识字，而是依靠三个
/// 内部的 `kind: AgentKindTag/SkillKindTag/CapabilityKindTag` 字面枚举进行区分。
/// 这样 yaml/json 文档只需一个 `kind` 字段，与 TS 端 `AnyManifest = Agent | Skill | Capability`
/// 的联合类型语义一致。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(untagged)]
pub enum AnyManifest {
    Agent(AgentManifest),
    Skill(SkillManifest),
    Capability(CapabilityManifest),
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Sample fixture used by every kind's roundtrip test.
    fn metadata_fixture() -> Metadata {
        Metadata {
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
        }
    }

    #[test]
    fn metadata_yaml_roundtrip() {
        let m = metadata_fixture();
        let yaml = serde_yaml::to_string(&m).unwrap();
        let back: Metadata = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(m, back);
    }

    #[test]
    fn metadata_json_roundtrip() {
        let m = metadata_fixture();
        let json = serde_json::to_string(&m).unwrap();
        let back: Metadata = serde_json::from_str(&json).unwrap();
        assert_eq!(m, back);
        // displayName / createdAt should be camelCase in serialized form
        assert!(json.contains("\"displayName\""));
        assert!(json.contains("\"createdAt\""));
    }

    #[test]
    fn source_serialization_is_lowercase() {
        let s = serde_json::to_string(&Source::Builtin).unwrap();
        assert_eq!(s, "\"builtin\"");
    }

    /// Phase B Task 0.9: AnyManifest 辨识合集也需保证完整链路双向走通。
    ///
    /// AnyManifest 采用 `untagged`，依靠 `kind: Skill/Agent/Capability` 字面枚举区分。
    /// 这与TS 端 `AnyManifest = Agent | Skill | Capability` 联合类型一致。
    #[test]
    fn any_manifest_roundtrip() {
        // 手工构一个 YAML 文档表示，模拟从磁盘读取的场景。
        let yaml = r#"
kind: Skill
apiVersion: hsas.seven-hrops/v1
metadata:
  name: any-skill
  displayName: Any Skill
  description: any
  source: builtin
  version: 1.0.0
  createdAt: 2026-05-28T00:00:00Z
spec:
  requiredTools:
    - read_file
"#;
        let parsed: AnyManifest = serde_yaml::from_str(yaml).expect("parse AnyManifest");
        match &parsed {
            AnyManifest::Skill(s) => {
                assert_eq!(s.metadata.name, "any-skill");
            }
            _ => panic!("expected Skill variant"),
        }
        // round-trip 一趟，确保不会丢判别字段。
        let json = serde_json::to_string(&parsed).unwrap();
        let back: AnyManifest = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, back);
        // 验证 yaml 双向不丢判别字段
        let yaml_back = serde_yaml::to_string(&parsed).unwrap();
        assert!(yaml_back.contains("kind: Skill"));
    }

    /// Agent 合集路径也走一遍，防止未来变量重复者仅仅验证 Skill。
    #[test]
    fn any_manifest_agent_variant() {
        let yaml = r#"
kind: Agent
apiVersion: hsas.seven-hrops/v1
metadata:
  name: any-agent
  displayName: Any Agent
  description: any
  source: builtin
  version: 1.0.0
  createdAt: 2026-05-28T00:00:00Z
spec:
  mode: primary
  basePrompt: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
  tools:
    allowed:
      - read_file
"#;
        let parsed: AnyManifest = serde_yaml::from_str(yaml).expect("parse AnyManifest agent");
        assert!(matches!(parsed, AnyManifest::Agent(_)));
    }

    /// Capability 合集路径。
    #[test]
    fn any_manifest_capability_variant() {
        let yaml = r#"
kind: Capability
apiVersion: hsas.seven-hrops/v1
metadata:
  name: any-cap
  displayName: Any Capability
  description: any
  source: builtin
  version: 1.0.0
  createdAt: 2026-05-28T00:00:00Z
spec:
  agentName: test-agent
  category: system
  contextKeys:
    - session.user
"#;
        let parsed: AnyManifest = serde_yaml::from_str(yaml).expect("parse AnyManifest cap");
        assert!(matches!(parsed, AnyManifest::Capability(_)));
    }
}
