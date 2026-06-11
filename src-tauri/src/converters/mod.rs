//! doc-converter 통합 모듈
//!
//! doc-converter (Node.js + Express) 의 3가지 파이프라인을 Rust 로 포팅:
//! - 음성 → 텍스트 (Gemini + ffmpeg + Silero VAD)
//! - 이미지/PDF → 텍스트 (Gemini 2-pass + pdfium 폴백)
//! - 텍스트 → 회의록 (Claude / Gemini + 템플릿)
//!
//! 진행상황은 Tauri event 로 frontend 에 stream.
//! API 키는 macOS Keychain (keyring 크레이트) 에 저장.

pub mod audio_pipeline;
pub mod audio_splitter;
pub mod diar;
pub mod diarize_cloud;
pub mod diarize_local;
pub mod commands;
pub mod error;
pub mod keychain;
pub mod llm;
pub mod notes_pipeline;
pub mod ocr_pipeline;
pub mod pdf_extractor;
pub mod progress;
pub mod speaker_dedup;
pub mod templates;
pub mod vad;

use serde::{Deserialize, Serialize};

// ─── 모델 ID 상수 (doc-converter src/types/index.ts MODELS 와 일치) ───

pub const MODEL_OCR_FAST: &str = "gemini-3.1-flash-image-preview";
pub const MODEL_OCR_ENHANCE: &str = "gemini-3-pro-image-preview";
// 2026-05 조사 결과 적용 — gemini-3.5-flash → 3.1-flash-lite
// (출력 속도 ~1.64x, TTFT 2.5x, 6배 저렴, ASR 품질 동급/개선. 공식 high-volume
//  transcription 권장 모델.) 음질 회귀 발견 시 mod.rs 의 이 상수만 되돌리면 됨.
pub const MODEL_AUDIO: &str = "gemini-3.1-flash-lite";
pub const MODEL_NOTES_GEMINI: &str = "gemini-3.1-pro-preview";
pub const MODEL_NOTES_CLAUDE: &str = "claude-sonnet-4-6";
#[allow(dead_code)] // OpenAI 호출 아직 미구현 — 미래 사용용 default
pub const MODEL_OPENAI_DEFAULT: &str = "gpt-5.4-mini-2026-03-17";

/// 단가 — USD per 1M tokens
pub fn pricing(model: &str) -> Option<(f64, f64)> {
    match model {
        "gemini-3.1-flash-image-preview" => Some((0.25, 1.50)),
        "gemini-3-pro-image-preview" => Some((2.00, 12.00)),
        "gemini-3.1-pro-preview" => Some((2.00, 12.00)),
        "gemini-3-flash-preview" => Some((0.50, 3.00)),
        "gemini-3.5-flash" => Some((1.50, 9.00)),
        "gemini-3.1-flash-lite" => Some((0.25, 1.50)), // 공식 단가 (2026-05)
        "claude-sonnet-4-6" => Some((3.00, 15.00)),
        _ => None,
    }
}

pub fn calc_cost(model: &str, input_tokens: u32, output_tokens: u32) -> f64 {
    match pricing(model) {
        Some((input_per_m, output_per_m)) => {
            (input_tokens as f64 / 1_000_000.0) * input_per_m
                + (output_tokens as f64 / 1_000_000.0) * output_per_m
        }
        None => 0.0,
    }
}

// ─── 공통 타입 ───

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageInfo {
    pub model: String,
    #[serde(rename = "inputTokens")]
    pub input_tokens: u32,
    #[serde(rename = "outputTokens")]
    pub output_tokens: u32,
    #[serde(rename = "costUsd")]
    pub cost_usd: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CostSummary {
    #[serde(rename = "totalCostUsd")]
    pub total_cost_usd: f64,
    #[serde(rename = "totalInputTokens")]
    pub total_input_tokens: u32,
    #[serde(rename = "totalOutputTokens")]
    pub total_output_tokens: u32,
    pub breakdown: Vec<UsageInfo>,
}

impl CostSummary {
    pub fn from_usages(usages: Vec<UsageInfo>) -> Self {
        Self {
            total_cost_usd: usages.iter().map(|u| u.cost_usd).sum(),
            total_input_tokens: usages.iter().map(|u| u.input_tokens).sum(),
            total_output_tokens: usages.iter().map(|u| u.output_tokens).sum(),
            breakdown: usages,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateResult {
    pub text: String,
    pub usage: UsageInfo,
}

/// LLM provider — 회의록 생성용
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum NotesProvider {
    Claude,
    Gemini,
}

impl Default for NotesProvider {
    fn default() -> Self {
        NotesProvider::Claude
    }
}

/// 회의록 상세도
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DetailLevel {
    Concise,
    Standard,
    Detailed,
    Verbatim,
}

impl Default for DetailLevel {
    fn default() -> Self {
        DetailLevel::Standard
    }
}

impl std::fmt::Display for DetailLevel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            DetailLevel::Concise => "concise",
            DetailLevel::Standard => "standard",
            DetailLevel::Detailed => "detailed",
            DetailLevel::Verbatim => "verbatim",
        };
        write!(f, "{}", s)
    }
}

impl std::fmt::Display for NotesProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            NotesProvider::Claude => "claude",
            NotesProvider::Gemini => "gemini",
        };
        write!(f, "{}", s)
    }
}

impl DetailLevel {
    pub fn instruction(&self) -> &'static str {
        match self {
            DetailLevel::Concise => "5~7줄 이내로 핵심만 압축. 세부 인용/설명 생략. 토픽이 많아도 묶어서 짧게.",
            DetailLevel::Standard => "템플릿 구조에 맞춰 균형 있게 작성. 각 섹션 평균 2~5문장. 핵심 발언은 간결한 요약.",
            DetailLevel::Detailed => "토픽별로 단락(3~6문장)으로 풍부하게 정리. 각 토픽에 핵심 발언 1~3개를 transcript 원문에 가깝게 인용(`> \"발언\"`). 숫자/고유명사/날짜는 그대로 보존.",
            DetailLevel::Verbatim => "주요 발언을 가능한 원문 그대로 적극 인용. 토픽별 5~10문장 + 인용 3개 이상. 미팅 시간 흐름이 살아있도록 작성.",
        }
    }
}

/// 변환 결과물 종류 — frontmatter type 필드
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EvidenceType {
    Ocr,
    Transcript,
    #[serde(rename = "meeting-note")]
    MeetingNote,
}

/// 변환 결과 파일을 저장할 기본 디렉토리.
/// ~/Documents/MarkMind/Conversions/<YYYY-MM-DD>/
pub fn conversions_dir() -> std::path::PathBuf {
    let docs = dirs::document_dir()
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from(".")));
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    docs.join("MarkMind").join("Conversions").join(today)
}

/// converter 버전 문자열 — frontmatter 출력용
pub fn converter_version() -> String {
    format!("markmind-converter v{}", env!("CARGO_PKG_VERSION"))
}

/// 현재 시각 KST 분 단위 — "YYYY-MM-DD HH:mm"
pub fn now_kst_minute() -> String {
    use chrono::{FixedOffset, Utc};
    let kst = FixedOffset::east_opt(9 * 3600).unwrap();
    Utc::now()
        .with_timezone(&kst)
        .format("%Y-%m-%d %H:%M")
        .to_string()
}
