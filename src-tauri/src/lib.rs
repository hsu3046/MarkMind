use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

mod converters;
mod gdrive;
mod mcp;
mod print_pdf;
mod secrets;

use std::sync::Arc;

/// 윈도우별 pending file path 저장.
/// URL 쿼리 (`?file=...`) 로 path 전달하면 macOS WKWebView 의 URL 길이 한계 +
/// 한글/특수문자 인코딩으로 인한 누락 발생 → label 기반 HashMap 으로 전달.
///
/// main 윈도우 (label="main") 도 같은 HashMap 사용 — OS 파일 연결 (RunEvent::Opened) 시
/// PendingFiles.insert("main", path) 로 저장.
struct PendingFiles(Mutex<HashMap<String, String>>);

#[tauri::command]
fn take_pending_file(state: tauri::State<'_, PendingFiles>, label: String) -> Option<String> {
    state.0.lock().ok().and_then(|mut m| m.remove(&label))
}

/// (deprecated) 하위 호환 — 'main' label 로 위임.
/// 기존 frontend 가 `get_pending_file()` 만 호출하는 경로 유지.
#[tauri::command]
fn get_pending_file(state: tauri::State<'_, PendingFiles>) -> Option<String> {
    state.0.lock().ok().and_then(|mut m| m.remove("main"))
}

/// 프론트(각 윈도우)가 자기 문서 상태를 MCP 공유 상태에 동기화.
/// content 변경마다 프론트에서 디바운스되어 호출됨 — 읽기 전용 MCP 노출용.
/// `window.label()` 로 어느 윈도우인지 식별(멀티윈도우 독립).
#[tauri::command]
fn mcp_sync_document(
    window: tauri::Window,
    state: tauri::State<'_, Arc<mcp::McpState>>,
    content: String,
    file_path: Option<String>,
    file_name: String,
    is_dirty: bool,
) {
    state.set_document(
        window.label().to_string(),
        mcp::DocSnapshot {
            content,
            file_path,
            file_name,
            is_dirty,
        },
    );
}

/// PendingFiles HashMap 에 label → path 저장. 비async 헬퍼 — borrow checker 의
/// async fn 안 MutexGuard 수명 추론 이슈 회피.
fn store_pending_file(app: &tauri::AppHandle, label: &str, path: &str) {
    let state: tauri::State<'_, PendingFiles> = app.state();
    if let Ok(mut m) = state.0.lock() {
        m.insert(label.to_string(), path.to_string());
    };
}

#[tauri::command]
async fn open_new_window(app: tauri::AppHandle, file_path: Option<String>) -> Result<(), String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let label = format!("win-{}", timestamp);

    // path 가 있으면 PendingFiles 에 저장 — URL 에는 file 쿼리 안 넣음 (길이/인코딩 회피)
    if let Some(ref path) = file_path {
        store_pending_file(&app, &label, path);
    }
    let url = WebviewUrl::App("index.html".into());

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

// 이전엔 별도 Convert 윈도우 (open_convert_window) 가 있었으나,
// 사이드바 통합 (음성 인식 / 이미지 인식 / AI 에이전트) 으로 제거됨.

/// Helper to create a new window for a given file path.
/// PendingFiles HashMap 에 path 저장 후 URL 쿼리 없이 spawn.
fn spawn_window_for_file(app: &tauri::AppHandle, path: &str) {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let label = format!("win-{}", timestamp);

    store_pending_file(app, &label, path);

    let _ = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
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
    let pending = PendingFiles(Mutex::new(HashMap::new()));
    let mcp_state: Arc<mcp::McpState> = Arc::new(mcp::McpState::default());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // 기존 entry 7개를 통합 vault 로 1회 마이그레이션 (있을 때만).
            secrets::migrate_legacy_once();
            // MCP 읽기 전용 서버 기동 — bind 실패해도 내부에서 로그만 (앱 정상).
            let st = app.state::<Arc<mcp::McpState>>().inner().clone();
            tauri::async_runtime::spawn(mcp::start(st));
            Ok(())
        })
        .manage(pending)
        .manage(mcp_state)
        .on_window_event(|window, event| {
            // 포커스된 윈도우 = MCP "현재 문서". 윈도우 종료 시 목록에서 제거.
            match event {
                tauri::WindowEvent::Focused(true) => {
                    if let Some(st) = window.try_state::<Arc<mcp::McpState>>() {
                        st.set_current(window.label().to_string());
                    }
                }
                tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed => {
                    if let Some(st) = window.try_state::<Arc<mcp::McpState>>() {
                        st.remove_document(window.label());
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_pending_file,
            take_pending_file,
            open_new_window,
            mcp_sync_document,
            // Keychain
            converters::keychain::get_api_key,
            converters::keychain::set_api_key,
            converters::keychain::delete_api_key,
            converters::keychain::has_api_key,
            // 통합 vault batch (저장 다이얼로그 1회로 묶기)
            secrets::secrets_set_user_inputs,
            secrets::get_diar_python,
            // Templates
            converters::templates::list_meeting_templates,
            converters::templates::open_user_templates_folder,
            // Pipelines
            converters::commands::run_audio_job,
            converters::commands::run_ocr_job,
            converters::commands::run_notes_job,
            converters::commands::run_ocr_inline,
            converters::commands::get_conversions_dir,
            converters::commands::extract_speakers,
            converters::commands::rename_speakers,
            converters::commands::merge_md_files,
            // Google Drive
            gdrive::commands::gdrive_is_configured,
            gdrive::commands::gdrive_get_client_id,
            gdrive::commands::gdrive_set_credentials,
            gdrive::commands::gdrive_clear_credentials,
            gdrive::commands::gdrive_status,
            gdrive::commands::gdrive_connect,
            gdrive::commands::gdrive_disconnect,
            gdrive::commands::gdrive_list,
            gdrive::commands::gdrive_download,
            gdrive::commands::gdrive_upload,
            gdrive::commands::gdrive_update,
            // PDF export — macOS NSPrintInfo 명시 + WKWebView native print
            print_pdf::export_pdf,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &event {
                for url in urls {
                    if let Ok(path) = url.to_file_path() {
                        // OS 더블클릭으로 전달된 파일 = 사용자가 의도한 파일.
                        // capabilities 의 정적 fs scope ($HOME/** 등) 밖 경로
                        // (외장 드라이브 /Volumes, 숨김 .폴더 포함 경로 — macOS 는
                        // require_literal_leading_dot 기본 true) 는 readTextFile 이
                        // 조용히 거부돼 빈 페이지가 됐음 → 런타임 scope 허용.
                        {
                            use tauri_plugin_fs::FsExt;
                            if let Err(e) = app.fs_scope().allow_file(&path) {
                                eprintln!("[open-file] fs scope allow_file 실패: {e}");
                            }
                        }
                        if let Some(path_str) = path.to_str() {
                            let path_string = path_str.to_string();

                            if let Some(main_win) = app.get_webview_window("main") {
                                // main 윈도우가 이미 파일 열고 있으면 → 새 윈도우 spawn
                                let main_has_pending = {
                                    let state: tauri::State<'_, PendingFiles> = app.state();
                                    state
                                        .0
                                        .lock()
                                        .map(|m| m.contains_key("main"))
                                        .unwrap_or(false)
                                };
                                if main_has_pending {
                                    spawn_window_for_file(app, &path_string);
                                } else {
                                    store_pending_file(app, "main", &path_string);
                                    let _ = main_win.emit("open-file", &path_string);
                                }
                            } else {
                                // main 윈도우 아직 안 떴음 — mount 시 take_pending_file('main') 로 가져감
                                store_pending_file(app, "main", &path_string);
                                let _ = app.emit("open-file", &path_string);
                            }
                        }
                    }
                }
            }
            let _ = &event;
        });
}
