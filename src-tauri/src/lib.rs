use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

// Stores file path received before WebView is ready
struct PendingFile(Mutex<Option<String>>);

#[tauri::command]
fn get_pending_file(state: tauri::State<'_, PendingFile>) -> Option<String> {
    state.0.lock().unwrap().take()
}

#[tauri::command]
async fn open_new_window(app: tauri::AppHandle, file_path: Option<String>) -> Result<(), String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let label = format!("win-{}", timestamp);

    let url = match &file_path {
        Some(path) => {
            let encoded = urlencoding::encode(path);
            WebviewUrl::App(format!("index.html?file={}", encoded).into())
        }
        None => WebviewUrl::App("index.html".into()),
    };

    // Get position of the focused window and cascade from it
    let offset = app.webview_windows().len() as f64 * 30.0;

    WebviewWindowBuilder::new(&app, &label, url)
        .title("MarkMind")
        .inner_size(1200.0, 800.0)
        .min_inner_size(600.0, 400.0)
        .position(100.0 + offset, 100.0 + offset)
        .decorations(true)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Helper to create a new window for a given file path
fn spawn_window_for_file(app: &tauri::AppHandle, path: &str) {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let label = format!("win-{}", timestamp);
    let encoded = urlencoding::encode(path);
    let url = WebviewUrl::App(format!("index.html?file={}", encoded).into());

    let _ = WebviewWindowBuilder::new(app, &label, url)
        .title("MarkMind")
        .inner_size(1200.0, 800.0)
        .min_inner_size(600.0, 400.0)
        .decorations(true)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .build();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let pending = PendingFile(Mutex::new(None));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(pending)
        .invoke_handler(tauri::generate_handler![get_pending_file, open_new_window])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &event {
                for url in urls {
                    if let Ok(path) = url.to_file_path() {
                        if let Some(path_str) = path.to_str() {
                            let path_string = path_str.to_string();

                            if let Some(main_win) = app.get_webview_window("main") {
                                let state: tauri::State<'_, PendingFile> = app.state();
                                let has_pending = state.0.lock().unwrap().is_some();

                                if has_pending {
                                    spawn_window_for_file(app, &path_string);
                                } else {
                                    *state.0.lock().unwrap() = Some(path_string.clone());
                                    let _ = main_win.emit("open-file", &path_string);
                                }
                            } else {
                                let state: tauri::State<'_, PendingFile> = app.state();
                                *state.0.lock().unwrap() = Some(path_string.clone());
                                let _ = app.emit("open-file", &path_string);
                            }
                        }
                    }
                }
            }
            let _ = &event;
        });
}
