use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

mod converters;
mod gdrive;
mod lan_server;
mod mcp;
mod print_pdf;
mod secrets;
mod share;
mod user_memory;
mod vault;

use std::sync::Arc;

/// 윈도우별 pending file path 저장.
/// URL 쿼리 (`?file=...`) 로 path 전달하면 macOS WKWebView 의 URL 길이 한계 +
/// 한글/특수문자 인코딩으로 인한 누락 발생 → label 기반 HashMap 으로 전달.
///
/// main 윈도우 (label="main") 도 같은 HashMap 사용 — OS 파일 연결 (RunEvent::Opened) 시
/// PendingFiles.insert("main", path) 로 저장.
struct PendingFiles(Mutex<HashMap<String, String>>);

/// 새 윈도우 label 유일성 보장용 시퀀스. timestamp(ms) 만으론 같은 ms 에 창 2개를
/// 만들면 label 이 겹쳐 "a webview with label `win-...` already exists" 가 났다.
/// timestamp + seq 로 항상 유일하게 만든다.
static WIN_SEQ: AtomicU64 = AtomicU64::new(0);

/// MCP `create_document` 가 새 창에 넣을 (content, file_name) 보관.
/// 새 창 mount 시 `take_pending_content(label)` 로 가져가 loadFromMemory.
struct PendingContent(Mutex<HashMap<String, (String, String)>>);

/// MCP HTTP 서버 shutdown 신호(#38, best-effort). 앱 종료(RunEvent::ExitRequested) 시
/// cancel 로 rmcp active session·axum graceful shutdown 이 정리를 "시작"하게 한다.
/// drain 완료를 대기하지는 않으므로(곧 프로세스 종료) 완전 정리 보장은 아니다.
struct McpShutdown(tokio_util::sync::CancellationToken);

#[tauri::command]
fn take_pending_file(state: tauri::State<'_, PendingFiles>, label: String) -> Option<String> {
    state.0.lock().ok().and_then(|mut m| m.remove(&label))
}

#[tauri::command]
fn take_pending_content(
    state: tauri::State<'_, PendingContent>,
    label: String,
) -> Option<(String, String)> {
    state.0.lock().ok().and_then(|mut m| m.remove(&label))
}

/// MCP `create_document` 로 동시에 열 수 있는 창 상한(로컬 프로세스 창 폭주 방지).
const MAX_OPEN_WINDOWS: usize = 24;

/// MCP `create_document` — content 를 담은 새 윈도우를 연다(메인 스레드에서 빌드).
/// 새 label 을 PendingContent 에 저장 후 창 생성 → 그 창이 mount 시 가져간다.
/// 블로킹 recv 를 쓰므로 async tool 에서는 `spawn_blocking` 으로 호출할 것.
pub(crate) fn create_content_window(
    app: &tauri::AppHandle,
    content: String,
    file_name: String,
) -> Result<String, String> {
    // DoS 방어 — 열린 창 수 상한.
    if app.webview_windows().len() >= MAX_OPEN_WINDOWS {
        return Err(format!("열린 창이 너무 많습니다 (상한 {MAX_OPEN_WINDOWS})"));
    }
    let label = format!("mcp-{}", uuid::Uuid::new_v4());
    // PendingContent + McpState 낙관적 등록(반환 직후 read tool 이 새 창을 보도록).
    {
        let state: tauri::State<'_, PendingContent> = app.state();
        if let Ok(mut m) = state.0.lock() {
            m.insert(label.clone(), (content.clone(), file_name.clone()));
        };
    }
    {
        let mcp_state: tauri::State<'_, Arc<mcp::McpState>> = app.state();
        mcp_state.set_document(
            label.clone(),
            mcp::DocSnapshot {
                content,
                file_path: None,
                file_name,
                is_dirty: false,
            },
        );
    }
    let offset = app.webview_windows().len() as f64 * 30.0;
    let app2 = app.clone();
    let label2 = label.clone();
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    app.run_on_main_thread(move || {
        let r = WebviewWindowBuilder::new(&app2, &label2, WebviewUrl::App("index.html".into()))
            .title("MarkMind")
            .inner_size(1200.0, 800.0)
            .min_inner_size(600.0, 400.0)
            .position(100.0 + offset, 100.0 + offset)
            .decorations(true)
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .build();
        let _ = tx.send(r.map(|_| ()).map_err(|e| e.to_string()));
    })
    .map_err(|e| e.to_string())?;

    // build 결과 회수(메인 스레드에서 곧 옴). 실패 시 낙관적 등록을 되돌린다.
    let build_result = rx
        .recv_timeout(std::time::Duration::from_secs(10))
        .map_err(|_| "윈도우 생성 응답 없음(timeout)".to_string());
    match build_result {
        Ok(Ok(())) => Ok(label),
        Ok(Err(e)) | Err(e) => {
            // 누수 정리 — PendingContent + McpState 낙관 등록 제거.
            let pc: tauri::State<'_, PendingContent> = app.state();
            if let Ok(mut m) = pc.0.lock() {
                m.remove(&label);
            };
            let mcp_state: tauri::State<'_, Arc<mcp::McpState>> = app.state();
            mcp_state.remove_document(&label);
            Err(format!("윈도우 생성 실패: {e}"))
        }
    }
}

/// 호출한 윈도우의 pending file 경로를 가져온다(remove). **윈도우 label 별로 분리** —
/// 예전엔 항상 `"main"` 만 remove 해서, 새 창(win-*)이 자기 앞으로 저장된
/// pending(store_pending(win-*, path))을 못 받고 "main"(없으면 null)을 가져가
/// **빈 창**이 됐다. `window.label()` 로 자기 것을 가져오게 고침.
#[tauri::command]
fn get_pending_file(window: tauri::Window, state: tauri::State<'_, PendingFiles>) -> Option<String> {
    state.0.lock().ok().and_then(|mut m| m.remove(window.label()))
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

/// 프론트가 MCP 쓰기 요청(`mcp-apply-edit`)을 처리한 결과를 ack.
/// request_id 로 해당 oneshot 채널을 resolve → 대기 중인 쓰기 tool 이 응답한다.
#[tauri::command]
fn mcp_apply_edit_result(
    state: tauri::State<'_, Arc<mcp::McpState>>,
    request_id: String,
    ok: bool,
    error: Option<String>,
    char_count: Option<usize>,
) {
    state.resolve_pending(
        &request_id,
        mcp::EditOutcome {
            ok,
            error,
            char_count,
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
    let label = format!("win-{}-{}", timestamp, WIN_SEQ.fetch_add(1, Ordering::Relaxed));

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
    let label = format!("win-{}-{}", timestamp, WIN_SEQ.fetch_add(1, Ordering::Relaxed));

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
    let pending_content = PendingContent(Mutex::new(HashMap::new()));
    let mcp_state: Arc<mcp::McpState> = Arc::new(mcp::McpState::default());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // 기존 entry 7개를 통합 vault 로 1회 마이그레이션 (있을 때만).
            secrets::migrate_legacy_once();
            // MCP 서버 기동 — bind 실패해도 내부에서 로그만 (앱 정상).
            // 쓰기 tool 이 윈도우로 event emit 하므로 AppHandle 도 전달.
            // shutdown 신호(#38, best-effort) 토큰을 만들어 manage + start 에 전달.
            // RunEvent::ExitRequested 에서 cancel → 정리 "시작"(완료 대기는 안 함).
            let mcp_shutdown = tokio_util::sync::CancellationToken::new();
            app.manage(McpShutdown(mcp_shutdown.clone()));
            let st = app.state::<Arc<mcp::McpState>>().inner().clone();
            tauri::async_runtime::spawn(mcp::start(st, app.handle().clone(), mcp_shutdown));
            Ok(())
        })
        .manage(pending)
        .manage(pending_content)
        .manage(mcp_state)
        .manage(lan_server::LanState::default())
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
                        // 닫힌 창의 미해결 쓰기 요청을 즉시 취소(timeout 대기 방지).
                        st.cancel_window_pending(window.label());
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_pending_file,
            take_pending_file,
            take_pending_content,
            open_new_window,
            mcp_sync_document,
            mcp_apply_edit_result,
            // LAN 파일 공유 서버 (아이폰 등 — Connect 시에만 0.0.0.0 bind)
            lan_server::lan_start,
            lan_server::lan_stop,
            lan_server::lan_status,
            // macOS AirDrop 공유 (LAN 접속 URL 을 아이폰으로)
            share::share_url_airdrop,
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
            // Vault (옵시디언형 문서 그래프 — 폴더 스캔 + create-on-click)
            vault::scan_vault,
            vault::create_file_at,
            // 사용자 메모리(#15) — AI system prompt 주입용 "내 정보"
            user_memory::read_user_memory,
            user_memory::write_user_memory,
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
            if let tauri::RunEvent::ExitRequested { .. } = &event {
                if let Some(s) = app.try_state::<McpShutdown>() {
                    // best-effort: 신호만 보내고 drain 완료는 기다리지 않는다(곧 프로세스 종료).
                    s.0.cancel();
                    eprintln!("[mcp] 앱 종료 — MCP shutdown 신호 전송(best-effort)");
                }
            }
            let _ = &event;
        });
}
