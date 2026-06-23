//! MarkMind MCP 서버 (읽기 + 쓰기).
//!
//! 각 윈도우(프론트 React App)가 Tauri command `mcp_sync_document` 로 자기 문서
//! 스냅샷을 [`McpState`] 에 push 하고, 포커스는 lib.rs 의 on_window_event 가 갱신한다.
//! 읽기 tool 들은 그 공유 상태만 읽어 동기 응답한다(이벤트 왕복 없음).
//!
//! 쓰기 tool(`edit_document`/`set_document_content`)은 라이브 에디터를 거친다:
//!   tool → `app.emit_to(window, "mcp-apply-edit", req)` → 프론트가 에디터 갱신
//!        → `mcp_apply_edit_result` command → oneshot 채널로 tool 응답.
//! 디스크에 직접 쓰지 않는다(에디터 메모리와 어긋남 방지) — 에디터에 반영하고
//! isDirty 로 표시만 한다(저장은 사용자). 충돌(미저장 편집 중)이어도 그대로 반영.
//!
//! transport: Streamable HTTP, 127.0.0.1:MCP_PORT/mcp (localhost 전용).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use rmcp::{
    handler::server::router::tool::ToolRouter,
    handler::server::wrapper::{Json, Parameters},
    model::{Icon, Implementation, ServerCapabilities, ServerInfo},
    schemars, tool, tool_handler, tool_router, ServerHandler,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;

/// MCP 서버가 listen 하는 고정 포트. 클라이언트는 한 번 등록하고 재사용:
/// `claude mcp add --transport http markmind http://localhost:8417/mcp`
pub const MCP_PORT: u16 = 8417;

/// 쓰기 tool 의 content/new_content 최대 바이트(로컬 클라이언트발 거대 payload DoS 방지).
/// 마크다운 문서로는 충분히 큰 값(8MB).
const MAX_CONTENT_BYTES: usize = 8 * 1024 * 1024;

/// 한 윈도우에 열린 문서의 스냅샷(프론트가 sync).
#[derive(Clone, Default)]
pub struct DocSnapshot {
    pub content: String,
    pub file_path: Option<String>,
    pub file_name: String,
    pub is_dirty: bool,
}

/// 프론트가 쓰기 요청을 처리한 뒤 ack 로 돌려주는 결과.
pub struct EditOutcome {
    pub ok: bool,
    pub error: Option<String>,
    pub char_count: Option<usize>,
}

/// MCP 서버와 Tauri 가 공유하는 상태. `Arc` 로 manage + 핸들러가 공유.
///
/// **다중 클라이언트 동시성**(#39 검토): 무인증 localhost 라 여러 MCP 클라이언트
/// (Claude Desktop·Cursor·스크립트)가 같은 McpState 에 동시 접속할 수 있다. 모든
/// 필드가 `Mutex` 라 데이터 레이스는 없고, 쓰기 요청은 `pending` 의 request_id
/// 유일성 + per-window 취소(`cancel_window_pending`)로 격리된다 → 서버 측 안전.
/// 남은 한계는 프론트(App)의 단일 제안 슬롯(동시 propose 시 UI 가 뒤 제안으로
/// 덮임 — 임시 가드 적용)으로, 본격 per-request 큐/클라이언트별 세션은 인증 도입
/// 시 검토(단일 사용자 환경에선 ROI 낮음).
#[derive(Default)]
pub struct McpState {
    /// window label → 문서 스냅샷
    pub docs: Mutex<HashMap<String, DocSnapshot>>,
    /// 포커스된 window label(= "현재" 문서)
    pub current: Mutex<Option<String>>,
    /// 진행 중인 쓰기 요청: request_id → (대상 window label, 응답 채널).
    /// 쓰기 tool 이 register 후 event emit → 프론트 ack(`mcp_apply_edit_result`)
    /// 가 resolve. 미해결 시 tool 쪽 timeout 이 take 로 정리. label 을 같이
    /// 보관해 윈도우 종료 시 그 창의 미해결 요청을 즉시 취소한다.
    pub pending: Mutex<HashMap<String, (String, oneshot::Sender<EditOutcome>)>>,
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

    /// 윈도우 종료 — 그 창의 미해결 쓰기 요청을 즉시 취소(ok=false)해서
    /// tool 이 15s/300s timeout 까지 매달리지 않게 한다(닫힌 창은 영영 ack 불가).
    pub fn cancel_window_pending(&self, label: &str) {
        let cancelled: Vec<oneshot::Sender<EditOutcome>> = {
            let Ok(mut m) = self.pending.lock() else {
                return;
            };
            let ids: Vec<String> = m
                .iter()
                .filter(|(_, (l, _))| l == label)
                .map(|(id, _)| id.clone())
                .collect();
            ids.into_iter()
                .filter_map(|id| m.remove(&id).map(|(_, tx)| tx))
                .collect()
        };
        for tx in cancelled {
            let _ = tx.send(EditOutcome {
                ok: false,
                error: Some("대상 창이 닫혔습니다".into()),
                char_count: None,
            });
        }
    }

    /// 포커스 변경 — 현재 문서 갱신.
    pub fn set_current(&self, label: String) {
        if let Ok(mut c) = self.current.lock() {
            *c = Some(label);
        }
    }

    /// 쓰기 요청 등록 — 대상 window label + 프론트 ack 채널 저장.
    pub fn register_pending(&self, id: String, label: String, tx: oneshot::Sender<EditOutcome>) {
        if let Ok(mut m) = self.pending.lock() {
            m.insert(id, (label, tx));
        }
    }

    /// 채널 회수(timeout 정리 등). 있으면 제거 후 반환.
    pub fn take_pending(&self, id: &str) -> Option<oneshot::Sender<EditOutcome>> {
        self.pending
            .lock()
            .ok()
            .and_then(|mut m| m.remove(id).map(|(_, tx)| tx))
    }

    /// 프론트 ack — 해당 요청 채널을 결과로 resolve.
    pub fn resolve_pending(&self, id: &str, outcome: EditOutcome) {
        if let Some(tx) = self.take_pending(id) {
            let _ = tx.send(outcome);
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

/// list_open_documents 응답 래퍼.
///
/// MCP 스펙은 tool outputSchema 루트가 반드시 `object` 여야 한다(`array`/`null` 불가).
/// rmcp 1.7 은 `Json<Vec<_>>`/`Json<Option<_>>` 처럼 루트가 object 가 아닌 반환에
/// 대해 tool_router 빌드 시 패닉한다. 이 팩토리는 세션(=initialize)마다 호출되므로
/// 패닉 시 모든 연결이 응답 없이 끊긴다. → 결과를 항상 object 로 감싼다.
#[derive(Serialize, schemars::JsonSchema)]
struct ListDocsResult {
    documents: Vec<DocMeta>,
}

/// get_current_document / get_document 응답 래퍼(없으면 `document: null`).
#[derive(Serialize, schemars::JsonSchema)]
struct GetDocResult {
    document: Option<DocFull>,
}

#[derive(Deserialize, schemars::JsonSchema)]
struct CreateDocArgs {
    /// 새 문서 내용.
    content: String,
    /// 창 제목/파일명(기본 Untitled.md). 저장 전까지 파일 경로 없음.
    #[serde(default)]
    file_name: Option<String>,
}

#[derive(Deserialize, schemars::JsonSchema)]
struct ProposeEditArgs {
    #[serde(default)]
    window_label: Option<String>,
    #[serde(default)]
    file_path: Option<String>,
    /// 제안하는 문서 전체의 새 내용. 현재 내용과 diff 로 사용자에게 보여주고
    /// 사용자가 수락해야만 적용된다(거절 시 미적용).
    new_content: String,
    /// 수정안 설명(diff 미리보기 헤더에 표시). 선택.
    #[serde(default)]
    description: Option<String>,
}

/// 쓰기 tool 응답(루트 object — MCP outputSchema 요건).
#[derive(Serialize, schemars::JsonSchema)]
struct EditResultOut {
    applied: bool,
    window_label: Option<String>,
    char_count: Option<usize>,
    message: String,
}

impl EditResultOut {
    fn fail(msg: impl Into<String>) -> Self {
        Self {
            applied: false,
            window_label: None,
            char_count: None,
            message: msg.into(),
        }
    }
}

/// 프론트로 보내는 쓰기/액션 요청 payload.
/// content op(str_replace/set_content)는 `mcp-apply-edit` event 로 useFileSystem 이,
/// editor op(insert_text/save)는 `mcp-editor-action` event 로
/// App 이 처리한다. 둘 다 같은 request_id 로 `mcp_apply_edit_result` ack.
#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct EditRequest {
    request_id: String,
    /// 대상 윈도우 라벨. emit_to 로 이미 타게팅하지만, 프론트가 자기 창인지
    /// 한 번 더 확인해 멀티윈도우에서 엉뚱한 창 편집을 막는다.
    window_label: String,
    /// 제안하는 새 전체 내용.
    content: Option<String>,
    /// propose 수정안 설명(diff 미리보기에 표시).
    description: Option<String>,
}

/// window_label → file_path → current 순으로 대상 윈도우 라벨 해석.
/// file_path 가 여러 창에 열려 있을 때(HashMap 순회는 비결정적이므로) 결정적으로
/// 고른다: 포커스(current) 창이 매치에 있으면 그것, 아니면 라벨 사전순 첫 번째.
fn resolve_target(
    state: &McpState,
    window_label: &Option<String>,
    file_path: &Option<String>,
) -> Option<String> {
    if let Some(label) = window_label {
        let docs = state.docs.lock().unwrap_or_else(|e| e.into_inner());
        return docs.contains_key(label).then(|| label.clone());
    }
    if let Some(path) = file_path {
        let docs = state.docs.lock().unwrap_or_else(|e| e.into_inner());
        let mut matches: Vec<String> = docs
            .iter()
            .filter(|(_, d)| d.file_path.as_deref() == Some(path.as_str()))
            .map(|(l, _)| l.clone())
            .collect();
        if matches.is_empty() {
            return None;
        }
        let current = state.current.lock().ok().and_then(|c| c.clone());
        if let Some(cur) = &current {
            if matches.iter().any(|l| l == cur) {
                return Some(cur.clone());
            }
        }
        matches.sort();
        return matches.into_iter().next();
    }
    state.current.lock().ok().and_then(|c| c.clone())
}

/// get_outline 항목.
#[derive(Serialize, schemars::JsonSchema)]
struct OutlineItem {
    /// 헤딩 레벨 1~6 (# 개수)
    level: u8,
    title: String,
    /// 1-based 줄 번호
    line: usize,
}

#[derive(Serialize, schemars::JsonSchema)]
struct OutlineResult {
    window_label: Option<String>,
    outline: Vec<OutlineItem>,
}

/// 선행 들여쓰기(스페이스=1, 탭=4칸 근사)를 세고, 공백 이후 부분을 반환.
/// CommonMark 의 "4칸 이상 = indented code block" 판정을 근사하기 위함.
fn split_indent(line: &str) -> (usize, &str) {
    let mut indent = 0usize;
    for (idx, ch) in line.char_indices() {
        match ch {
            ' ' => indent += 1,
            '\t' => indent += 4,
            _ => return (indent, &line[idx..]),
        }
    }
    (indent, "") // 전부 공백인 라인
}

/// 코드펜스 마커면 (펜스 문자, 연속 길이) 반환. ``` 또는 ~~~ 가 3개 이상일 때만.
/// `` ` ``·`~` 는 ASCII 1바이트라 반환된 길이는 바이트 인덱스로도 안전하게 쓸 수 있다.
fn fence_marker(s: &str) -> Option<(char, usize)> {
    let first = s.chars().next()?;
    if first != '`' && first != '~' {
        return None;
    }
    let len = s.chars().take_while(|&c| c == first).count();
    (len >= 3).then_some((first, len))
}

/// 마크다운 ATX 헤딩(`#`~`######`) 추출. 코드펜스(``` / ~~~) 내부는 제외.
///
/// CommonMark 근사로 펜스 토글 정합성을 보강(이슈 #40):
/// - 여는/닫는 펜스는 0~3칸 들여쓰기 + 동일 문자 3개 이상
/// - 닫는 펜스는 여는 펜스와 **같은 문자·같거나 긴 길이**, 마커 뒤는 공백만(info-string 금지)
/// - 4칸 이상 들여쓴 라인은 indented code block 으로 보고 펜스/헤딩 판정에서 제외
fn parse_outline(content: &str) -> Vec<OutlineItem> {
    let mut out = Vec::new();
    // 열린 펜스: Some((문자, 길이)). None = 펜스 밖.
    let mut fence: Option<(char, usize)> = None;
    for (i, line) in content.lines().enumerate() {
        let (indent, rest) = split_indent(line);

        if let Some((open_ch, open_len)) = fence {
            // 펜스 안 — 헤딩 무시. 닫는 펜스만 탐지.
            if indent <= 3 {
                if let Some((ch, len)) = fence_marker(rest) {
                    // 같은 종류·동등 이상 길이 + 마커 뒤 공백만 → 닫힘 (rest 는 ASCII 마커라 byte=char)
                    if ch == open_ch && len >= open_len && rest[len..].trim().is_empty() {
                        fence = None;
                    }
                }
            }
            continue;
        }

        // 펜스 밖 — 4칸 이상 들여쓰기는 indented code block 이라 펜스/헤딩 판정 제외
        if indent > 3 {
            continue;
        }
        if let Some((ch, len)) = fence_marker(rest) {
            fence = Some((ch, len));
            continue;
        }
        let hashes = rest.chars().take_while(|&c| c == '#').count();
        if (1..=6).contains(&hashes) {
            let after = &rest[hashes..];
            // `# 제목` 처럼 # 뒤 공백이 있거나 빈 헤딩만 인정(`#title` 은 헤딩 아님)
            if after.is_empty() || after.starts_with(' ') || after.starts_with('\t') {
                out.push(OutlineItem {
                    level: hashes as u8,
                    title: after.trim().to_string(),
                    line: i + 1,
                });
            }
        }
    }
    out
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
    /// 쓰기 tool 이 대상 윈도우로 `mcp-apply-edit` event 를 emit 하는 데 사용.
    app: AppHandle,
    // `#[tool_handler]` 매크로가 내부적으로 사용 — dead-code 분석이 못 잡아 allow.
    #[allow(dead_code)]
    tool_router: ToolRouter<Self>,
}

#[tool_router]
impl MarkMindServer {
    fn new(state: Arc<McpState>, app: AppHandle) -> Self {
        Self {
            state,
            app,
            tool_router: Self::tool_router(),
        }
    }

    /// 쓰기/액션 요청을 대상 윈도우로 보내고 프론트 ack 를 기다린다.
    /// `event` 는 content op 면 "mcp-apply-edit", editor op 면 "mcp-editor-action",
    /// propose 면 "mcp-propose-edit". `timeout_secs` 는 사용자 결정이 필요한
    /// propose 는 길게(예: 300), 즉시 적용은 짧게(15).
    async fn dispatch_edit(
        &self,
        label: String,
        event: &str,
        timeout_secs: u64,
        payload: EditRequest,
    ) -> EditResultOut {
        let (tx, rx) = oneshot::channel();
        self.state
            .register_pending(payload.request_id.clone(), label.clone(), tx);

        if let Err(e) = self.app.emit_to(label.as_str(), event, payload.clone()) {
            self.state.take_pending(&payload.request_id);
            return EditResultOut::fail(format!("event emit 실패: {e}"));
        }

        match tokio::time::timeout(Duration::from_secs(timeout_secs), rx).await {
            Ok(Ok(o)) => {
                if o.ok {
                    EditResultOut {
                        applied: true,
                        window_label: Some(label),
                        char_count: o.char_count,
                        message: "applied to editor (unsaved — call save_document to persist)"
                            .into(),
                    }
                } else {
                    EditResultOut::fail(o.error.unwrap_or_else(|| "edit rejected".into()))
                }
            }
            // 채널이 send 없이 drop 됨(프론트 ack 못함 등) — pending 잔존 방지로 정리.
            Ok(Err(_)) => {
                self.state.take_pending(&payload.request_id);
                EditResultOut::fail("editor 채널이 닫힘")
            }
            Err(_) => {
                self.state.take_pending(&payload.request_id);
                EditResultOut::fail("editor 무응답 timeout (창이 없거나 응답하지 않음)")
            }
        }
    }

    #[tool(
        description = "List all markdown documents currently open in MarkMind windows (metadata only, no content). Use this first to discover open documents."
    )]
    async fn list_open_documents(&self) -> Json<ListDocsResult> {
        let current = self.state.current.lock().ok().and_then(|c| c.clone());
        let docs = self.state.docs.lock().unwrap_or_else(|e| e.into_inner());
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
        Json(ListDocsResult { documents: list })
    }

    #[tool(
        description = "Get the full content of the document in the currently focused MarkMind window. Returns null if no window is focused or open."
    )]
    async fn get_current_document(&self) -> Json<GetDocResult> {
        let current = self.state.current.lock().ok().and_then(|c| c.clone());
        let Some(label) = current else {
            return Json(GetDocResult { document: None });
        };
        let docs = self.state.docs.lock().unwrap_or_else(|e| e.into_inner());
        Json(GetDocResult {
            document: docs.get(&label).map(|d| to_full(&label, d)),
        })
    }

    #[tool(
        description = "Get a specific open document's full content by window_label or file_path (provide one). Returns null if not found."
    )]
    async fn get_document(&self, Parameters(args): Parameters<GetDocArgs>) -> Json<GetDocResult> {
        let docs = self.state.docs.lock().unwrap_or_else(|e| e.into_inner());
        let found = if let Some(label) = &args.window_label {
            docs.get_key_value(label).map(|(l, d)| to_full(l, d))
        } else if let Some(path) = &args.file_path {
            docs.iter()
                .find(|(_, d)| d.file_path.as_deref() == Some(path.as_str()))
                .map(|(l, d)| to_full(l, d))
        } else {
            None
        };
        Json(GetDocResult { document: found })
    }

    #[tool(
        description = "Get the heading outline (table of contents) of an open document — each heading's level (1-6), title, and 1-based line number. Target by window_label, file_path, or — if both omitted — the currently focused window. Useful to understand structure before editing or to locate a section."
    )]
    async fn get_outline(&self, Parameters(args): Parameters<GetDocArgs>) -> Json<OutlineResult> {
        let Some(label) = resolve_target(&self.state, &args.window_label, &args.file_path) else {
            return Json(OutlineResult {
                window_label: None,
                outline: vec![],
            });
        };
        let docs = self.state.docs.lock().unwrap_or_else(|e| e.into_inner());
        let outline = docs
            .get(&label)
            .map(|d| parse_outline(&d.content))
            .unwrap_or_default();
        Json(OutlineResult {
            window_label: Some(label),
            outline,
        })
    }

    #[tool(
        description = "Open a NEW MarkMind editor window containing `content` (e.g. a draft you composed). `file_name` sets the title (defaults to Untitled.md). The document is unsaved with no file path until the user saves it. Returns the new window_label."
    )]
    async fn create_document(
        &self,
        Parameters(args): Parameters<CreateDocArgs>,
    ) -> Json<EditResultOut> {
        if args.content.len() > MAX_CONTENT_BYTES {
            return Json(EditResultOut::fail(format!(
                "content 가 너무 큽니다 (상한 {}MB)",
                MAX_CONTENT_BYTES / 1024 / 1024
            )));
        }
        let name = args.file_name.unwrap_or_else(|| "Untitled.md".into());
        let char_count = args.content.chars().count();
        let app = self.app.clone();
        let content = args.content;
        // create_content_window 은 build 결과를 blocking recv 로 회수하므로
        // async 실행기를 막지 않도록 spawn_blocking 으로 분리.
        let result =
            tokio::task::spawn_blocking(move || crate::create_content_window(&app, content, name))
                .await;
        match result {
            Ok(Ok(label)) => Json(EditResultOut {
                applied: true,
                window_label: Some(label),
                char_count: Some(char_count),
                message: "new window opened (unsaved — call save_document to persist)".into(),
            }),
            Ok(Err(e)) => Json(EditResultOut::fail(format!("창 생성 실패: {e}"))),
            Err(e) => Json(EditResultOut::fail(format!("창 생성 task 실패: {e}"))),
        }
    }

    #[tool(
        description = "Propose replacing a document's full content with `new_content`, shown to the user as a diff preview that they must ACCEPT or REJECT (target by window_label, file_path, or current focused window). Nothing changes unless the user accepts. Use this (instead of set_document_content) when the user should review a large or risky rewrite. Waits up to 5 minutes for the user's decision."
    )]
    async fn propose_edit(
        &self,
        Parameters(args): Parameters<ProposeEditArgs>,
    ) -> Json<EditResultOut> {
        if args.new_content.len() > MAX_CONTENT_BYTES {
            return Json(EditResultOut::fail(format!(
                "new_content 가 너무 큽니다 (상한 {}MB)",
                MAX_CONTENT_BYTES / 1024 / 1024
            )));
        }
        let Some(label) = resolve_target(&self.state, &args.window_label, &args.file_path) else {
            return Json(EditResultOut::fail(
                "일치하는 열린 문서가 없습니다 (list_open_documents 로 확인)",
            ));
        };
        let payload = EditRequest {
            request_id: uuid::Uuid::new_v4().to_string(),
            window_label: label.clone(),
            content: Some(args.new_content),
            description: args.description,
        };
        // 사용자 결정 대기 — 5분 timeout.
        Json(
            self.dispatch_edit(label, "mcp-propose-edit", 300, payload)
                .await,
        )
    }
}

/// 번들된 앱 아이콘(128x128 PNG)을 data URI 로 인코딩(serverInfo.icons 용).
fn markmind_icon_data_uri() -> String {
    use base64::Engine;
    const PNG: &[u8] = include_bytes!("../../icons/128x128.png");
    format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(PNG)
    )
}

#[tool_handler]
impl ServerHandler for MarkMindServer {
    fn get_info(&self) -> ServerInfo {
        // ServerInfo 는 #[non_exhaustive] — struct literal 불가, default 후 필드 설정.
        let mut info = ServerInfo::default();
        info.capabilities = ServerCapabilities::builder().enable_tools().build();
        // 서버 식별 — 기본값은 "rmcp". MarkMind 로 명시 + 아이콘(data URI).
        // 주의(2026-06): Claude Desktop 은 아직 serverInfo.icons 를 렌더하지 않는다
        // (표시명도 config 키에서 가져옴). 스펙 준수 + 타 MCP 클라이언트/미래 대비용.
        // 데스크톱에 아이콘을 띄우려면 .mcpb 번들(manifest.icon) 경로가 필요.
        info.server_info = Implementation::new("MarkMind", env!("CARGO_PKG_VERSION"))
            .with_title("MarkMind")
            .with_icons(vec![Icon::new(markmind_icon_data_uri())
                .with_mime_type("image/png")
                .with_sizes(vec!["128x128".into()])]);
        info.instructions = Some(
            "MarkMind document bridge. Read: list_open_documents, get_current_document, get_document, get_outline. To EDIT an open document, ALWAYS use propose_edit: read the document first, then call propose_edit with the full new content — the user reviews a diff and accepts/rejects it (nothing changes unless they accept). create_document opens a draft in a new window. NEVER save: the user saves manually after reviewing; there is no save tool."
                .into(),
        );
        info
    }
}

/// Streamable HTTP MCP 서버를 127.0.0.1:MCP_PORT 에서 기동.
/// bind 실패해도 패닉 없이 로그만 — 앱 본체는 정상 동작.
/// `app` 은 쓰기 tool 이 대상 윈도우로 event 를 emit 하는 데 사용.
pub async fn start(state: Arc<McpState>, app: AppHandle, shutdown: CancellationToken) {
    use rmcp::transport::streamable_http_server::{
        session::local::LocalSessionManager, tower::StreamableHttpServerConfig,
        StreamableHttpService,
    };

    let factory_state = state.clone();
    let factory_app = app.clone();
    // 127.0.0.1 bind 자체로 외부 접근이 차단되므로 기본 config.
    // (DNS rebinding 방어용 Host 검증은 default 에 localhost/127.0.0.1 포함됨.)
    // stateless: 세션을 두지 않아 앱 재시작 후에도 클라이언트가 "Session not found"
    // 없이 계속 동작(읽기=요청/응답, 쓰기=propose 의 request_id 기반이라 세션 불필요).
    // mcp-remote 호환·재시작 강건성은 재현 바이너리로 실측 검증함.
    //
    // Origin 검증(#34, defense-in-depth): Origin 헤더가 붙는 요청(=브라우저 컨텍스트)만
    // 우리 앱 origin 으로 제한해 악성 원격 웹페이지의 cross-origin 호출을 403 차단한다.
    // 정합 클라(mcp-remote 등 node)는 Origin 헤더를 보내지 않고, rmcp 의
    // validate_origin_header 는 allowed_origins 가 채워져 있어도 Origin 부재 시 Ok 로
    // 통과시키므로(tower.rs) 기존 연결에는 영향이 없다.
    let config = StreamableHttpServerConfig::default()
        .with_stateful_mode(false)
        .with_allowed_origins(["tauri://localhost", "http://tauri.localhost"])
        // shutdown 신호(#38, best-effort): RunEvent::ExitRequested 에서 이 토큰을 cancel
        // 하면 rmcp active session 의 child_token 과 아래 axum graceful shutdown 이 정리를
        // "시작"한다. 단 cancel 측이 drain 완료를 await 하지 않고 프로세스가 곧 종료되므로
        // 완전한 세션 정리를 "보장"하지는 않는다(로컬 PoC — 강제 종료보다 약간 정중한 수준).
        .with_cancellation_token(shutdown.clone());

    let service = StreamableHttpService::new(
        move || {
            Ok(MarkMindServer::new(
                factory_state.clone(),
                factory_app.clone(),
            ))
        },
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
    if let Err(e) = axum::serve(listener, app)
        .with_graceful_shutdown(async move { shutdown.cancelled().await })
        .await
    {
        eprintln!("[mcp] serve 종료: {e}");
    }
}

#[cfg(test)]
mod outline_tests {
    use super::parse_outline;

    /// OutlineItem 은 PartialEq 미derive → (level, title, line) 튜플로 비교.
    fn items(md: &str) -> Vec<(u8, String, usize)> {
        parse_outline(md)
            .into_iter()
            .map(|o| (o.level, o.title, o.line))
            .collect()
    }

    #[test]
    fn extracts_basic_headings() {
        let md = "# A\n## B\ntext\n### C";
        assert_eq!(
            items(md),
            vec![(1, "A".into(), 1), (2, "B".into(), 2), (3, "C".into(), 4)]
        );
    }

    #[test]
    fn skips_headings_inside_fence() {
        let md = "# Real\n```\n# fake in code\n```\n## After";
        assert_eq!(
            items(md),
            vec![(1, "Real".into(), 1), (2, "After".into(), 5)]
        );
    }

    #[test]
    fn open_with_info_string_close_plain() {
        // ```rust 처럼 info-string 있는 여는 펜스 + 평범한 닫는 펜스
        let md = "```rust\n# not heading\n```\n# Heading";
        assert_eq!(items(md), vec![(1, "Heading".into(), 4)]);
    }

    #[test]
    fn mismatched_fence_char_does_not_close() {
        // ``` 로 열고 ~~~ 로는 닫지 못함 → 그 안의 # 는 계속 코드
        let md = "```\n# x\n~~~\n# y\n```\n# real";
        assert_eq!(items(md), vec![(1, "real".into(), 6)]);
    }

    #[test]
    fn shorter_marker_does_not_close_longer_fence() {
        // ```` (4) 로 열면 ``` (3) 으로 못 닫음
        let md = "````\n# x\n```\n# still code\n````\n# real";
        assert_eq!(items(md), vec![(1, "real".into(), 6)]);
    }

    #[test]
    fn indented_4spaces_is_code_not_fence_or_heading() {
        // 4칸 들여쓴 ``` 는 펜스 아님(코드블록) → 토글 안 됨, 뒤 헤딩 정상 인식
        assert_eq!(
            items("text\n    ```\n# heading"),
            vec![(1, "heading".into(), 3)]
        );
        // 4칸 들여쓴 # 는 헤딩 아님
        assert_eq!(
            items("    # not heading\n# yes"),
            vec![(1, "yes".into(), 2)]
        );
    }

    #[test]
    fn closing_fence_rejects_trailing_text() {
        // 닫는 펜스 뒤에 텍스트가 있으면(info-string) 닫기로 인정 안 함
        let md = "```\n# x\n``` not-close\n# still code\n```\n# real";
        assert_eq!(items(md), vec![(1, "real".into(), 6)]);
    }
}
