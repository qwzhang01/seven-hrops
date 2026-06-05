// event_log_repo.rs — CRUD helpers for the `event_logs` table

use rusqlite::Connection;
use crate::db::models::event_log::{EventLog, EventLogInput};
use uuid::Uuid;
use chrono::Utc;

pub fn create(conn: &Connection, input: &EventLogInput) -> rusqlite::Result<EventLog> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO event_logs (id, event_type, payload, created_at)
         VALUES (?1, ?2, ?3, ?4)",
        (
            &id,
            &input.event_type,
            &input.payload,
            &now,
        ),
    )?;

    Ok(EventLog {
        id,
        event_type: input.event_type.clone(),
        payload: input.payload.clone(),
        created_at: now,
    })
}

pub fn list(
    conn: &Connection,
    project_id: Option<&str>,
    event_type: Option<&str>,
    limit: Option<i64>,
) -> rusqlite::Result<Vec<EventLog>> {
    let mut sql = String::from(
        "SELECT id, event_type, payload, created_at
         FROM event_logs WHERE 1=1"
    );

    if project_id.is_some() {
        sql.push_str(" AND payload LIKE '%\"project_id\":\"' || ? || '\"%'");
    }
    if event_type.is_some() {
        sql.push_str(" AND event_type = ?");
    }

    sql.push_str(" ORDER BY created_at DESC");

    if let Some(l) = limit {
        sql.push_str(&format!(" LIMIT {}", l));
    }

    let mut stmt = conn.prepare(&sql)?;

    // Build params vec dynamically to avoid closure type mismatch in if/else branches.
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    if let Some(pid) = project_id {
        params.push(Box::new(pid.to_string()));
    }
    if let Some(et) = event_type {
        params.push(Box::new(et.to_string()));
    }

    let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();

    let rows = stmt.query_map(param_refs.as_slice(), |row| {
        Ok(EventLog {
            id: row.get(0)?,
            event_type: row.get(1)?,
            payload: row.get(2)?,
            created_at: row.get(3)?,
        })
    })?;

    rows.collect()
}

pub fn get_by_id(conn: &Connection, id: &str) -> rusqlite::Result<Option<EventLog>> {
    conn.query_row(
        "SELECT id, event_type, payload, created_at
         FROM event_logs WHERE id = ?",
        [id],
        |row| {
            Ok(EventLog {
                id: row.get(0)?,
                event_type: row.get(1)?,
                payload: row.get(2)?,
                created_at: row.get(3)?,
            })
        },
    )
    .map(Some)
    .or_else(|e| {
        if e == rusqlite::Error::QueryReturnedNoRows {
            Ok(None)
        } else {
            Err(e)
        }
    })
}

pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM event_logs WHERE id = ?1",
        [id],
    )?;
    Ok(())
}

pub fn delete_older_than(conn: &Connection, timestamp: &str) -> rusqlite::Result<usize> {
    Ok(conn.execute(
        "DELETE FROM event_logs WHERE created_at < ?1",
        [timestamp],
    )?)
}
