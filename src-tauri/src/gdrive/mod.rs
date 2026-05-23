//! Google Drive 연동 — OAuth 2.0 PKCE + Drive v3 REST API.
//!
//! 구조:
//! - auth.rs    : OAuth flow (loopback server, PKCE, token exchange/refresh)
//! - api.rs     : Drive v3 REST wrapper (list/download/upload/update)
//! - storage.rs : refresh_token + OAuth client credentials 을 macOS Keychain 에 저장
//! - commands.rs: Tauri command 등록
//! - error.rs   : 통합 에러 타입
//!
//! OAuth client credentials (client_id + secret) 은 사용자가 Settings UI 에서 직접
//! 입력 → Keychain 저장. 빌드 시 임베드 안 함 (GPL v3 오픈소스라 누구든 자기
//! Google Cloud project 로 사용).

pub mod api;
pub mod auth;
pub mod commands;
pub mod error;
pub mod storage;

/// Drive API base
pub const DRIVE_API_BASE: &str = "https://www.googleapis.com/drive/v3";
pub const DRIVE_UPLOAD_BASE: &str = "https://www.googleapis.com/upload/drive/v3";

/// OAuth scope:
/// - drive.readonly: 사용자의 모든 Drive 파일 읽기 (기존 마크다운 검색/열기 가능)
/// - drive.file:     앱이 만든/연 파일 쓰기 (다른 Drive 파일 수정/삭제 불가)
/// 공백 구분.
pub const SCOPE: &str =
    "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file";

/// Keychain 에 client_id + secret 둘 다 있으면 true.
pub fn is_configured() -> bool {
    storage::get_client_credentials()
        .map(|opt| opt.is_some())
        .unwrap_or(false)
}
