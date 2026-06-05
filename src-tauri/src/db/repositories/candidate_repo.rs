// candidate_repo.rs — CRUD helpers for the `candidates` table

use rusqlite::Connection;
use crate::db::models::candidate::{Candidate, CandidateInput};
use uuid::Uuid;
use chrono::Utc;

pub fn create(conn: &Connection, input: &CandidateInput) -> rusqlite::Result<Candidate> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let status = input.status.clone().unwrap_or_else(|| "pending".to_string());

    conn.execute(
        "INSERT INTO candidates (id, resume_id, project_id, name, phone, email, summary, skills, experience, education, status, source, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        (
            &id,
            &input.resume_id,
            &input.project_id,
            &input.name,
            &input.phone,
            &input.email,
            &input.summary,
            &input.skills,
            &input.experience,
            &input.education,
            &status,
            &input.source,
            &now,
            &now,
        ),
    )?;

    Ok(Candidate {
        id,
        resume_id: input.resume_id.clone(),
        project_id: input.project_id.clone(),
        name: input.name.clone(),
        phone: input.phone.clone(),
        email: input.email.clone(),
        summary: input.summary.clone(),
        skills: input.skills.clone(),
        experience: input.experience.clone(),
        education: input.education.clone(),
        status,
        source: input.source.clone(),
        created_at: now.clone(),
        updated_at: now,
    })
}

pub fn get_by_id(conn: &Connection, id: &str) -> rusqlite::Result<Option<Candidate>> {
    conn.query_row(
        "SELECT id, resume_id, project_id, name, phone, email, summary, skills, experience, education, status, source, created_at, updated_at
         FROM candidates WHERE id = ?",
        [id],
        |row| {
            Ok(Candidate {
                id: row.get(0)?,
                resume_id: row.get(1)?,
                project_id: row.get(2)?,
                name: row.get(3)?,
                phone: row.get(4)?,
                email: row.get(5)?,
                summary: row.get(6)?,
                skills: row.get(7)?,
                experience: row.get(8)?,
                education: row.get(9)?,
                status: row.get(10)?,
                source: row.get(11)?,
                created_at: row.get(12)?,
                updated_at: row.get(13)?,
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

pub fn list_by_project(conn: &Connection, project_id: &str) -> rusqlite::Result<Vec<Candidate>> {
    let mut stmt = conn.prepare(
        "SELECT id, resume_id, project_id, name, phone, email, summary, skills, experience, education, status, source, created_at, updated_at
         FROM candidates
         WHERE project_id = ?
         ORDER BY created_at DESC"
    )?;
    
    let result_iter = stmt.query_map([project_id], |row| {
        Ok(Candidate {
            id: row.get(0)?,
            resume_id: row.get(1)?,
            project_id: row.get(2)?,
            name: row.get(3)?,
            phone: row.get(4)?,
            email: row.get(5)?,
            summary: row.get(6)?,
            skills: row.get(7)?,
            experience: row.get(8)?,
            education: row.get(9)?,
            status: row.get(10)?,
            source: row.get(11)?,
            created_at: row.get(12)?,
            updated_at: row.get(13)?,
        })
    })?;
    
    result_iter.collect()
}

pub fn update(conn: &Connection, id: &str, input: &CandidateInput) -> rusqlite::Result<Candidate> {
    let now = Utc::now().to_rfc3339();

    if let Some(ref name) = input.name {
        conn.execute("UPDATE candidates SET name = ?1, updated_at = ?2 WHERE id = ?3", (name, &now, id))?;
    }
    if let Some(ref phone) = input.phone {
        conn.execute("UPDATE candidates SET phone = ?1, updated_at = ?2 WHERE id = ?3", (phone, &now, id))?;
    }
    if let Some(ref email) = input.email {
        conn.execute("UPDATE candidates SET email = ?1, updated_at = ?2 WHERE id = ?3", (email, &now, id))?;
    }
    if let Some(ref summary) = input.summary {
        conn.execute("UPDATE candidates SET summary = ?1, updated_at = ?2 WHERE id = ?3", (summary, &now, id))?;
    }
    if let Some(ref skills) = input.skills {
        conn.execute("UPDATE candidates SET skills = ?1, updated_at = ?2 WHERE id = ?3", (skills, &now, id))?;
    }
    if let Some(ref experience) = input.experience {
        conn.execute("UPDATE candidates SET experience = ?1, updated_at = ?2 WHERE id = ?3", (experience, &now, id))?;
    }
    if let Some(ref education) = input.education {
        conn.execute("UPDATE candidates SET education = ?1, updated_at = ?2 WHERE id = ?3", (education, &now, id))?;
    }
    if let Some(ref status) = input.status {
        conn.execute("UPDATE candidates SET status = ?1, updated_at = ?2 WHERE id = ?3", (status, &now, id))?;
    }
    if let Some(ref source) = input.source {
        conn.execute("UPDATE candidates SET source = ?1, updated_at = ?2 WHERE id = ?3", (source, &now, id))?;
    }

    conn.execute("UPDATE candidates SET updated_at = ?1 WHERE id = ?2", (&now, id))?;

    get_by_id(conn, id)?.ok_or_else(|| {
        rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_NOTFOUND),
            Some(format!("candidate {} not found after update", id))
        )
    })
}

pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM candidates WHERE id = ?1", [id])?;
    Ok(())
}
