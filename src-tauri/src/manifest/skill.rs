//! Skill manifest — see HSAS Spec §六.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::Metadata;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct SkillInput {
    pub key: String,
    #[serde(rename = "type")]
    pub r#type: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub required: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct SkillOutputs {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub schema: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum SkillLoadStrategy {
    Eager,
    Lazy,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct SkillSpec {
    #[serde(rename = "applicableAgents", skip_serializing_if = "Option::is_none", default)]
    pub applicable_agents: Option<Vec<String>>,
    #[serde(rename = "applicableCapabilities", skip_serializing_if = "Option::is_none", default)]
    pub applicable_capabilities: Option<Vec<String>>,
    #[serde(rename = "requiredTools")]
    pub required_tools: Vec<String>,
    #[serde(rename = "requiredSkills", skip_serializing_if = "Option::is_none", default)]
    pub required_skills: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub resources: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub inputs: Option<Vec<SkillInput>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub outputs: Option<SkillOutputs>,
    #[serde(rename = "loadStrategy", skip_serializing_if = "Option::is_none", default)]
    pub load_strategy: Option<SkillLoadStrategy>,
    #[serde(rename = "triggerKeywords", skip_serializing_if = "Option::is_none", default)]
    pub trigger_keywords: Option<Vec<String>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub enum SkillKindTag {
    Skill,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct SkillManifest {
    #[serde(rename = "apiVersion")]
    pub api_version: String,
    pub kind: SkillKindTag,
    pub metadata: Metadata,
    pub spec: SkillSpec,
    /// SKILL.md body (Markdown). Optional — sidecar `.SKILL.md` file overrides.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub body: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::super::*;
    use super::*;

    fn fixture() -> SkillManifest {
        SkillManifest {
            api_version: API_VERSION_V1.to_string(),
            kind: SkillKindTag::Skill,
            metadata: Metadata {
                name: "test-skill".to_string(),
                display_name: "Test Skill".to_string(),
                description: "test skill".to_string(),
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
            spec: SkillSpec {
                applicable_agents: None,
                applicable_capabilities: None,
                required_tools: vec!["read_file".to_string()],
                required_skills: None,
                resources: None,
                inputs: None,
                outputs: None,
                load_strategy: Some(SkillLoadStrategy::Eager),
                trigger_keywords: None,
            },
            body: Some("# Skill body\n\nHello.".to_string()),
        }
    }

    fn fixture_full() -> SkillManifest {
        SkillManifest {
            api_version: API_VERSION_V1.to_string(),
            kind: SkillKindTag::Skill,
            metadata: Metadata {
                name: "full-skill".to_string(),
                display_name: "Full Skill".to_string(),
                description: "skill with all optional fields populated".to_string(),
                source: Source::Marketplace,
                version: "3.0.1".to_string(),
                author: Some("Seven".to_string()),
                author_email: Some("seven@example.com".to_string()),
                icon: Some("🧪".to_string()),
                tags: Some(vec!["resume".to_string()]),
                created_at: "2026-05-28T00:00:00Z".to_string(),
                updated_at: Some("2026-05-28T01:00:00Z".to_string()),
                deprecated: Some(false),
                deprecated_reason: Some("none".to_string()),
                homepage: Some("https://example.com/skills/full".to_string()),
                signature: Some("sig-abc".to_string()),
            },
            spec: SkillSpec {
                applicable_agents: Some(vec!["test-agent".to_string()]),
                applicable_capabilities: Some(vec!["test-capability".to_string()]),
                required_tools: vec!["read_file".to_string(), "parse_pdf".to_string()],
                required_skills: Some(vec!["helper-skill".to_string()]),
                resources: Some(vec!["~/.seven-hrops/templates/cv.docx".to_string()]),
                inputs: Some(vec![SkillInput {
                    key: "resume_path".to_string(),
                    r#type: "string".to_string(),
                    required: Some(true),
                }]),
                outputs: Some(SkillOutputs {
                    schema: Some("resume.schema.json".to_string()),
                }),
                load_strategy: Some(SkillLoadStrategy::Lazy),
                trigger_keywords: Some(vec!["筛简历".to_string()]),
            },
            body: Some("# Full Skill\n\nFull body markdown.".to_string()),
        }
    }

    #[test]
    fn skill_yaml_roundtrip() {
        let m = fixture();
        let yaml = serde_yaml::to_string(&m).unwrap();
        let back: SkillManifest = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(m, back);
    }

    #[test]
    fn skill_load_strategy_lowercase() {
        let s = serde_json::to_string(&SkillLoadStrategy::Eager).unwrap();
        assert_eq!(s, "\"eager\"");
    }

    /// Phase B Task 0.9 验收口径：yaml → struct → json → struct → yaml 字段级等价
    fn assert_full_roundtrip(original: SkillManifest) {
        let yaml1 = serde_yaml::to_string(&original).unwrap();
        let from_yaml: SkillManifest = serde_yaml::from_str(&yaml1).unwrap();
        let json = serde_json::to_string(&from_yaml).unwrap();
        let from_json: SkillManifest = serde_json::from_str(&json).unwrap();
        let yaml2 = serde_yaml::to_string(&from_json).unwrap();
        assert_eq!(original, from_yaml, "yaml → struct 丢字段");
        assert_eq!(from_yaml, from_json, "json 中转后 struct 不一致");
        assert_eq!(yaml1, yaml2, "两次 yaml 序列化文本不一致");
    }

    #[test]
    fn skill_full_pipeline_roundtrip_minimal() {
        assert_full_roundtrip(fixture());
    }

    #[test]
    fn skill_full_pipeline_roundtrip_full_fixture() {
        assert_full_roundtrip(fixture_full());
    }
}
