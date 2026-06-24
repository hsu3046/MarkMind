//! Gemini API 클라이언트 — doc-converter src/services/gemini.ts 포팅.
//!
//! - generate_text: inline base64 (이미지/오디오)
//! - generate_text_with_file_api: 대용량 파일 (PDF, 긴 오디오) — upload → polling → 처리 → 삭제
//! - withRetry: exponential backoff (429/500/502/503/504, 네트워크 일시 단절)
//! - friendly_error: 사용자 표시 메시지 분류

use crate::converters::error::{ConverterError, ConverterResult};
use crate::converters::{calc_cost, GenerateResult, UsageInfo};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::Duration;

const GENERATE_URL: &str = "https://generativelanguage.googleapis.com/v1beta/models";
const UPLOAD_URL: &str = "https://generativelanguage.googleapis.com/upload/v1beta/files";

const MAX_RETRIES: u32 = 4;
const POLL_INTERVAL: Duration = Duration::from_secs(2);
const CONNECT_TIMEOUT_SECS: u64 = 30;
const REQUEST_TIMEOUT_SECS: u64 = 600;

pub struct InlineData {
    pub mime_type: String,
    pub data_base64: String,
}

#[derive(Default)]
pub struct GenerationConfig {
    pub max_output_tokens: Option<u32>,
    pub temperature: Option<f32>,
}

// ─── Request / Response 타입 ───

#[derive(Serialize)]
struct GenerateRequest {
    contents: Vec<Content>,
    #[serde(rename = "generationConfig", skip_serializing_if = "Option::is_none")]
    generation_config: Option<GenerationConfigBody>,
}

#[derive(Serialize)]
struct Content {
    role: String,
    parts: Vec<Part>,
}

#[derive(Serialize)]
#[serde(untagged)]
enum Part {
    Text {
        text: String,
    },
    InlineData {
        #[serde(rename = "inlineData")]
        inline_data: InlineDataBody,
    },
    FileData {
        #[serde(rename = "fileData")]
        file_data: FileDataBody,
    },
}

#[derive(Serialize)]
struct InlineDataBody {
    #[serde(rename = "mimeType")]
    mime_type: String,
    data: String,
}

#[derive(Serialize)]
struct FileDataBody {
    #[serde(rename = "mimeType")]
    mime_type: String,
    #[serde(rename = "fileUri")]
    file_uri: String,
}

#[derive(Serialize)]
struct GenerationConfigBody {
    #[serde(rename = "maxOutputTokens", skip_serializing_if = "Option::is_none")]
    max_output_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
}

#[derive(Deserialize)]
struct GenerateResponse {
    candidates: Option<Vec<Candidate>>,
    #[serde(rename = "usageMetadata")]
    usage_metadata: Option<UsageMetadata>,
    #[serde(rename = "promptFeedback")]
    #[allow(dead_code)]
    prompt_feedback: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct Candidate {
    content: Option<CandidateContent>,
    #[serde(rename = "finishReason")]
    #[allow(dead_code)]
    finish_reason: Option<String>,
}

#[derive(Deserialize)]
struct CandidateContent {
    parts: Option<Vec<CandidatePart>>,
}

#[derive(Deserialize)]
struct CandidatePart {
    text: Option<String>,
}

#[derive(Deserialize)]
struct UsageMetadata {
    #[serde(rename = "promptTokenCount")]
    prompt_token_count: Option<u32>,
    #[serde(rename = "candidatesTokenCount")]
    candidates_token_count: Option<u32>,
}

#[derive(Deserialize)]
struct GeminiErrorEnv {
    error: GeminiError,
}

#[derive(Deserialize)]
struct GeminiError {
    code: Option<i32>,
    message: String,
    status: Option<String>,
}

// ─── File API ───

#[derive(Deserialize)]
struct FileUploadResponse {
    file: GeminiFile,
}

#[derive(Deserialize, Clone)]
struct GeminiFile {
    name: String,
    uri: String,
    state: Option<String>,
}

// ─── inline 호출 ───

pub async fn generate_text(
    api_key: &str,
    model: &str,
    prompt: &str,
    inline: Vec<InlineData>,
    config: Option<GenerationConfig>,
) -> ConverterResult<GenerateResult> {
    generate_text_inner(api_key, model, prompt, inline, config, false).await
}

pub async fn generate_text_without_total_timeout(
    api_key: &str,
    model: &str,
    prompt: &str,
    inline: Vec<InlineData>,
    config: Option<GenerationConfig>,
) -> ConverterResult<GenerateResult> {
    generate_text_inner(api_key, model, prompt, inline, config, true).await
}

async fn generate_text_inner(
    api_key: &str,
    model: &str,
    prompt: &str,
    inline: Vec<InlineData>,
    config: Option<GenerationConfig>,
    without_total_timeout: bool,
) -> ConverterResult<GenerateResult> {
    let mut parts: Vec<Part> = inline
        .into_iter()
        .map(|d| Part::InlineData {
            inline_data: InlineDataBody {
                mime_type: d.mime_type,
                data: d.data_base64,
            },
        })
        .collect();
    parts.push(Part::Text {
        text: prompt.to_string(),
    });
    let body = GenerateRequest {
        contents: vec![Content {
            role: "user".to_string(),
            parts,
        }],
        generation_config: config.map(|c| GenerationConfigBody {
            max_output_tokens: c.max_output_tokens,
            temperature: c.temperature,
        }),
    };

    let url = format!("{}/{}:generateContent?key={}", GENERATE_URL, model, api_key);
    call_generate(
        &url,
        &body,
        model,
        &format!("generateContent({})", model),
        without_total_timeout,
    )
    .await
}

pub async fn generate_text_with_file_api(
    api_key: &str,
    model: &str,
    prompt: &str,
    file_path: &Path,
    mime_type: &str,
    on_progress: Option<&(dyn Fn(&str) + Sync)>,
) -> ConverterResult<GenerateResult> {
    let report = |msg: &str| {
        if let Some(cb) = on_progress {
            cb(msg);
        }
    };

    report("📡 Gemini File API 에 업로드 중...");
    let uploaded = upload_file(api_key, file_path, mime_type).await?;
    report(&format!("✅ 업로드 완료 ({})", uploaded.name));

    // ACTIVE 까지 polling
    let mut current = uploaded.clone();
    if current.state.as_deref() == Some("PROCESSING") || current.state.is_none() {
        let start = std::time::Instant::now();
        loop {
            tokio::time::sleep(POLL_INTERVAL).await;
            match get_file_status(api_key, &current.name).await {
                Ok(info) => {
                    current = info;
                    match current.state.as_deref() {
                        Some("ACTIVE") => {
                            let elapsed = start.elapsed().as_secs();
                            report(&format!("✅ 파일 준비 완료 ({}초 대기)", elapsed));
                            break;
                        }
                        Some("FAILED") => {
                            let _ = delete_file(api_key, &current.name).await;
                            return Err(ConverterError::Gemini(format!(
                                "File API 처리 실패: {}",
                                current.name
                            )));
                        }
                        _ => {
                            let elapsed = start.elapsed().as_secs();
                            report(&format!("⏳ 파일 처리 중... ({}초 경과)", elapsed));
                        }
                    }
                }
                Err(ConverterError::Network(_)) => {
                    report("⏳ 네트워크 일시 단절, 재시도 중...");
                    continue;
                }
                Err(e) => {
                    let _ = delete_file(api_key, &current.name).await;
                    return Err(e);
                }
            }
        }
    }

    // generateContent (file URI)
    let body = GenerateRequest {
        contents: vec![Content {
            role: "user".to_string(),
            parts: vec![
                Part::FileData {
                    file_data: FileDataBody {
                        mime_type: mime_type.to_string(),
                        file_uri: current.uri.clone(),
                    },
                },
                Part::Text {
                    text: prompt.to_string(),
                },
            ],
        }],
        generation_config: None,
    };
    let url = format!("{}/{}:generateContent?key={}", GENERATE_URL, model, api_key);
    let result = call_generate(
        &url,
        &body,
        model,
        &format!("generateContent(file {})", model),
        false,
    )
    .await;

    // 항상 삭제 (성공/실패 무관)
    let _ = delete_file(api_key, &current.name).await;
    result
}

async fn upload_file(
    api_key: &str,
    file_path: &Path,
    mime_type: &str,
) -> ConverterResult<GeminiFile> {
    let file_bytes = tokio::fs::read(file_path).await?;
    let file_size = file_bytes.len();
    let display_name = file_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("upload")
        .to_string();

    let client = build_client(false)?;
    let mime_owned = mime_type.to_string();

    // Resumable upload protocol — start, then upload.
    let start_url = format!("{}?key={}", UPLOAD_URL, api_key);
    let metadata = serde_json::json!({
        "file": { "display_name": display_name }
    })
    .to_string();
    let start_resp = with_retry("files.upload.start", || {
        let client = client.clone();
        let url = start_url.clone();
        let mime = mime_owned.clone();
        let body = metadata.clone();
        let size_hdr = file_size.to_string();
        async move {
            client
                .post(&url)
                .header("X-Goog-Upload-Protocol", "resumable")
                .header("X-Goog-Upload-Command", "start")
                .header("X-Goog-Upload-Header-Content-Length", size_hdr)
                .header("X-Goog-Upload-Header-Content-Type", mime)
                .header("content-type", "application/json")
                .body(body)
                .send()
                .await
                .map_err(http_to_converter)
        }
    })
    .await?;

    if !start_resp.status().is_success() {
        let body = start_resp.text().await.unwrap_or_default();
        return Err(ConverterError::Gemini(format!(
            "File API upload start 실패: {}",
            parse_gemini_error(&body)
        )));
    }
    let upload_url = start_resp
        .headers()
        .get("X-Goog-Upload-URL")
        .or_else(|| start_resp.headers().get("x-goog-upload-url"))
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| ConverterError::Gemini("File API upload URL 누락".into()))?
        .to_string();

    let upload_resp = with_retry("files.upload.bytes", || {
        let client = client.clone();
        let body = file_bytes.clone();
        let url = upload_url.clone();
        async move {
            client
                .post(&url)
                .header("X-Goog-Upload-Offset", "0")
                .header("X-Goog-Upload-Command", "upload, finalize")
                .header("content-length", body.len().to_string())
                .body(body)
                .send()
                .await
                .map_err(http_to_converter)
        }
    })
    .await?;

    if !upload_resp.status().is_success() {
        let body = upload_resp.text().await.unwrap_or_default();
        return Err(ConverterError::Gemini(format!(
            "File API upload bytes 실패: {}",
            parse_gemini_error(&body)
        )));
    }
    let parsed: FileUploadResponse = upload_resp
        .json()
        .await
        .map_err(|e| ConverterError::Gemini(format!("File API 응답 파싱 실패: {}", e)))?;
    Ok(parsed.file)
}

async fn get_file_status(api_key: &str, name: &str) -> ConverterResult<GeminiFile> {
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/{}?key={}",
        name, api_key
    );
    let client = build_client(false)?;
    let resp = client.get(&url).send().await.map_err(http_to_converter)?;
    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(ConverterError::Gemini(format!(
            "File API status 조회 실패: {}",
            parse_gemini_error(&body)
        )));
    }
    let info: GeminiFile = resp
        .json()
        .await
        .map_err(|e| ConverterError::Gemini(format!("File API 응답 파싱 실패: {}", e)))?;
    Ok(info)
}

async fn delete_file(api_key: &str, name: &str) -> ConverterResult<()> {
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/{}?key={}",
        name, api_key
    );
    let client = build_client(false)?;
    let _ = client.delete(&url).send().await;
    Ok(())
}

// ─── 공통 호출 + 재시도 ───

async fn call_generate(
    url: &str,
    body: &GenerateRequest,
    model: &str,
    label: &str,
    without_total_timeout: bool,
) -> ConverterResult<GenerateResult> {
    let client = build_client(without_total_timeout)?;
    let body_bytes = serde_json::to_vec(body)?;
    let url_owned = url.to_string();
    let resp = with_retry(label, || {
        let client = client.clone();
        let body = body_bytes.clone();
        let url = url_owned.clone();
        async move {
            client
                .post(&url)
                .header("content-type", "application/json")
                .body(body)
                .send()
                .await
                .map_err(http_to_converter)
        }
    })
    .await?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(classify_status_error(status.as_u16(), &body));
    }
    let parsed: GenerateResponse = resp
        .json()
        .await
        .map_err(|e| ConverterError::Gemini(format!("응답 JSON 파싱 실패: {}", e)))?;
    let text = parsed
        .candidates
        .unwrap_or_default()
        .into_iter()
        .filter_map(|c| c.content.and_then(|cc| cc.parts))
        .flat_map(|ps| ps.into_iter().filter_map(|p| p.text))
        .collect::<Vec<_>>()
        .join("");
    let usage = parsed.usage_metadata.unwrap_or(UsageMetadata {
        prompt_token_count: None,
        candidates_token_count: None,
    });
    let input_tokens = usage.prompt_token_count.unwrap_or(0);
    let output_tokens = usage.candidates_token_count.unwrap_or(0);
    Ok(GenerateResult {
        text: clean_text(text),
        usage: UsageInfo {
            model: model.to_string(),
            input_tokens,
            output_tokens,
            cost_usd: calc_cost(model, input_tokens, output_tokens),
        },
    })
}

fn build_client(without_total_timeout: bool) -> ConverterResult<reqwest::Client> {
    let mut builder =
        reqwest::Client::builder().connect_timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS));
    if !without_total_timeout {
        builder = builder.timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS));
    }
    builder.build().map_err(ConverterError::from)
}

async fn with_retry<F, Fut, T>(label: &str, mut f: F) -> ConverterResult<T>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = ConverterResult<T>>,
{
    let mut last_err: Option<ConverterError> = None;
    for attempt in 1..=MAX_RETRIES {
        match f().await {
            Ok(v) => return Ok(v),
            Err(e) => {
                let retryable = is_retryable_error(&e);
                if attempt < MAX_RETRIES && retryable {
                    let backoff = backoff_ms(attempt);
                    log::warn!(
                        "[gemini] {} 시도 {}/{} 실패 ({:?}), {}ms 후 재시도",
                        label,
                        attempt,
                        MAX_RETRIES,
                        e,
                        backoff
                    );
                    last_err = Some(e);
                    tokio::time::sleep(Duration::from_millis(backoff)).await;
                    continue;
                }
                return Err(e);
            }
        }
    }
    Err(last_err.unwrap_or_else(|| ConverterError::Gemini("재시도 한도 초과".into())))
}

fn http_to_converter(e: reqwest::Error) -> ConverterError {
    if e.is_timeout() || e.is_connect() || e.is_request() {
        ConverterError::Network(e.to_string())
    } else {
        ConverterError::Http(e)
    }
}

fn is_retryable_error(e: &ConverterError) -> bool {
    matches!(
        e,
        ConverterError::Network(_) | ConverterError::Overloaded | ConverterError::RateLimit
    )
}

fn backoff_ms(attempt: u32) -> u64 {
    let base = 1000u64;
    (base * 2u64.pow(attempt - 1)).min(8000)
}

fn classify_status_error(status: u16, body: &str) -> ConverterError {
    let msg = parse_gemini_error(body);
    if msg.contains("INVALID_ARGUMENT") {
        return ConverterError::InvalidArgument;
    }
    match status {
        400 if msg.contains("API key not valid") || msg.contains("INVALID_ARGUMENT") => {
            ConverterError::Gemini(format!(
                "API 키가 잘못되었거나 입력이 유효하지 않습니다: {}",
                msg
            ))
        }
        401 | 403 => ConverterError::Gemini(format!("API 키 권한 오류: {}", msg)),
        429 => ConverterError::RateLimit,
        503 => ConverterError::Overloaded,
        500 | 502 | 504 => ConverterError::Overloaded,
        _ => ConverterError::Gemini(format!("HTTP {} — {}", status, msg)),
    }
}

fn parse_gemini_error(body: &str) -> String {
    if let Ok(env) = serde_json::from_str::<GeminiErrorEnv>(body) {
        format!(
            "{} {}: {}",
            env.error.code.unwrap_or(0),
            env.error.status.as_deref().unwrap_or("UNKNOWN"),
            env.error.message
        )
    } else {
        body.chars().take(300).collect()
    }
}

/// markdown 코드블록 래퍼 제거 (Gemini 가 종종 ```markdown ... ``` 로 감싸서 반환)
fn clean_text(text: String) -> String {
    let trimmed = text.trim();
    let stripped = trimmed
        .strip_prefix("```markdown\n")
        .or_else(|| trimmed.strip_prefix("```md\n"))
        .or_else(|| trimmed.strip_prefix("```\n"))
        .unwrap_or(trimmed);
    let stripped = stripped
        .strip_suffix("```")
        .map(|s| s.trim_end())
        .unwrap_or(stripped);
    stripped.to_string()
}
