//! OpenAI API 키 클라이언트 — 표준 chat completions(공식). 구독(codex) 경로와 별개.
//!
//! GPT-5 계열은 `max_completion_tokens` 사용(`max_tokens` 아님). temperature 등은
//! 기본값으로 두어 reasoning 모델 호환성을 확보한다(일부 GPT-5 모델이 temperature 제약).

use crate::converters::error::{ConverterError, ConverterResult};
use crate::converters::{GenerateResult, UsageInfo};
use serde::{Deserialize, Serialize};
use std::time::Duration;

const API_URL: &str = "https://api.openai.com/v1/chat/completions";

#[derive(Serialize)]
struct ChatRequest<'a> {
    model: &'a str,
    messages: Vec<ChatMessage<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_completion_tokens: Option<u32>,
}

#[derive(Serialize)]
struct ChatMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Deserialize)]
struct ChatResponse {
    choices: Vec<Choice>,
    #[serde(default)]
    usage: Option<Usage>,
}

#[derive(Deserialize)]
struct Choice {
    message: RespMessage,
}

#[derive(Deserialize)]
struct RespMessage {
    #[serde(default)]
    content: Option<String>,
}

#[derive(Deserialize)]
struct Usage {
    #[serde(default)]
    prompt_tokens: u32,
    #[serde(default)]
    completion_tokens: u32,
}

pub async fn generate_text(
    api_key: &str,
    model: &str,
    system: Option<&str>,
    prompt: &str,
) -> ConverterResult<GenerateResult> {
    let mut messages = Vec::new();
    if let Some(s) = system {
        if !s.is_empty() {
            messages.push(ChatMessage {
                role: "system",
                content: s,
            });
        }
    }
    messages.push(ChatMessage {
        role: "user",
        content: prompt,
    });

    let body = ChatRequest {
        model,
        messages,
        max_completion_tokens: Some(16000),
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| ConverterError::Network(e.to_string()))?;

    let resp = client
        .post(API_URL)
        .header("authorization", format!("Bearer {}", api_key))
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| ConverterError::Network(e.to_string()))?;

    let status = resp.status();
    if !status.is_success() {
        let raw = resp.text().await.unwrap_or_default();
        let snippet: String = raw.chars().take(400).collect();
        return Err(ConverterError::OpenAi(format!(
            "OpenAI HTTP {} — {}",
            status.as_u16(),
            snippet
        )));
    }

    let parsed: ChatResponse = resp
        .json()
        .await
        .map_err(|e| ConverterError::OpenAi(format!("OpenAI 응답 파싱 실패: {e}")))?;
    let text = parsed
        .choices
        .into_iter()
        .next()
        .and_then(|c| c.message.content)
        .unwrap_or_default();
    let usage = parsed.usage.unwrap_or(Usage {
        prompt_tokens: 0,
        completion_tokens: 0,
    });

    Ok(GenerateResult {
        text,
        usage: UsageInfo {
            model: model.to_string(),
            input_tokens: usage.prompt_tokens,
            output_tokens: usage.completion_tokens,
            cost_usd: 0.0,
        },
    })
}
