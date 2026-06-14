//! LAN 파일 공유 서버 — 같은 Wi-Fi 의 기기(아이폰 브라우저 등)가 지정한 폴더의
//! 마크다운 문서를 읽고 **in-place 로 편집**하도록 노출한다.
//!
//! MCP 서버(`mcp/mod.rs`, 127.0.0.1 고정·상시)와는 의도적으로 **분리**한다:
//!   - 바인딩이 다르다: MCP=localhost 전용, 이쪽=`0.0.0.0`(LAN 노출).
//!     한 서버에 합치면 파일 API 를 위해 0.0.0.0 으로 묶는 순간 MCP 까지 LAN 에
//!     노출돼(같은 망 누구나 Claude tool 로 문서 조작) 위험. → 절대 합치지 않는다.
//!   - 생명주기가 다르다: MCP 는 앱 시작 시 상시, 이쪽은 설정창에서 **Connect 할
//!     때만** bind(기본 OFF). 앱 재시작 시 자동 재연결 안 함(명시적 ON 원칙).
//!
//! 보안: ① 루트 폴더 1개로 샌드박싱(`..`/심볼릭링크 탈출 차단) ② 확장자
//! 화이트리스트 ③ 모든 `/api/*` 요청에 토큰(PIN) 검증 ④ 원자적 저장(temp+rename).
//! 정적 UI(빌드된 dist) 는 토큰 없이 로드 — 민감 정보는 API 뒤에만 있다.

use std::net::SocketAddr;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};

use axum::{
    extract::{Query, State},
    http::{header, StatusCode, Uri},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use rust_embed::RustEmbed;
use serde::{Deserialize, Serialize};
use tokio::sync::oneshot;
use walkdir::WalkDir;

/// LAN 파일 서버 포트(MCP 8417 과 분리). 클라이언트는 `http://<ip>:8418`.
pub const LAN_PORT: u16 = 8418;

/// 읽기/쓰기 허용 확장자(소문자). 그 외 파일은 목록·읽기·쓰기 모두 거부.
const ALLOWED_EXTS: &[&str] = &["md", "markdown", "mdx", "txt"];

/// 저장 가능한 본문 최대 바이트(거대 payload 방어). 마크다운엔 충분(8MB).
const MAX_CONTENT_BYTES: usize = 8 * 1024 * 1024;

/// 빌드된 프론트(`dist`)를 바이너리에 임베드해 정적 서빙.
/// release: 컴파일 타임 임베드. debug: 런타임에 파일시스템에서 read
/// (`debug-embed` 미사용) → dev 중 `npm run build` 후 최신 UI 반영.
#[derive(RustEmbed)]
#[folder = "../dist"]
struct Frontend;

/// 기동 중인 서버 핸들 — graceful shutdown 채널 + 표시용 메타.
struct RunningServer {
    shutdown: oneshot::Sender<()>,
    /// mDNS(Bonjour) 호스트네임(예: `My-Mac.local`). IP 와 달리 고정 — IP 가
    /// DHCP 로 바뀌어도 같은 주소로 접속. macOS 가 기본 광고(시스템 무수정).
    host: Option<String>,
    addr: String,
    port: u16,
    root: String,
}

/// Tauri 가 manage 하는 LAN 서버 상태(Connect 시 Some, Disconnect 시 None).
#[derive(Default)]
pub struct LanState {
    inner: Mutex<Option<RunningServer>>,
}

/// axum 핸들러가 공유하는 컨텍스트(루트 폴더 canonical + 토큰).
#[derive(Clone)]
struct Ctx {
    root: Arc<PathBuf>,
    token: Arc<String>,
}

/// lan_start 반환 / lan_status 응답 — 접속 정보.
#[derive(Serialize, Clone)]
pub struct LanInfo {
    pub running: bool,
    /// mDNS 호스트네임(`*.local`) — 고정 주소(권장). 못 구하면 None.
    pub host: Option<String>,
    /// 현재 LAN IP — DHCP 라 바뀔 수 있음(폴백).
    pub addr: Option<String>,
    pub port: Option<u16>,
    pub root: Option<String>,
}

/// Bonjour 가 광고하는 LocalHostName(`*.local`)을 읽는다(읽기 전용 — 시스템
/// 무수정). macOS 의 `scutil --get LocalHostName` 결과에 `.local` 을 붙인다.
fn local_hostname() -> Option<String> {
    let out = std::process::Command::new("scutil")
        .args(["--get", "LocalHostName"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if name.is_empty() {
        None
    } else {
        Some(format!("{name}.local"))
    }
}

// ─── 경로 가드 ───

/// 루트 기준 상대경로를 안전하게 절대경로로 해석. 절대경로/`..`/`.`/드라이브
/// prefix component 는 거부. 대상이 이미 존재하면(읽기/덮어쓰기) 심볼릭 링크로
/// 루트를 탈출하지 않았는지 canonicalize 로 재확인.
fn resolve(root: &Path, rel: &str) -> Result<PathBuf, ()> {
    let rel = rel.trim_start_matches('/');
    let mut p = root.to_path_buf();
    for comp in Path::new(rel).components() {
        match comp {
            Component::Normal(c) => p.push(c),
            // RootDir / ParentDir / CurDir / Prefix 전부 거부(traversal 차단)
            _ => return Err(()),
        }
    }
    if let Ok(canon) = p.canonicalize() {
        let root_canon = root.canonicalize().map_err(|_| ())?;
        if !canon.starts_with(&root_canon) {
            return Err(());
        }
    }
    Ok(p)
}

/// 확장자가 화이트리스트에 있는지(소문자 비교).
fn ext_allowed(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| ALLOWED_EXTS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// 파일 수정 시각(epoch ms). 못 구하면 0.
fn mtime_ms(meta: &std::fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 대상의 부모 디렉토리가 루트 하위인지 canonicalize 로 검증한다(P1).
/// `resolve` 의 canonicalize 는 **존재하는 경로**에만 동작하므로, 새 파일 쓰기는
/// 부모(항상 존재)를 따로 해소해 심볼릭 링크로 루트를 탈출하지 못하게 막는다.
fn parent_within_root(root: &Path, abs: &Path) -> Result<(), StatusCode> {
    let parent = abs.parent().ok_or(StatusCode::BAD_REQUEST)?;
    let parent_canon = parent.canonicalize().map_err(|_| StatusCode::BAD_REQUEST)?;
    if parent_canon.starts_with(root) {
        Ok(())
    } else {
        Err(StatusCode::FORBIDDEN)
    }
}

// ─── 토큰 인증 미들웨어 (/api/* 에만 적용) ───

async fn auth(
    State(ctx): State<Ctx>,
    req: axum::extract::Request,
    next: Next,
) -> Result<Response, StatusCode> {
    // 헤더(x-markmind-token) 우선, 없으면 쿼리(?token=).
    let provided = req
        .headers()
        .get("x-markmind-token")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string)
        .or_else(|| {
            req.uri().query().and_then(|q| {
                url::form_urlencoded::parse(q.as_bytes())
                    .find(|(k, _)| k == "token")
                    .map(|(_, v)| v.into_owned())
            })
        });

    // 상수시간 비교까진 불필요(로컬 LAN PIN) — 단순 일치.
    if provided.as_deref() == Some(ctx.token.as_str()) {
        Ok(next.run(req).await)
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
}

// ─── API 핸들러 ───

#[derive(Serialize)]
struct FileEntry {
    /// 루트 기준 상대경로(슬래시 구분)
    path: String,
    name: String,
    size: u64,
    /// 수정 시각(epoch ms)
    modified: u64,
}

#[derive(Serialize)]
struct ListResp {
    root: String,
    files: Vec<FileEntry>,
}

/// GET /api/files — 루트 폴더의 마크다운 파일 목록(재귀, 숨김 폴더 제외).
async fn list_files(State(ctx): State<Ctx>) -> Result<Json<ListResp>, StatusCode> {
    let root = ctx.root.as_path();
    let mut files = Vec::new();
    for entry in WalkDir::new(root)
        .into_iter()
        .filter_entry(|e| {
            // 숨김 디렉토리/파일(.git, .obsidian 등) 스킵. 루트 자신은 통과.
            e.depth() == 0
                || !e
                    .file_name()
                    .to_str()
                    .map(|n| n.starts_with('.'))
                    .unwrap_or(false)
        })
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() || !ext_allowed(entry.path()) {
            continue;
        }
        let Ok(rel) = entry.path().strip_prefix(root) else {
            continue;
        };
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        files.push(FileEntry {
            path: rel.to_string_lossy().replace('\\', "/"),
            name: entry.file_name().to_string_lossy().to_string(),
            size: meta.len(),
            modified: mtime_ms(&meta),
        });
    }
    // 최근 수정 우선(모바일에서 방금 본 문서 찾기 쉽게).
    files.sort_by(|a, b| b.modified.cmp(&a.modified).then_with(|| a.path.cmp(&b.path)));
    Ok(Json(ListResp {
        root: ctx.root.to_string_lossy().to_string(),
        files,
    }))
}

#[derive(Deserialize)]
struct PathQuery {
    path: String,
    // token 은 미들웨어가 처리 — 여기선 무시(쿼리에 같이 와도 무방).
    #[serde(default)]
    #[allow(dead_code)]
    token: Option<String>,
}

#[derive(Serialize)]
struct ReadResp {
    path: String,
    content: String,
    /// 수정 시각(epoch ms) — 저장 시 낙관적 동시성 비교(base_modified)에 사용.
    modified: u64,
}

/// GET /api/file?path=rel — 파일 내용.
async fn read_file(
    State(ctx): State<Ctx>,
    Query(q): Query<PathQuery>,
) -> Result<Json<ReadResp>, StatusCode> {
    let abs = resolve(&ctx.root, &q.path).map_err(|_| StatusCode::FORBIDDEN)?;
    if !ext_allowed(&abs) {
        return Err(StatusCode::FORBIDDEN);
    }
    let meta = std::fs::metadata(&abs).map_err(|_| StatusCode::NOT_FOUND)?;
    // P3d: 거대 파일 메모리 보호 — write 와 같은 상한.
    if meta.len() as usize > MAX_CONTENT_BYTES {
        return Err(StatusCode::PAYLOAD_TOO_LARGE);
    }
    // P4a: 비-UTF8 은 "없음"이 아니라 415 로 구분(원인 혼동 방지).
    let content = match std::fs::read_to_string(&abs) {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::InvalidData => {
            return Err(StatusCode::UNSUPPORTED_MEDIA_TYPE);
        }
        Err(_) => return Err(StatusCode::NOT_FOUND),
    };
    Ok(Json(ReadResp {
        path: q.path,
        content,
        modified: mtime_ms(&meta),
    }))
}

#[derive(Deserialize)]
struct SaveBody {
    path: String,
    content: String,
    /// 읽을 때 받은 수정 시각(epoch ms). 주면 저장 직전 디스크 mtime 과 비교해
    /// 다르면 409(외부에서 변경됨) — lost update 방지(P2). 생략/0 이면 강제 저장.
    #[serde(default)]
    base_modified: Option<u64>,
}

#[derive(Serialize)]
struct SaveResp {
    ok: bool,
    path: String,
    /// 저장 후 새 수정 시각 — 클라이언트가 다음 저장의 base 로 갱신.
    modified: u64,
}

/// PUT /api/file — 본문을 **원자적으로**(temp 작성 후 rename) in-place 저장.
async fn write_file(
    State(ctx): State<Ctx>,
    Json(body): Json<SaveBody>,
) -> Result<Json<SaveResp>, StatusCode> {
    if body.content.len() > MAX_CONTENT_BYTES {
        return Err(StatusCode::PAYLOAD_TOO_LARGE);
    }
    let abs = resolve(&ctx.root, &body.path).map_err(|_| StatusCode::FORBIDDEN)?;
    if !ext_allowed(&abs) {
        return Err(StatusCode::FORBIDDEN);
    }
    // 부모 디렉토리는 존재해야 하고(새 폴더 생성 안 함), 루트 하위여야 한다(P1 —
    // 새 파일은 resolve 의 canonicalize 가 스킵되므로 부모를 직접 검증해 심볼릭
    // 링크 탈출을 막는다).
    let parent = abs.parent().ok_or(StatusCode::BAD_REQUEST)?;
    if !parent.is_dir() {
        return Err(StatusCode::BAD_REQUEST);
    }
    parent_within_root(&ctx.root, &abs)?;

    // P2: 낙관적 동시성 — base_modified 가 주어지고 대상이 존재하면 현재 mtime 과
    // 비교해 그 사이 외부 변경(맥 데스크탑 편집 등)이 있었으면 409 로 거부.
    if let Some(base) = body.base_modified.filter(|b| *b != 0) {
        if let Ok(meta) = std::fs::metadata(&abs) {
            if mtime_ms(&meta) != base {
                return Err(StatusCode::CONFLICT);
            }
        }
        // 대상이 없으면(새 파일) base 는 무의미 — 통과.
    }

    // 같은 디렉토리에 temp 작성 → rename(동일 파일시스템이라 원자적).
    let tmp = parent.join(format!(
        ".{}.markmind.tmp",
        abs.file_name().and_then(|n| n.to_str()).unwrap_or("doc")
    ));
    std::fs::write(&tmp, body.content.as_bytes()).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    std::fs::rename(&tmp, &abs).map_err(|_| {
        let _ = std::fs::remove_file(&tmp); // rename 실패 시 temp 정리
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    let modified = std::fs::metadata(&abs).map(|m| mtime_ms(&m)).unwrap_or(0);
    Ok(Json(SaveResp {
        ok: true,
        path: body.path,
        modified,
    }))
}

// ─── 정적 UI (rust-embed) ───

/// `/api/*` 외 모든 경로 → 임베드된 dist. 없는 경로는 index.html(SPA fallback).
async fn static_handler(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };

    match Frontend::get(path) {
        Some(content) => {
            let mime = mime_guess::from_path(path).first_or_octet_stream();
            (
                [(header::CONTENT_TYPE, mime.as_ref().to_string())],
                content.data.into_owned(),
            )
                .into_response()
        }
        None => match Frontend::get("index.html") {
            Some(content) => (
                [(header::CONTENT_TYPE, "text/html".to_string())],
                content.data.into_owned(),
            )
                .into_response(),
            None => (StatusCode::NOT_FOUND, "build not found").into_response(),
        },
    }
}

fn build_router(ctx: Ctx) -> Router {
    let api = Router::new()
        .route("/files", get(list_files))
        .route("/file", get(read_file).put(write_file))
        .layer(middleware::from_fn_with_state(ctx.clone(), auth))
        .with_state(ctx.clone());

    Router::new()
        .nest("/api", api)
        .fallback(static_handler)
        .with_state(ctx)
}

// ─── start / stop / status ───

/// 서버를 `0.0.0.0:LAN_PORT` 에 bind 하고 spawn. bind 실패(포트 사용 중 등)는
/// 동기로 즉시 Err 반환(사용자에게 표시). 성공 시 LanInfo(LAN IP + 포트).
pub fn start(state: &LanState, root: String, token: String) -> Result<LanInfo, String> {
    let mut guard = state.inner.lock().map_err(|_| "상태 lock 실패".to_string())?;
    if guard.is_some() {
        return Err("이미 연결되어 있습니다 (먼저 Disconnect)".into());
    }
    if token.trim().is_empty() {
        return Err("토큰(PIN)이 비어 있습니다".into());
    }
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err(format!("폴더가 존재하지 않습니다: {root}"));
    }
    let root_canon = root_path
        .canonicalize()
        .map_err(|e| format!("폴더 경로 해석 실패: {e}"))?;

    // 같은 망에서 아이폰이 접속할 LAN IP(표시용). 못 구하면 안내만.
    let lan_ip = local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .unwrap_or_else(|_| "<이 맥의 IP>".into());
    // 고정 mDNS 호스트네임(있으면) — IP 가 바뀌어도 같은 주소.
    let host = local_hostname();

    let addr = SocketAddr::from(([0, 0, 0, 0], LAN_PORT));
    // 동기 bind 로 포트 충돌을 즉시 알린다.
    let std_listener = std::net::TcpListener::bind(addr)
        .map_err(|e| format!("포트 {LAN_PORT} bind 실패(이미 사용 중일 수 있음): {e}"))?;
    std_listener
        .set_nonblocking(true)
        .map_err(|e| format!("listener 설정 실패: {e}"))?;

    let ctx = Ctx {
        root: Arc::new(root_canon),
        token: Arc::new(token),
    };
    let app = build_router(ctx);
    let (tx, rx) = oneshot::channel::<()>();

    tauri::async_runtime::spawn(async move {
        let listener = match tokio::net::TcpListener::from_std(std_listener) {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[lan] listener 변환 실패: {e}");
                return;
            }
        };
        eprintln!("[lan] LAN 파일 서버 0.0.0.0:{LAN_PORT} 기동");
        let r = axum::serve(listener, app)
            .with_graceful_shutdown(async move {
                let _ = rx.await;
            })
            .await;
        if let Err(e) = r {
            eprintln!("[lan] serve 종료: {e}");
        }
        eprintln!("[lan] LAN 파일 서버 중지");
    });

    guard.replace(RunningServer {
        shutdown: tx,
        host: host.clone(),
        addr: lan_ip.clone(),
        port: LAN_PORT,
        root: root.clone(),
    });

    Ok(LanInfo {
        running: true,
        host,
        addr: Some(lan_ip),
        port: Some(LAN_PORT),
        root: Some(root),
    })
}

/// 서버 graceful shutdown(이미 꺼져 있으면 no-op).
pub fn stop(state: &LanState) -> Result<(), String> {
    let mut guard = state.inner.lock().map_err(|_| "상태 lock 실패".to_string())?;
    if let Some(srv) = guard.take() {
        let _ = srv.shutdown.send(());
    }
    Ok(())
}

/// 현재 상태(running + 접속 정보).
pub fn status(state: &LanState) -> LanInfo {
    match state.inner.lock() {
        Ok(g) => match &*g {
            Some(s) => LanInfo {
                running: true,
                host: s.host.clone(),
                addr: Some(s.addr.clone()),
                port: Some(s.port),
                root: Some(s.root.clone()),
            },
            None => LanInfo {
                running: false,
                host: None,
                addr: None,
                port: None,
                root: None,
            },
        },
        Err(_) => LanInfo {
            running: false,
            host: None,
            addr: None,
            port: None,
            root: None,
        },
    }
}

// ─── Tauri 커맨드 ───

#[tauri::command]
pub fn lan_start(
    state: tauri::State<'_, LanState>,
    root: String,
    token: String,
) -> Result<LanInfo, String> {
    start(&state, root, token)
}

#[tauri::command]
pub fn lan_stop(state: tauri::State<'_, LanState>) -> Result<(), String> {
    stop(&state)
}

#[tauri::command]
pub fn lan_status(state: tauri::State<'_, LanState>) -> LanInfo {
    status(&state)
}
