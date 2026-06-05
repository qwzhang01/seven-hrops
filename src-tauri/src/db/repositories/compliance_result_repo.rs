// compliance_result_repo.rs — CRUD helpers for the `compliance_results` table

use rusqlite::Connection;
use crate::db::models::compliance_result::{ComplianceResult, ComplianceResultInput};
use uuid::Uuid;
use chrono::Utc;

pub fn save(conn: &Connection, input: &ComplianceResultInput) -> rusqlite::Result<ComplianceResult> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let status = input.status.clone().unwrap_or_else(|| "pending".to_string());

    conn.execute(
        "INSERT INTO compliance_results (id, resume_id, jd_id, issues, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        (
            &id,
            &input.resume_id,
            &input.jd_id,
            &input.issues,
            &status,
            &now,
        ),
    )?;

    Ok(ComplianceResult {
        id,
        resume_id: input.resume_id.clone(),
        jd_id: input.jd_id.clone(),
        issues: input.issues.clone(),
        status,
        created_at: now,
    })
}

pub fn get_by_id(conn: &Connection, id: &str) -> rusqlite::Result<Option<ComplianceResult>> {
    conn.query_row(
        "SELECT id, resume_id, jd_id, issues, status, created_at
         FROM compliance_results WHERE id = ?",
        [id],
        |row| {
            Ok(ComplianceResult {
                id: row.get(0)?,
                resume_id: row.get(1)?,
                jd_id: row.get(2)?,
                issues: row.get(3)?,
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

pub fn list_by_project(conn: &Connection, project_id: &str) -> rusqlite::Result<Vec<ComplianceResult>> {
    let mut stmt = conn.prepare(
        "SELECT cr.id, cr.resume_id, cr.jd_id, cr.issues, cr.status, cr.created_at
         FROM compliance_results cr
         JOIN resumes r ON cr.resume_id = r.id
         WHERE r.project_id = ?
         ORDER BY cr.created_at DESC"
    )?;
    
    let result_iter = stmt.query_map([project_id], |row| {
        Ok(ComplianceResult {
            id: row.get(0)?,
            resume_id: row.get(1)?,
            jd_id: row.get(2)?,
            issues: row.get(3)?,
            status: row.get(4)?,
            created_at: row.get(5)?,
        })
    })?;
    
    result_iter.collect()
}

pub fn update_note(conn: &Connection, id: &str, issues: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE compliance_results SET issues = ?1 WHERE id = ?2",
        (issues, id),
    )?;
    Ok(())
}

pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM compliance_results WHERE id = ?1",
        [id],
    )?;
    Ok(())
}
