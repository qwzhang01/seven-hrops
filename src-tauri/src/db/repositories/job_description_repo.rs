// job_description_repo.rs — CRUD helpers for the `job_descriptions` table

use rusqlite::Connection;
use crate::db::models::job_description::{JobDescription, JobDescriptionInput};
use uuid::Uuid;
use chrono::Utc;

pub fn create(conn: &Connection, input: &JobDescriptionInput) -> rusqlite::Result<JobDescription> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let status = input.status.clone().unwrap_or_else(|| "draft".to_string());

    conn.execute(
        "INSERT INTO job_descriptions (id, project_id, raw_text, parsed_data, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        (&id, &input.project_id, &input.raw_text, &input.parsed_data, &status, &now),
    )?;

    Ok(JobDescription {
        id,
        project_id: input.project_id.clone(),
        raw_text: input.raw_text.clone(),
        parsed_data: input.parsed_data.clone(),
        status,
        created_at: now,
    })
}

pub fn get_by_id(conn: &Connection, id: &str) -> rusqlite::Result<Option<JobDescription>> {
    conn.query_row(
        "SELECT id, project_id, raw_text, parsed_data, status, created_at
         FROM job_descriptions WHERE id = ?",
        [id],
        |row| {
            Ok(JobDescription {
                id: row.get(0)?,
                project_id: row.get(1)?,
                raw_text: row.get(2)?,
                parsed_data: row.get(3)?,
                status: row.get(4)?,
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

pub fn update(conn: &Connection, id: &str, input: &JobDescriptionInput) -> rusqlite::Result<JobDescription> {
    let now = Utc::now().to_rfc3339();

    if let Some(ref raw_text) = input.raw_text {
        conn.execute(
            "UPDATE job_descriptions SET raw_text = ?1, updated_at = ?2 WHERE id = ?3",
            (raw_text, &now, id),
        )?;
    }
    
    if let Some(ref parsed_data) = input.parsed_data {
        conn.execute(
            "UPDATE job_descriptions SET parsed_data = ?1, updated_at = ?2 WHERE id = ?3",
            (parsed_data, &now, id),
        )?;
    }
    
    if let Some(ref status) = input.status {
        conn.execute(
            "UPDATE job_descriptions SET status = ?1, updated_at = ?2 WHERE id = ?3",
            (status, &now, id),
        )?;
    }

    get_by_id(conn, id)?.ok_or_else(|| {
        rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_NOTFOUND),
            Some(format!("job description {} not found after update", id))
        )
    })
}

pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM job_descriptions WHERE id = ?1", [id])?;
    Ok(())
}

pub fn list_by_project(conn: &Connection, project_id: &str) -> rusqlite::Result<Vec<JobDescription>> {
    let mut stmt = conn.prepare(
        "SELECT id, project_id, raw_text, parsed_data, status, created_at
         FROM job_descriptions
         WHERE project_id = ?
         ORDER BY created_at DESC"
    )?;
    
    let result_iter = stmt.query_map([project_id], |row| {
        Ok(JobDescription {
            id: row.get(0)?,
            project_id: row.get(1)?,
            raw_text: row.get(2)?,
            parsed_data: row.get(3)?,
            status: row.get(4)?,
            created_at: row.get(5)?,
        })
    })?;
    
    result_iter.collect()
}
