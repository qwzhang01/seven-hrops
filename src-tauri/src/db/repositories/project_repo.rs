// project_repo.rs — CRUD helpers for the `projects` table

use rusqlite::Connection;
use crate::db::models::project::{Project, ProjectInput};
use uuid::Uuid;
use chrono::Utc;

pub fn create(conn: &Connection, input: &ProjectInput) -> rusqlite::Result<Project> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let name = input.name.clone().unwrap_or_else(|| "Untitled Project".to_string());
    let task_type = input.task_type.clone().unwrap_or_else(|| "recruitment".to_string());

    conn.execute(
        "INSERT INTO projects (id, name, task_type, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        (&id, &name, &task_type, &now, &now),
    )?;

    Ok(Project {
        id,
        name,
        task_type,
        created_at: now.clone(),
        updated_at: now,
    })
}

pub fn list(conn: &Connection) -> rusqlite::Result<Vec<Project>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, task_type, created_at, updated_at
         FROM projects
         ORDER BY created_at DESC"
    )?;
    
    let result_iter = stmt.query_map([], |row| {
        Ok(Project {
            id: row.get(0)?,
            name: row.get(1)?,
            task_type: row.get(2)?,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
        })
    })?;
    
    result_iter.collect()
}

pub fn get_by_id(conn: &Connection, id: &str) -> rusqlite::Result<Option<Project>> {
    conn.query_row(
        "SELECT id, name, task_type, created_at, updated_at
         FROM projects WHERE id = ?",
        [id],
        |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                task_type: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
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

pub fn update(conn: &Connection, id: &str, input: &ProjectInput) -> rusqlite::Result<Project> {
    let now = Utc::now().to_rfc3339();

    if let Some(ref name) = input.name {
        conn.execute(
            "UPDATE projects SET name = ?1, updated_at = ?2 WHERE id = ?3",
            (name, &now, id),
        )?;
    }
    
    if let Some(ref task_type) = input.task_type {
        conn.execute(
            "UPDATE projects SET task_type = ?1, updated_at = ?2 WHERE id = ?3",
            (task_type, &now, id),
        )?;
    }
    
    // Always bump updated_at
    conn.execute(
        "UPDATE projects SET updated_at = ?1 WHERE id = ?2",
        (&now, id),
    )?;

    get_by_id(conn, id)?.ok_or_else(|| {
        rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_NOTFOUND),
            Some(format!("project {} not found after update", id))
        )
    })
}

pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM projects WHERE id = ?1", [id])?;
    Ok(())
}
