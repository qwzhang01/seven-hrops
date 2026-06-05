// ============================================================
// manifest_io.rs — Phase 0 platform-foundation IO commands.
//
// Spec: openspec/changes/platform-foundation-mvb/specs/builtin-seed-bootstrap/spec.md
//
// These three commands are *骨架* (skeleton) only — they expose the contract
// that Phase 1 will implement against. In Phase 0 we deliberately keep them
// inert so the platform layer can compile against the IPC surface area
// without coupling to the user-manifest persistence story.
//
// IMPORTANT: bootstrap.ts (frontend) does NOT call these commands during
// MVB. They exist solely so the SQLite migration can be exercised, the
// frontend type contract can be authored, and Phase 1 can fill in bodies
// without breaking the IPC surface.
// ============================================================

use serde::{Deserialize, Serialize};

/// Bundle of user-installed manifests returned by `load_user_manifests`.
///
/// In Phase 1 this will be filled in by querying the v2 SQLite tables.
/// In Phase 0 we always return an empty bundle.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct UserManifests {
    pub agents: Vec<String>,
    pub skills: Vec<String>,
    pub capabilities: Vec<String>,
}

/// Load all user-installed manifests from SQLite.
///
/// Phase 0: returns an empty UserManifests struct.
/// Phase 1: queries `agent_manifests` / `skill_manifests` / `capabilities`.
#[tauri::command]
pub async fn load_user_manifests() -> Result<UserManifests, String> {
    Ok(UserManifests::default())
}

/// Install a single manifest into SQLite. The frontend pre-validates the
/// payload through `manifestValidator.ts`; this command is purely the
/// persistence step.
///
/// Phase 0: no-op, returns Ok(()) so the frontend type contract is honoured.
/// Phase 1: routes by `kind` to the appropriate INSERT / UPDATE statement.
#[tauri::command]
pub async fn install_user_manifest(
    kind: String,
    name: String,
    manifest_json: String,
) -> Result<(), String> {
    let _ = (kind, name, manifest_json); // silence unused-warning in Phase 0
    Ok(())
}

/// Uninstall a manifest by kind + name.
///
/// Phase 0: no-op.
/// Phase 1: DELETEs the row, archives it into `manifest_history`, and
///          enforces the `capabilities.agent_name FK ON DELETE RESTRICT`.
#[tauri::command]
pub async fn uninstall_user_manifest(kind: String, name: String) -> Result<(), String> {
    let _ = (kind, name);
    Ok(())
}

#[cfg(test)]
mod tests {
    use rusqlite::{Connection, Error as SqlError, ErrorCode};

    /// Helper: spin up an in-memory SQLite, enable foreign keys, and run the
    /// v2 migration script.
    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory sqlite");
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        let sql = include_str!("../db/migrations/002_capabilities.sql");
        conn.execute_batch(sql).expect("apply v2 migration");
        conn
    }

    #[test]
    fn migration_creates_all_four_tables() {
        let conn = setup_db();
        let mut stmt = conn
            .prepare(
                "SELECT name FROM sqlite_master WHERE type='table' \
                 AND name IN ('agent_manifests','skill_manifests','capabilities','manifest_history') \
                 ORDER BY name",
            )
            .unwrap();
        let names: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        assert_eq!(
            names,
            vec![
                "agent_manifests",
                "capabilities",
                "manifest_history",
                "skill_manifests",
            ]
        );
    }

    #[test]
    fn capabilities_fk_rejects_unknown_agent() {
        let conn = setup_db();
        // Insert a capability that references an agent_name that does not
        // exist in agent_manifests. With foreign_keys=ON this MUST fail.
        let result = conn.execute(
            "INSERT INTO capabilities \
             (name, display_name, agent_name, source, enabled, manifest, installed_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                "ghost-cap",
                "Ghost",
                "non-existent-agent",
                "user",
                1,
                "{}",
                "2026-05-27T00:00:00Z",
            ],
        );
        assert!(result.is_err(), "expected FK violation");
        match result.unwrap_err() {
            SqlError::SqliteFailure(err, _) => {
                assert_eq!(err.code, ErrorCode::ConstraintViolation);
            }
            other => panic!("unexpected error: {other:?}"),
        }
    }

    #[test]
    fn capabilities_fk_accepts_known_agent() {
        let conn = setup_db();
        conn.execute(
            "INSERT INTO agent_manifests \
             (name, display_name, source, version, manifest, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                "my-agent",
                "My Agent",
                "user",
                "1.0.0",
                "{}",
                "2026-05-27T00:00:00Z",
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO capabilities \
             (name, display_name, agent_name, source, enabled, manifest, installed_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                "my-cap",
                "My Cap",
                "my-agent",
                "user",
                1,
                "{}",
                "2026-05-27T00:00:00Z",
            ],
        )
        .expect("insert with valid FK should succeed");
    }

    #[test]
    fn source_check_rejects_builtin() {
        let conn = setup_db();
        let result = conn.execute(
            "INSERT INTO agent_manifests \
             (name, display_name, source, version, manifest, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                "ghost",
                "Ghost",
                "builtin",
                "1.0.0",
                "{}",
                "2026-05-27T00:00:00Z",
            ],
        );
        assert!(result.is_err(), "source='builtin' must fail CHECK");
    }
}
