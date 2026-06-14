//! MarkMind 읽기 전용 MCP 서버.
//!
//! 각 윈도우(프론트 React App)가 Tauri command `mcp_sync_document` 로 자기 문서
//! 스냅샷을 [`McpState`] 에 push 하고, 포커스는 lib.rs 의 on_window_event 가 갱신한다.
//! 이 서버의 tool 들은 그 공유 상태만 읽어 동기 응답한다(이벤트 왕복 없음).
//!
//! transport: Streamable HTTP, 127.0.0.1:MCP_PORT/mcp (localhost 전용).
//! 읽기 전용 PoC — 쓰기/충돌/인증은 다음 단계.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use rmcp::{
    handler::server::router::tool::ToolRouter,
    handler::server::wrapper::{Json, Parameters},
    model::{ServerCapabilities, ServerInfo},
    schemars, tool, tool_handler, tool_router,
    ServerHandler,
};
use serde::{Deserialize, Serialize};

/// MCP 서버가 listen 하는 고정 포트. 클라이언트는 한 번 등록하고 재사용:
/// `claude mcp add --transport http markmind http://localhost:8417/mcp`
pub const MCP_PORT: u16 = 8417;

/// 한 윈도우에 열린 문서의 스냅샷(프론트가 sync).
#[derive(Clone, Default)]
pub struct DocSnapshot {
    pub content: String,
    pub file_path: Option<String>,
    pub file_name: String,
    pub is_dirty: bool,
}

/// MCP 서버와 Tauri 가 공유하는 상태. `Arc` 로 manage + 핸들러가 공유.
#[derive(Default)]
pub struct McpState {
    /// window label → 문서 스냅샷
    pub docs: Mutex<HashMap<String, DocSnapshot>>,
    /// 포커스된 window label(= "현재" 문서)
    pub current: Mutex<Option<String>>,
}

impl McpState {
    /// 프론트 sync — 해당 윈도우의 문서 스냅샷 갱신.
    pub fn set_document(&self, label: String, snap: DocSnapshot) {
        if let Ok(mut m) = self.docs.lock() {
            m.insert(label, snap);
        }
    }

    /// 윈도우 종료 — 문서 제거 + current 가 그 윈도우면 비움.
    pub fn remove_document(&self, label: &str) {
        if let Ok(mut m) = self.docs.lock() {
            m.remove(label);
        }
        if let Ok(mut c) = self.current.lock() {
            if c.as_deref() == Some(label) {
                *c = None;
            }
        }
    }

    /// 포커스 변경 — 현재 문서 갱신.
    pub fn set_current(&self, label: String) {
        if let Ok(mut c) = self.current.lock() {
            *c = Some(label);
        }
    }
}

/// list_open_documents 응답 항목(content 제외 — 가벼움).
#[derive(Serialize, schemars::JsonSchema)]
struct DocMeta {
    window_label: String,
    file_path: Option<String>,
    file_name: String,
    is_dirty: bool,
    is_current: bool,
    char_count: usize,
}

/// get_current_document / get_document 응답(content 포함).
#[derive(Serialize, schemars::JsonSchema)]
struct DocFull {
    window_label: String,
    file_path: Option<String>,
    file_name: String,
    is_dirty: bool,
    char_count: usize,
    content: String,
}

#[derive(Deserialize, schemars::JsonSchema)]
struct GetDocArgs {
    /// 윈도우 라벨 (list_open_documents 의 window_label)
    #[serde(default)]
    window_label: Option<String>,
    /// 파일 절대 경로
    #[serde(default)]
    file_path: Option<String>,
}

fn to_full(label: &str, d: &DocSnapshot) -> DocFull {
    DocFull {
        window_label: label.to_string(),
        file_path: d.file_path.clone(),
        file_name: d.file_name.clone(),
        is_dirty: d.is_dirty,
        char_count: d.content.chars().count(),
        content: d.content.clone(),
    }
}

#[derive(Clone)]
struct MarkMindServer {
    state: Arc<McpState>,
    // `#[tool_handler]` 매크로가 내부적으로 사용 — dead-code 분석이 못 잡아 allow.
    #[allow(dead_code)]
    tool_router: ToolRouter<Self>,
}

#[tool_router]
impl MarkMindServer {
    fn new(state: Arc<McpState>) -> Self {
        Self {
            state,
            tool_router: Self::tool_router(),
        }
    }

    #[tool(
        description = "List all markdown documents currently open in MarkMind windows (metadata only, no content). Use this first to discover open documents."
    )]
    async fn list_open_documents(&self) -> Json<Vec<DocMeta>> {
        let current = self.state.current.lock().ok().and_then(|c| c.clone());
        let docs = self.state.docs.lock().unwrap();
        let mut list: Vec<DocMeta> = docs
            .iter()
            .map(|(label, d)| DocMeta {
                window_label: label.clone(),
                file_path: d.file_path.clone(),
                file_name: d.file_name.clone(),
                is_dirty: d.is_dirty,
                is_current: current.as_deref() == Some(label),
                char_count: d.content.chars().count(),
            })
            .collect();
        // 안정적 순서 — current 먼저, 그다음 파일명
        list.sort_by(|a, b| {
            b.is_current
                .cmp(&a.is_current)
                .then_with(|| a.file_name.cmp(&b.file_name))
        });
        Json(list)
    }

    #[tool(
        description = "Get the full content of the document in the currently focused MarkMind window. Returns null if no window is focused or open."
    )]
    async fn get_current_document(&self) -> Json<Option<DocFull>> {
        let current = self.state.current.lock().ok().and_then(|c| c.clone());
        let Some(label) = current else {
            return Json(None);
        };
        let docs = self.state.docs.lock().unwrap();
        Json(docs.get(&label).map(|d| to_full(&label, d)))
    }

    #[tool(
        description = "Get a specific open document's full content by window_label or file_path (provide one). Returns null if not found."
    )]
    async fn get_document(&self, Parameters(args): Parameters<GetDocArgs>) -> Json<Option<DocFull>> {
        let docs = self.state.docs.lock().unwrap();
        let found = if let Some(label) = &args.window_label {
            docs.get_key_value(label).map(|(l, d)| to_full(l, d))
        } else if let Some(path) = &args.file_path {
            docs.iter()
                .find(|(_, d)| d.file_path.as_deref() == Some(path.as_str()))
                .map(|(l, d)| to_full(l, d))
        } else {
            None
        };
        Json(found)
    }
}

#[tool_handler]
impl ServerHandler for MarkMindServer {
    fn get_info(&self) -> ServerInfo {
        // ServerInfo 는 #[non_exhaustive] — struct literal 불가, default 후 필드 설정.
        let mut info = ServerInfo::default();
        info.capabilities = ServerCapabilities::builder().enable_tools().build();
        info.instructions = Some(
            "MarkMind read-only document reader. Lists open markdown documents and returns their live editor content (including unsaved changes)."
                .into(),
        );
        info
    }
}

/// Streamable HTTP MCP 서버를 127.0.0.1:MCP_PORT 에서 기동.
/// bind 실패해도 패닉 없이 로그만 — 앱 본체는 정상 동작.
pub async fn start(state: Arc<McpState>) {
    use rmcp::transport::streamable_http_server::{
        session::local::LocalSessionManager, tower::StreamableHttpServerConfig,
        StreamableHttpService,
    };

    let factory_state = state.clone();
    // 127.0.0.1 bind 자체로 외부 접근이 차단되므로 PoC 는 기본 config.
    // (DNS rebinding 방어용 Host 검증 with_allowed_hosts 는 인증과 함께 다음 단계.)
    let config = StreamableHttpServerConfig::default();

    let service = StreamableHttpService::new(
        move || Ok(MarkMindServer::new(factory_state.clone())),
        Arc::new(LocalSessionManager::default()),
        config,
    );

    let app = axum::Router::new().nest_service("/mcp", service);

    let listener = match tokio::net::TcpListener::bind(("127.0.0.1", MCP_PORT)).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[mcp] {MCP_PORT} bind 실패(이미 사용 중일 수 있음): {e}");
            return;
        }
    };
    eprintln!("[mcp] MarkMind MCP 서버 http://127.0.0.1:{MCP_PORT}/mcp 기동");
    if let Err(e) = axum::serve(listener, app).await {
        eprintln!("[mcp] serve 종료: {e}");
    }
}
