-- 001_initial_tables.sql
--
-- Initial business tables for Seven HROps
-- Source: former drizzle/0000_green_vindicator.sql
-- Idempotent: all CREATE TABLE are IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS `projects` (
    `id` text PRIMARY KEY NOT NULL,
    `name` text NOT NULL,
    `task_type` text DEFAULT 'recruitment' NOT NULL,
    `created_at` text DEFAULT (datetime('now')) NOT NULL,
    `updated_at` text DEFAULT (datetime('now')) NOT NULL
);

CREATE TABLE IF NOT EXISTS `job_descriptions` (
    `id` text PRIMARY KEY NOT NULL,
    `project_id` text NOT NULL,
    `raw_text` text,
    `parsed_data` text,
    `status` text DEFAULT 'draft' NOT NULL,
    `created_at` text DEFAULT (datetime('now')) NOT NULL,
    FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE IF NOT EXISTS `resumes` (
    `id` text PRIMARY KEY NOT NULL,
    `project_id` text NOT NULL,
    `file_path` text,
    `file_name` text NOT NULL,
    `file_type` text NOT NULL,
    `parsed_data` text,
    `parse_status` text DEFAULT 'pending' NOT NULL,
    `created_at` text DEFAULT (datetime('now')) NOT NULL,
    FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE IF NOT EXISTS `candidates` (
    `id` text PRIMARY KEY NOT NULL,
    `resume_id` text,
    `project_id` text NOT NULL,
    `name` text,
    `phone` text,
    `email` text,
    `summary` text,
    `skills` text,
    `experience` text,
    `education` text,
    `status` text DEFAULT 'pending' NOT NULL,
    `source` text,
    `created_at` text DEFAULT (datetime('now')) NOT NULL,
    `updated_at` text DEFAULT (datetime('now')) NOT NULL,
    FOREIGN KEY (`resume_id`) REFERENCES `resumes`(`id`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE IF NOT EXISTS `screening_results` (
    `id` text PRIMARY KEY NOT NULL,
    `project_id` text NOT NULL,
    `candidate_id` text NOT NULL,
    `score` integer,
    `dimensions` text,
    `reasoning` text,
    `level` text,
    `status` text DEFAULT 'pending' NOT NULL,
    `notes` text,
    `shortlisted` integer DEFAULT false NOT NULL,
    `created_at` text DEFAULT (datetime('now')) NOT NULL,
    FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE IF NOT EXISTS `compliance_results` (
    `id` text PRIMARY KEY NOT NULL,
    `resume_id` text,
    `jd_id` text,
    `issues` text,
    `status` text DEFAULT 'pending' NOT NULL,
    `created_at` text DEFAULT (datetime('now')) NOT NULL,
    FOREIGN KEY (`resume_id`) REFERENCES `resumes`(`id`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (`jd_id`) REFERENCES `job_descriptions`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE IF NOT EXISTS `export_records` (
    `id` text PRIMARY KEY NOT NULL,
    `project_id` text NOT NULL,
    `format` text NOT NULL,
    `file_path` text,
    `scope` text DEFAULT 'all' NOT NULL,
    `created_at` text DEFAULT (datetime('now')) NOT NULL,
    FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE IF NOT EXISTS `event_logs` (
    `id` text PRIMARY KEY NOT NULL,
    `event_type` text NOT NULL,
    `payload` text,
    `created_at` text DEFAULT (datetime('now')) NOT NULL
);
