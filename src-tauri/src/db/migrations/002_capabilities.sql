-- 002_capabilities.sql
--
-- Phase 0 platform foundation tables
-- Source: former src-tauri/migrations/v2_capabilities.sql
-- Idempotent: all CREATE TABLE are IF NOT EXISTS.

-- 1. agent_manifests
CREATE TABLE IF NOT EXISTS agent_manifests (
    name         TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    source       TEXT NOT NULL CHECK(source IN ('user','marketplace')),
    version      TEXT NOT NULL,
    manifest     TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    updated_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_source ON agent_manifests(source);

-- 2. skill_manifests
CREATE TABLE IF NOT EXISTS skill_manifests (
    name       TEXT PRIMARY KEY,
    source     TEXT NOT NULL CHECK(source IN ('user','marketplace')),
    version    TEXT NOT NULL,
    manifest   TEXT NOT NULL,
    body       TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_skill_source ON skill_manifests(source);

-- 3. capabilities
CREATE TABLE IF NOT EXISTS capabilities (
    name          TEXT PRIMARY KEY,
    display_name  TEXT NOT NULL,
    agent_name    TEXT NOT NULL,
    source        TEXT NOT NULL CHECK(source IN ('user','marketplace')),
    enabled       INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
    manifest      TEXT NOT NULL,
    installed_at  TEXT NOT NULL,
    FOREIGN KEY (agent_name) REFERENCES agent_manifests(name) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_capability_enabled ON capabilities(enabled);
CREATE INDEX IF NOT EXISTS idx_capability_source  ON capabilities(source);

-- 4. manifest_history
CREATE TABLE IF NOT EXISTS manifest_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kind        TEXT NOT NULL CHECK(kind IN ('Agent','Skill','Capability')),
    name        TEXT NOT NULL,
    version     TEXT NOT NULL,
    manifest    TEXT NOT NULL,
    archived_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_history_lookup ON manifest_history(kind, name);
