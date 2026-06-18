//! 통합 에러 타입. Tauri command 결과에서 직렬화 가능하도록 String 화.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum ConverterError {
    #[error("API 키가 설정되지 않았습니다 ({0}). Settings 에서 키를 입력해주세요.")]
    MissingApiKey(&'static str),

    #[error("Gemini API 오류: {0}")]
    Gemini(String),

    #[error("Claude API 오류: {0}")]
    Claude(String),

    #[error("ChatGPT(Codex) API 오류: {0}")]
    Codex(String),

    #[error("OpenAI API 오류: {0}")]
    OpenAi(String),

    #[error("네트워크 연결이 불안정합니다. 잠시 후 다시 시도해주세요. ({0})")]
    Network(String),

    #[error("Gemini API 파일 검증 실패 (INVALID_ARGUMENT). PDF/오디오 구조나 용량을 모델이 지원하지 않습니다.")]
    InvalidArgument,

    #[error("Gemini API 할당량이 초과되었습니다. 잠시 후 다시 시도해주세요.")]
    RateLimit,

    #[error("Gemini 서버가 일시 과부하 상태입니다. 잠시 후 다시 시도해주세요.")]
    Overloaded,

    #[error("ffmpeg 실행 실패: {0}")]
    Ffmpeg(String),

    #[error("VAD 처리 실패: {0}")]
    Vad(String),

    #[error("PDF 처리 실패: {0}")]
    Pdf(String),

    #[error("템플릿 처리 실패: {0}")]
    Template(String),

    #[error("입력 검증 실패: {0}")]
    Validation(String),

    #[error("파일 IO 오류: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON 직렬화/파싱 오류: {0}")]
    Json(#[from] serde_json::Error),

    #[error("HTTP 클라이언트 오류: {0}")]
    Http(#[from] reqwest::Error),

    #[error("Keychain 오류: {0}")]
    Keychain(String),

    #[error("내부 오류: {0}")]
    Internal(String),
}

pub type ConverterResult<T> = Result<T, ConverterError>;

/// Tauri command 반환용 — 모든 에러를 String 으로 직렬화
impl From<ConverterError> for String {
    fn from(err: ConverterError) -> Self {
        err.to_string()
    }
}

impl From<anyhow::Error> for ConverterError {
    fn from(err: anyhow::Error) -> Self {
        ConverterError::Internal(err.to_string())
    }
}

impl From<keyring::Error> for ConverterError {
    fn from(err: keyring::Error) -> Self {
        ConverterError::Keychain(err.to_string())
    }
}
