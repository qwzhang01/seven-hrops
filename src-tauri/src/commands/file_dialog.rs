use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_dialog::FilePath;
use tauri_plugin_shell::ShellExt;

// ────────────────────────────────────────────────
// File System Commands
// ────────────────────────────────────────────────

/// Open a file dialog for selecting resume files (PDF, DOCX, images)
#[tauri::command]
pub async fn open_file_dialog(
    app: tauri::AppHandle,
    title: String,
    filter_name: String,
    filter_extensions: Vec<String>,
    multiple: bool,
) -> Result<Vec<String>, String> {
    let ext_refs: Vec<&str> = filter_extensions.iter().map(|s| s.as_str()).collect();
    let dialog = app
        .dialog()
        .file()
        .set_title(&title)
        .add_filter(&filter_name, &ext_refs);

    if multiple {
        let result = dialog.blocking_pick_files();
        match result {
            Some(paths) => Ok(paths
                .into_iter()
                .filter_map(|fp| match fp {
                    FilePath::Path(p) => Some(p.display().to_string()),
                    FilePath::Url(u) => u.to_file_path().ok().map(|p| p.display().to_string()),
                })
                .collect()),
            None => Ok(vec![]),
        }
    } else {
        let result = dialog.blocking_pick_file();
        match result {
            Some(fp) => {
                let path_str = match fp {
                    FilePath::Path(p) => p.display().to_string(),
                    FilePath::Url(u) => u
                        .to_file_path()
                        .map(|p| p.display().to_string())
                        .unwrap_or_default(),
                };
                Ok(vec![path_str])
            }
            None => Ok(vec![]),
        }
    }
}

/// Open a save file dialog for exporting reports
#[tauri::command]
pub async fn open_save_dialog(
    app: tauri::AppHandle,
    title: String,
    filter_name: String,
    filter_extensions: Vec<String>,
) -> Result<Option<String>, String> {
    let ext_refs: Vec<&str> = filter_extensions.iter().map(|s| s.as_str()).collect();
    let result = app
        .dialog()
        .file()
        .set_title(&title)
        .add_filter(&filter_name, &ext_refs)
        .blocking_save_file();

    Ok(result.map(|fp| match fp {
        FilePath::Path(p) => p.display().to_string(),
        FilePath::Url(u) => u
            .to_file_path()
            .map(|p| p.display().to_string())
            .unwrap_or_default(),
    }))
}

/// Get the application data directory
#[tauri::command]
pub async fn get_app_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    Ok(path.display().to_string())
}

/// Open a path in the system file manager (Finder on macOS, Explorer on Windows)
#[tauri::command]
pub async fn open_in_finder(app: tauri::AppHandle, path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        app.shell()
            .command("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| format!("Failed to open in Finder: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        app.shell()
            .command("explorer")
            .args([&format!("/select,{}", path)])
            .spawn()
            .map_err(|e| format!("Failed to open in Explorer: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        app.shell()
            .command("xdg-open")
            .args([&path])
            .spawn()
            .map_err(|e| format!("Failed to open file manager: {}", e))?;
    }

    Ok(())
}