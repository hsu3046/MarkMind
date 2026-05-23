//! Google Drive 통합 에러 타입.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum GDriveError {
    #[error("Google Drive 설정이 없습니다. .env.local 의 GOOGLE_OAUTH_CLIENT_ID/SECRET 확인")]
    NotConfigured,

    #[error("Drive 연결 안 됨 — Settings → Google Drive 연결 클릭")]
    NotAuthenticated,

    #[error("OAuth 인증 실패: {0}")]
    OAuth(String),

    #[error("토큰 갱신 실패 — 다시 연결해주세요")]
    TokenRefreshFailed,

    #[error("Drive API 오류: {0}")]
    Api(String),

    #[error("HTTP 오류: {0}")]
    Http(#[from] reqwest::Error),

    #[error("JSON 파싱 오류: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Keychain 오류: {0}")]
    Keychain(String),

    #[error("IO 오류: {0}")]
    Io(#[from] std::io::Error),

    #[error("내부 오류: {0}")]
    Internal(String),
}

pub type GDriveResult<T> = Result<T, GDriveError>;

impl From<GDriveError> for String {
    fn from(e: GDriveError) -> Self {
        e.to_string()
    }
}

impl From<keyring::Error> for GDriveError {
    fn from(e: keyring::Error) -> Self {
        GDriveError::Keychain(e.to_string())
    }
}
