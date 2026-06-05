// screening_result_repo.rs — CRUD helpers for the `screening_results` table

use rusqlite::Connection;
use crate::db::models::screening_result::{ScreeningResult, ScreeningResultInput};
use uuid::Uuid;
use chrono::Utc;

/// Save (insert or update) a screening result.
/// We use `INSERT … ON CONFLICT(id) DO UPDATE` so the same
/// (project_id, candidate_id) pair can be re-scored without dupes.
/// For simplicity we always INSERT with a fresh UUID and let the
/// caller decide whether to check for an existing row first.
pub fn save(conn: &Connection, input: &ScreeningResultInput) -> rusqlite::Result<ScreeningResult> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let status = input.status.clone().unwrap_or_else(|| "pending".to_string());
    let shortlisted = input.shortlisted.unwrap_or(false);

    conn.execute(
        "INSERT INTO screening_results (id, project_id, candidate_id, score, dimensions, reasoning, level, status, notes, shortlisted, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        (
            &id,
            &input.project_id,
            &input.candidate_id,
            &input.score,
            &input.dimensions,
            &input.reasoning,
            &input.level,
            &status,
            &input.notes,
            &shortlisted,
            &now,
        ),
    )?;

    Ok(ScreeningResult {
        id,
        project_id: input.project_id.clone(),
        candidate_id: input.candidate_id.clone(),
        score: input.score,
        dimensions: input.dimensions.clone(),
        reasoning: input.reasoning.clone(),
        level: input.level.clone(),
        status,
        notes: input.notes.clone(),
        shortlisted,
        created_at: now,
    })
}

pub fn get_by_id(conn: &Connection, id: &str) -> rusqlite::Result<Option<ScreeningResult>> {
    conn.query_row(
        "SELECT id, project_id, candidate_id, score, dimensions, reasoning, level, status, notes, shortlisted, created_at
         FROM screening_results WHERE id = ?",
        [id],
        |row| {
            Ok(ScreeningResult {
                id: row.get(0)?,
                project_id: row.get(1)?,
                candidate_id: row.get(2)?,
                score: row.get(3)?,
                dimensions: row.get(4)?,
                reasoning: row.get(5)?,
                level: row.get(6)?,
                status: row.get(7)?,
                notes: row.get(8)?,
                shortlisted: row.get(9)?,
                created_at: row.get(10)?,
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

pub fn list_by_project(conn: &Connection, project_id: &str) -> rusqlite::Result<Vec<ScreeningResult>> {
    let mut stmt = conn.prepare(
        "SELECT id, project_id, candidate_id, score, dimensions, reasoning, level, status, notes, shortlisted, created_at
         FROM screening_results 
         WHERE project_id = ?
         ORDER BY created_at DESC"
    )?;
    
    let result_iter = stmt.query_map([project_id], |row| {
        Ok(ScreeningResult {
            id: row.get(0)?,
            project_id: row.get(1)?,
            candidate_id: row.get(2)?,
            score: row.get(3)?,
            dimensions: row.get(4)?,
            reasoning: row.get(5)?,
            level: row.get(6)?,
            status: row.get(7)?,
            notes: row.get(8)?,
            shortlisted: row.get(9)?,
            created_at: row.get(10)?,
        })
    })?;
    
    result_iter.collect()
}

/// Update the note / shortlisted flag / status of an existing screening result.
pub fn update_note(conn: &Connection, id: &str, notes: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE screening_results SET notes = ?1 WHERE id = ?2",
        (notes, id),
    )?;
    Ok(())
}

pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM screening_results WHERE id = ?1",
        [id],
    )?;
    Ok(())
}
