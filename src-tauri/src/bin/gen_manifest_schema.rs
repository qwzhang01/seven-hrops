//! `gen_manifest_schema` — generate JSON Schema files from Rust manifest structs.
//!
//! Outputs three files under `<workspace>/platform/schemas/`:
//!   - agent.schema.json
//!   - skill.schema.json
//!   - capability.schema.json
//!
//! Run via:  `cargo run --bin gen_manifest_schema --manifest-path src-tauri/Cargo.toml`
//!
//! The generated files MUST be committed to git. CI re-runs this binary and
//! does `git diff --exit-code platform/schemas` to ensure the source-of-truth
//! has not drifted from the structs.

use schemars::schema_for;
use seven_hrops_lib::manifest::{AgentManifest, CapabilityManifest, SkillManifest};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

/// Marker injected at the schema root via the JSON Schema `$comment` keyword,
/// which validators MUST ignore (RFC draft-bhutton-json-schema-00 §8.3).
/// We deliberately do NOT prepend `//` line comments, because the resulting
/// file would no longer be valid JSON and downstream consumers (VSCode YAML
/// plugin, ajv, json-schema-to-typescript) would fail to parse it.
const DO_NOT_EDIT: &str =
    "AUTO-GENERATED — DO NOT EDIT. Run `pnpm run codegen` to regenerate from src-tauri/src/manifest/*.rs";

fn workspace_root() -> PathBuf {
    // CARGO_MANIFEST_DIR points at src-tauri/, parent is workspace root.
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("workspace root")
        .to_path_buf()
}

fn write_schema<T: schemars::JsonSchema>(out_path: PathBuf, label: &str) {
    let schema = schema_for!(T);
    let mut value = serde_json::to_value(&schema).expect("serialize schema");
    // Inject `$comment` at the root so the file remains valid JSON.
    if let Value::Object(ref mut map) = value {
        map.insert("$comment".to_string(), Value::String(DO_NOT_EDIT.to_string()));
    }
    let body = serde_json::to_string_pretty(&value).expect("pretty schema");
    if let Some(parent) = out_path.parent() {
        fs::create_dir_all(parent).expect("create schemas dir");
    }
    fs::write(&out_path, format!("{body}\n")).unwrap_or_else(|e| {
        panic!("write {} failed: {}", out_path.display(), e);
    });
    println!("[gen_manifest_schema] wrote {}: {}", label, out_path.display());
}

fn main() {
    let root = workspace_root();
    let dir = root.join("platform").join("schemas");

    write_schema::<AgentManifest>(dir.join("agent.schema.json"), "Agent");
    write_schema::<SkillManifest>(dir.join("skill.schema.json"), "Skill");
    write_schema::<CapabilityManifest>(dir.join("capability.schema.json"), "Capability");

    println!("[gen_manifest_schema] done.");
}
