// migrations.rs — Versioned SQLite migrations for seven-hrops
//
// Design:
//   - Migrations are embedded at compile time via `include_str!`.
//   - `user_version` pragma is used to track the currently applied version.
//   - On startup we run every pending migration (version > current user_version)
//     in order, then set `user_version` to the highest applied version.
//   - All migrations are idempotent (use `CREATE TABLE IF NOT EXISTS` etc.)
//
// Migration files live in `src-tauri/src/db/migrations/` and follow the
// naming convention `<NNN>_<description>.sql` (e.g. `001_initial_tables.sql`).

use rusqlite::Connection;

/// Run all pending migrations against `conn`.
///
/// This is called once during `connection::init_db()`, so it runs on every
/// app startup.  Already-applied migrations are skipped thanks to `user_version`.
pub fn run_migrations(conn: &Connection) -> rusqlite::Result<()> {
    let current_version: i32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;

    // Embedded migration SQL sorted by version number.
    // When you add a new migration, append a new `include_str!` entry
    // and bump the version number.
    let migrations: &[(&str, &str)] = &[
        // Version 1 — 8 business tables (projects … event_logs)
        //   Source: former drizzle/0000_green_vindicator.sql
        ("001_initial_tables.sql", include_str!("migrations/001_initial_tables.sql")),
        // Version 2 — 4 platform tables (agent_manifests … manifest_history)
        //   Source: former src-tauri/migrations/v2_capabilities.sql
        ("002_capabilities.sql", include_str!("migrations/002_capabilities.sql")),
        // Version 3 — sessions & messages tables for persistent chat storage
        //   Source: arch-session-db-persistence change
        ("003_sessions_and_messages.sql", include_str!("migrations/003_sessions_and_messages.sql")),
    ];

    for (idx, (filename, sql)) in migrations.iter().enumerate() {
        let version = (idx + 1) as i32;
        if version <= current_version {
            log::debug!("[DB] Migration {version} ({filename}) already applied, skipping.");
            continue;
        }

        log::info!("[DB] Applying migration {version}: {filename}");
        conn.execute_batch(sql)
            .map_err(|e| {
                log::error!("[DB] Migration {version} ({filename}) failed: {e}");
                e
            })?;

        conn.pragma_update(None, "user_version", &version)?;
        log::info!("[DB] Migration {version} ({filename}) applied successfully.");
    }

    Ok(())
}
