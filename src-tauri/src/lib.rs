mod commands;
mod db;
mod email;
pub mod manifest;
mod native;
mod sandbox;

// Top-level imports — only the symbols actually used in `run()`.
// commands::agent was removed in Phase B Task 7.1 — the Agent Runtime
// now lives entirely in TypeScript (agentService.ts → window.__platform.runtime).
use commands::file_dialog::*;
use commands::browser::*;
use commands::manifest_io::{
    install_user_manifest, load_user_manifests, uninstall_user_manifest,
};
use commands::sandbox::{sandbox_create, sandbox_drop};
use commands::diagnostics::open_audit_log;
// CRUD command imports (Task 20-26)
use commands::project_crud::{project_create, project_list, project_get, project_update, project_delete};
use commands::job_description_crud::{jd_create, jd_get, jd_update, jd_delete, jd_list_by_project};
use commands::resume_crud::{resume_import, resume_list, resume_get, resume_delete, resume_update_parse_status};
use commands::candidate_crud::{candidate_create, candidate_list, candidate_get, candidate_update, candidate_delete};
use commands::screening_crud::{screening_save, screening_get, screening_list, screening_update_note, screening_delete};
use commands::compliance_crud::{compliance_check, compliance_get, compliance_list, compliance_update, compliance_delete};
use commands::export_crud::{export_create, export_list, export_get, export_delete, event_log_create, event_log_list};
// Session & Message commands (Phase 2: arch-session-db-persistence)
use commands::session_commands::{
    session_create, session_get, session_list, session_update_title,
    session_update_model_config, session_delete, session_count,
    session_update_last_message, session_bind_workspace,
};
use commands::message_commands::{
    message_create, message_list_by_session, message_update_content,
    message_update_tool_calls, message_get, message_delete,
};
use native::export::export_docx;
use native::fs::{fs_canonicalize, fs_copy_file, fs_list_dir, fs_read_text, fs_stat, fs_write_text};
use native::fs_binary::fs_write_binary_file;
use native::models::models_ensure;
use native::network::http_get_json;
use native::parse::{parse_docx, parse_excel, parse_pdf};
use native::transcribe::transcribe_audio;
use native::webserver::{webserver_drop, webserver_publish};
use email::commands::{
    list_accounts, save_account, delete_account,
    fetch_inbox, get_thread, send_email,
    save_draft, start_oauth,
};
// db::migrations::get_migrations removed — migrations are now run inside
// db::connection::init_db() via rusqlite directly.
use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // Initialize logger
            env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
                .init();

            log::info!("[App] Seven HROps starting up...");

            // Phase B Task 1.7: 启动 sandbox 异步审计 writer（mpsc consumer task）
            sandbox::audit::init_audit_writer();

            // Initialise the SQLite DB (rusqlite) — opens the file,
            // sets PRAGMAs, runs pending migrations, and registers
            // `DbState` as a Tauri managed state.
            // tauri-plugin-sql removed; see openspec/changes/arch-db-rust-only/
            crate::db::connection::init_db(app.handle())
                .expect("fatal: database initialisation failed");

            Ok(())
        })
        // AgentRuntimeState removed in Phase B Task 7.1
        .manage(commands::browser::BrowserState::new(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            open_file_dialog,
            open_save_dialog,
            get_app_data_dir,
            open_in_finder,
            // agent_runtime_init / agent_runtime_dispose / agent_chat /
            // agent_chat_stream / agent_list_skills / agent_list_mcp_tools
            // removed in Phase B Task 7.1 — see commands/agent.rs
            open_browser_webview,
            navigate_browser,
            reload_browser_webview,
            resize_browser_webview,
            hide_browser_webview,
            show_browser_webview,
            close_browser_webview,
            // Email commands
            list_accounts,
            save_account,
            delete_account,
            fetch_inbox,
            get_thread,
            send_email,
            save_draft,
            start_oauth,
            // Phase-0 platform-foundation manifest IO (skeletons)
            load_user_manifests,
            install_user_manifest,
            uninstall_user_manifest,
            // Phase B Task 1.8: sandbox lifecycle
            sandbox_create,
            sandbox_drop,
            // Phase B Task 6.7: diagnostics for the bootstrap-failure UI
            open_audit_log,
            // Phase B Task 2.x: native fs/parse commands
            fs_read_text,
            fs_write_text,
            fs_write_binary_file,
            fs_copy_file,
            fs_list_dir,
            fs_stat,
            fs_canonicalize,
            parse_pdf,
            parse_docx,
            parse_excel,
            // Phase B Task 3.x: native webserver / models / transcribe
            webserver_publish,
            webserver_drop,
            models_ensure,
            transcribe_audio,
            // Phase E: export_docx (docx-rs)
            export_docx,
            // Phase F Task 1: network HTTP bridge
            http_get_json,
            // CRUD commands (Task 20-26)
            project_create,
            project_list,
            project_get,
            project_update,
            project_delete,
            jd_create,
            jd_get,
            jd_update,
            jd_delete,
            jd_list_by_project,
            resume_import,
            resume_list,
            resume_get,
            resume_delete,
            resume_update_parse_status,
            candidate_create,
            candidate_list,
            candidate_get,
            candidate_update,
            candidate_delete,
            screening_save,
            screening_get,
            screening_list,
            screening_update_note,
            screening_delete,
            compliance_check,
            compliance_get,
            compliance_list,
            compliance_update,
            compliance_delete,
            export_create,
            export_list,
            export_get,
            export_delete,
            event_log_create,
            event_log_list,
            // Phase 2: Session & Message commands (arch-session-db-persistence)
            session_create,
            session_get,
            session_list,
            session_update_title,
            session_update_model_config,
            session_delete,
            session_count,
            session_update_last_message,
            session_bind_workspace,
            message_create,
            message_list_by_session,
            message_update_content,
            message_update_tool_calls,
            message_get,
            message_delete,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                api.prevent_exit();
            }
        });
}
