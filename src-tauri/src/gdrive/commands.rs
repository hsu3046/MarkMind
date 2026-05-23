//! Tauri commands — JS 에서 `invoke('gdrive_*', ...)` 로 호출.

use super::api::{self, DriveFile};
use super::auth::{self, ConnectResult};
use super::storage;

/// Drive 연동 가능 여부 — Keychain 에 OAuth client_id + secret 있는지.
#[tauri::command]
pub fn gdrive_is_configured() -> bool {
    super::is_configured()
}

/// Settings UI 표시용 — 저장된 client_id (전체 문자열). secret 은 절대 노출 X.
#[tauri::command]
pub fn gdrive_get_client_id() -> Result<Option<String>, String> {
    storage::get_client_id().map_err(|e| e.to_string())
}

/// Settings 에서 사용자가 client_id + secret 입력 → Keychain 저장.
#[tauri::command]
pub fn gdrive_set_credentials(client_id: String, client_secret: String) -> Result<(), String> {
    let id = client_id.trim();
    let secret = client_secret.trim();
    if id.is_empty() || secret.is_empty() {
        return Err("client_id 와 client_secret 둘 다 입력해주세요.".into());
    }
    storage::save_client_credentials(id, secret).map_err(|e| e.to_string())
}

/// client_id + secret + refresh_token + email 모두 삭제 (완전 초기화).
#[tauri::command]
pub fn gdrive_clear_credentials() -> Result<(), String> {
    storage::reset_all().map_err(|e| e.to_string())
}

/// 현재 연결 상태 — 연결됐으면 email, 아니면 null.
#[tauri::command]
pub fn gdrive_status() -> Result<Option<String>, String> {
    storage::get_user_email().map_err(|e| e.to_string())
}

/// 브라우저 OAuth flow 시작 → 연결 완료 시 email 반환.
#[tauri::command]
pub async fn gdrive_connect() -> Result<ConnectResult, String> {
    auth::connect().await.map_err(|e| e.to_string())
}

/// 연결 해제 — 모든 자격증명 삭제.
#[tauri::command]
pub fn gdrive_disconnect() -> Result<(), String> {
    storage::disconnect().map_err(|e| e.to_string())
}

/// 마크다운 파일 목록.
/// query: mimeType 이 markdown 이거나 파일명에 `.md` 포함 (drive.readonly scope).
/// `max_results`: 최대 가져올 수 (None = 모두, 안전 한도 10000).
#[tauri::command]
pub async fn gdrive_list(max_results: Option<u32>) -> Result<Vec<DriveFile>, String> {
    let q = "(mimeType='text/markdown' or mimeType='text/x-markdown' or name contains '.md') and trashed=false";
    api::list_files(Some(q), max_results)
        .await
        .map_err(|e| e.to_string())
}

/// 파일 본문 다운로드 (텍스트). mime_type 으로 Google Docs/일반 파일 분기.
#[tauri::command]
pub async fn gdrive_download(file_id: String, mime_type: String) -> Result<String, String> {
    api::download_file(&file_id, &mime_type)
        .await
        .map_err(|e| e.to_string())
}

/// 새 파일 업로드 — 반환: 생성된 파일 메타
#[tauri::command]
pub async fn gdrive_upload(
    name: String,
    content: String,
    parent_id: Option<String>,
) -> Result<DriveFile, String> {
    api::upload_file(&name, &content, parent_id.as_deref())
        .await
        .map_err(|e| e.to_string())
}

/// 기존 파일 덮어쓰기
#[tauri::command]
pub async fn gdrive_update(file_id: String, content: String) -> Result<DriveFile, String> {
    api::update_file(&file_id, &content)
        .await
        .map_err(|e| e.to_string())
}
