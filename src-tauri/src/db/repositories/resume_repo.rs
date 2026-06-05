// resume_repo.rs — CRUD helpers for the `resumes` table

use rusqlite::Connection;
use crate::db::models::resume::{Resume, ResumeInput};
use uuid::Uuid;
use chrono::Utc;

pub fn create(conn: &Connection, input: &ResumeInput) -> rusqlite::Result<Resume> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let parse_status = input.parse_status.clone().unwrap_or_else(|| "pending".to_string());

    conn.execute(
        "INSERT INTO resumes (id, project_id, file_path, file_name, file_type, parsed_data, parse_status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        (&id, &input.project_id, &input.file_path, &input.file_name, &input.file_type, 
         &input.parsed_data, &parse_status, &now),
    )?;

    Ok(Resume {
        id,
        project_id: input.project_id.clone(),
        file_path: input.file_path.clone(),
        file_name: input.file_name.clone(),
        file_type: input.file_type.clone(),
        parsed_data: input.parsed_data.clone(),
        parse_status,
        created_at: now,
    })
}

pub fn get_by_id(conn: &Connection, id: &str) -> rusqlite::Result<Option<Resume>> {
    conn.query_row(
        "SELECT id, project_id, file_path, file_name, file_type, parsed_data, parse_status, created_at
         FROM resumes WHERE id = ?",
        [id],
        |row| {
            Ok(Resume {
                id: row.get(0)?,
                project_id: row.get(1)?,
                file_path: row.get(2)?,
                file_name: row.get(3)?,
                file_type: row.get(4)?,
                parsed_data: row.get(5)?,
                parse_status: row.get(6)?,
                created_at: row.get(7)?,
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

pub fn list_by_project(conn: &Connection, project_id: &str) -> rusqlite::Result<Vec<Resume>> {
    let mut stmt = conn.prepare(
        "SELECT id, project_id, file_path, file_name, file_type, parsed_data, parse_status, created_at
         FROM resumes
         WHERE project_id = ?
         ORDER BY created_at DESC"
    )?;
    
    let result_iter = stmt.query_map([project_id], |row| {
        Ok(Resume {
            id: row.get(0)?,
            project_id: row.get(1)?,
            file_path: row.get(2)?,
            file_name: row.get(3)?,
            file_type: row.get(4)?,
            parsed_data: row.get(5)?,
            parse_status: row.get(6)?,
            created_at: row.get(7)?,
        })
    })?;
    
    result_iter.collect()
}

pub fn update_parse_status(conn: &Connection, id: &str, status: &str, parsed_data: Option<&str>) -> rusqlite::Result<()> {
    if let Some(data) = parsed_data {
        conn.execute(
            "UPDATE resumes SET parse_status = ?1, parsed_data = ?2 WHERE id = ?3",
            (status, data, id),
        )?;
    } else {
        conn.execute(
            "UPDATE resumes SET parse_status = ?1 WHERE id = ?2",
            (status, id),
        )?;
    }
    Ok(())
}

pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM resumes WHERE id = ?1", [id])?;
    Ok(())
}
