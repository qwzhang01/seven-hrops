// connection.rs — SQLite connection management for seven-hrops
//
// Design notes (see openspec/changes/arch-db-rust-only/design.md):
//   - Desktop app ⇒ single user ⇒ no connection pool needed.
//   - `rusqlite` with `bundled` feature compiles SQLite into the binary.
//   - Connection is wrapped in `Mutex<Connection>` and registered as
//     Tauri managed state so every command handler can borrow it.
//   - PRAGMAs are set once at open time:
//       journal_mode=WAL   — concurrent reads without blocking writes
//       foreign_keys=ON    — referential integrity
//       busy_timeout=5000  — wait up to 5 s if DB is locked

use std::sync::Mutex;
use rusqlite::Connection;
use tauri::Manager;

/// Tauri managed state: a single guarded SQLite connection.
pub struct DbState(pub Mutex<Connection>);

/// Open (or create) the SQLite database file and apply Pragmas.
///
/// # Errors
/// Returns `rusqlite::Error` if the file cannot be opened or a PRAGMA fails.
pub fn open_connection(db_path: &std::path::Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(db_path)?;

    // Enable WAL mode for better concurrent read/write performance.
    conn.pragma_update(None, "journal_mode", &"WAL")?;

    // Enforce foreign-key constraints.
    conn.pragma_update(None, "foreign_keys", &"ON")?;

    // Wait up to 5 seconds if the database is locked by another writer.
    conn.pragma_update(None, "busy_timeout", &"5000")?;

    Ok(conn)
}

/// Initialise the database connection and register it as Tauri managed state.
///
/// Call this inside `tauri::Builder::default().setup(|app| { ... })`.
///
/// # Panics
/// Panics if the app data directory cannot be resolved or the DB cannot be opened.
/// This is intentional: the app cannot function without a database.
pub fn init_db(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let app_data_dir = app.path().app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?;

    // Ensure the directory exists.
    std::fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("failed to create app data dir: {e}"))?;

    let db_path = app_data_dir.join("seven-hrops.db");

    let conn = open_connection(&db_path)
        .map_err(|e| format!("failed to open database at {}: {e}", db_path.display()))?;

    // Run migrations on every startup (idempotent — checks user_version).
    crate::db::migrations::run_migrations(&conn)
        .map_err(|e| format!("database migration failed: {e}"))?;

    app.manage(DbState(Mutex::new(conn)));

    log::info!(
        "[DB] Connection initialised at {}",
        db_path.display()
    );

    Ok(())
}
