//! Claude API 클라이언트 — doc-converter src/services/anthropic.ts 포팅.
//!
//! Anthropic SDK 의 자동 재시도(default max_retries=2) 동작을 직접 구현.
//! - generateText: messages API 단일 호출 (텍스트만)
//! - friendlyError: RateLimit / Auth / Overloaded 분류

use crate::converters::error::{ConverterError, ConverterResult};
use crate::converters::{calc_cost, GenerateResult, UsageInfo};
use serde::{Deserialize, Serialize};
use std::time::Duration;

const API_URL: &str = "https://api.anthropic.com/v1/messages";
const API_VERSION: &str = "2023-06-01";
const DEFAULT_MAX_TOKENS: u32 = 16000;
const MAX_RETRIES: u32 = 3;

#[derive(Default)]
pub struct ClaudeOptions {
    pub max_output_tokens: Option<u32>,
    pub system: Option<String>,
}

#[derive(Serialize)]
struct MessageRequest<'a> {
    model: &'a str,
    max_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<&'a str>,
    messages: Vec<UserMessage<'a>>,
}

#[derive(Serialize)]
struct UserMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Deserialize)]
struct MessageResponse {
    content: Vec<ContentBlock>,
    usage: Usage,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ContentBlock {
    Text { text: String },
    #[serde(other)]
    Other,
}

#[derive(Deserialize)]
struct Usage {
    input_tokens: u32,
    output_tokens: u32,
}

#[derive(Deserialize)]
struct AnthropicError {
    error: AnthropicErrorBody,
}

#[derive(Deserialize)]
struct AnthropicErrorBody {
    #[serde(rename = "type")]
    err_type: String,
    message: String,
}

pub async fn generate_text(
    api_key: &str,
    model: &str,
    prompt: &str,
    options: Option<ClaudeOptions>,
) -> ConverterResult<GenerateResult> {
    let opts = options.unwrap_or_default();
    let max_tokens = opts.max_output_tokens.unwrap_or(DEFAULT_MAX_TOKENS);

    let body = MessageRequest {
        model,
        max_tokens,
        system: opts.system.as_deref(),
        messages: vec![UserMessage {
            role: "user",
            content: prompt,
        }],
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()?;

    let mut last_err: Option<ConverterError> = None;
    for attempt in 1..=MAX_RETRIES {
        let resp = client
            .post(API_URL)
            .header("x-api-key", api_key)
            .header("anthropic-version", API_VERSION)
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await;

        match resp {
            Ok(r) => {
                let status = r.status();
                if status.is_success() {
                    let parsed: MessageResponse = r.json().await?;
                    let text = parsed
                        .content
                        .into_iter()
                        .filter_map(|b| match b {
                            ContentBlock::Text { text } => Some(text),
                            ContentBlock::Other => None,
                        })
                        .collect::<Vec<_>>()
                        .join("");
                    let usage = UsageInfo {
                        model: model.to_string(),
                        input_tokens: parsed.usage.input_tokens,
                        output_tokens: parsed.usage.output_tokens,
                        cost_usd: calc_cost(model, parsed.usage.input_tokens, parsed.usage.output_tokens),
                    };
                    return Ok(GenerateResult { text, usage });
                }

                let status_code = status.as_u16();
                let raw_body = r.text().await.unwrap_or_default();
                let err_msg = parse_error_message(&raw_body);
                let err = classify_error(status_code, &err_msg);

                if attempt < MAX_RETRIES && is_retryable_status(status_code) {
                    let backoff = backoff_ms(attempt);
                    log::warn!(
                        "[claude] {} 시도 {}/{} 실패 ({}), {}ms 후 재시도",
                        model, attempt, MAX_RETRIES, status_code, backoff
                    );
                    last_err = Some(err);
                    tokio::time::sleep(Duration::from_millis(backoff)).await;
                    continue;
                }
                return Err(err);
            }
            Err(e) => {
                if attempt < MAX_RETRIES && (e.is_timeout() || e.is_connect()) {
                    let backoff = backoff_ms(attempt);
                    log::warn!(
                        "[claude] {} 네트워크 오류 {}/{} ({}), {}ms 후 재시도",
                        model, attempt, MAX_RETRIES, e, backoff
                    );
                    last_err = Some(ConverterError::Network(e.to_string()));
                    tokio::time::sleep(Duration::from_millis(backoff)).await;
                    continue;
                }
                return Err(ConverterError::Network(e.to_string()));
            }
        }
    }
    Err(last_err.unwrap_or_else(|| ConverterError::Claude("재시도 한도 초과".into())))
}

fn classify_error(status: u16, body_msg: &str) -> ConverterError {
    match status {
        401 | 403 => ConverterError::Claude("CLAUDE_API_KEY 가 잘못되었습니다. Settings 에서 확인하세요.".into()),
        429 => ConverterError::RateLimit,
        503 | 529 => ConverterError::Overloaded,
        _ => ConverterError::Claude(format!("HTTP {} — {}", status, body_msg)),
    }
}

fn parse_error_message(body: &str) -> String {
    if let Ok(parsed) = serde_json::from_str::<AnthropicError>(body) {
        format!("{}: {}", parsed.error.err_type, parsed.error.message)
    } else {
        body.chars().take(200).collect()
    }
}

fn is_retryable_status(status: u16) -> bool {
    matches!(status, 429 | 500 | 502 | 503 | 504 | 529)
}

fn backoff_ms(attempt: u32) -> u64 {
    let base = 1000u64;
    (base * 2u64.pow(attempt - 1)).min(8000)
}
