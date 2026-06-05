// export_record_repo.rs — CRUD helpers for the `export_records` table

use rusqlite::Connection;
use crate::db::models::export_record::{ExportRecord, ExportRecordInput};
use uuid::Uuid;
use chrono::Utc;

pub fn create(conn: &Connection, input: &ExportRecordInput) -> rusqlite::Result<ExportRecord> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let scope = input.scope.clone().unwrap_or_else(|| "all".to_string());

    conn.execute(
        "INSERT INTO export_records (id, project_id, format, file_path, scope, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        (
            &id,
            &input.project_id,
            &input.format,
            &input.file_path,
            &scope,
            &now,
        ),
    )?;

    Ok(ExportRecord {
        id,
        project_id: input.project_id.clone(),
        format: input.format.clone(),
        file_path: input.file_path.clone(),
        scope,
        created_at: now,
    })
}

pub fn list(conn: &Connection, project_id: Option<&str>) -> rusqlite::Result<Vec<ExportRecord>> {
    let result = if let Some(pid) = project_id {
        let mut stmt = conn.prepare(
            "SELECT id, project_id, format, file_path, scope, created_at
             FROM export_records 
             WHERE project_id = ?
             ORDER BY created_at DESC"
        )?;
        
        let result_iter = stmt.query_map([pid], |row| {
            Ok(ExportRecord {
                id: row.get(0)?,
                project_id: row.get(1)?,
                format: row.get(2)?,
                file_path: row.get(3)?,
                scope: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?;
        
        result_iter.collect::<rusqlite::Result<Vec<_>>>()?
    } else {
        let mut stmt = conn.prepare(
            "SELECT id, project_id, format, file_path, scope, created_at
             FROM export_records 
             ORDER BY created_at DESC"
        )?;
        
        let result_iter = stmt.query_map([], |row| {
            Ok(ExportRecord {
                id: row.get(0)?,
                project_id: row.get(1)?,
                format: row.get(2)?,
                file_path: row.get(3)?,
                scope: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?;
        
        result_iter.collect::<rusqlite::Result<Vec<_>>>()?
    };
    
    Ok(result)
}

pub fn get_by_id(conn: &Connection, id: &str) -> rusqlite::Result<Option<ExportRecord>> {
    conn.query_row(
        "SELECT id, project_id, format, file_path, scope, created_at
         FROM export_records WHERE id = ?",
        [id],
        |row| {
            Ok(ExportRecord {
                id: row.get(0)?,
                project_id: row.get(1)?,
                format: row.get(2)?,
                file_path: row.get(3)?,
                scope: row.get(4)?,
                created_at: row.get(5)?,
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

pub fn update_status(conn: &Connection, id: &str, status: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE export_records SET status = ?1 WHERE id = ?2",
        (status, id),
    )?;
    Ok(())
}

pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM export_records WHERE id = ?1",
        [id],
    )?;
    Ok(())
}
