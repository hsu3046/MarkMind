//! xAI Grok API 키 클라이언트 — OpenAI 호환 chat completions + 이미지 생성.
//!
//! - 텍스트: `https://api.x.ai/v1/chat/completions` (OpenAI 호환, `Bearer XAI_API_KEY`).
//! - 이미지: `https://api.x.ai/v1/images/generations` (grok-imagine-*). gpt-image-2 와 달리
//!   **`aspect_ratio`(비율)와 `resolution`(1k/2k)을 직접 받는다** → size(WxH) 환산 불필요.
//!   출력은 jpg, `response_format: b64_json` 으로 받아 data URL 로 정규화(삽입/저장 공통).
//!
//! 구독(Grok Build CLI 토큰) 경로와 별개 — 이 모듈은 API 키 전용. 모델 ID 는 호출부
//! (aiModelConfig 의 카탈로그)에서 인자로 전달.

use serde::{Deserialize, Serialize};
use std::time::Duration;

const CHAT_URL: &str = "https://api.x.ai/v1/chat/completions";
const IMAGE_URL: &str = "https://api.x.ai/v1/images/generations";
/// 이미지는 2K 생성 시 수십 초 소요 가능 → 넉넉히 5분(텍스트는 별도 180s).
const IMAGE_TIMEOUT_SECS: u64 = 300;

// ───────────────────────── 텍스트 (chat completions) ─────────────────────────

#[derive(Serialize)]
struct ChatRequest<'a> {
    model: &'a str,
    messages: Vec<ChatMessage<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
}

#[derive(Serialize)]
struct ChatMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Deserialize)]
struct ChatResponse {
    choices: Vec<Choice>,
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

/// 단일 프롬프트 응답(API 키). system 은 messages[0] 로 분리. OpenAI 호환이라 표준
/// `max_tokens` 사용(OpenAI 의 max_completion_tokens 아님).
pub async fn generate_text(
    api_key: &str,
    model: &str,
    system: Option<&str>,
    prompt: &str,
) -> Result<String, String> {
    let mut messages = Vec::new();
    if let Some(s) = system {
        if !s.is_empty() {
            messages.push(ChatMessage { role: "system", content: s });
        }
    }
    messages.push(ChatMessage { role: "user", content: prompt });

    let body = ChatRequest {
        model,
        messages,
        max_tokens: Some(16000),
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| format!("HTTP 클라이언트 생성 실패: {e}"))?;

    let resp = client
        .post(CHAT_URL)
        .header("authorization", format!("Bearer {api_key}"))
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Grok 네트워크 오류: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        let raw = resp.text().await.unwrap_or_default();
        let snippet: String = raw.chars().take(400).collect();
        return Err(format!("Grok HTTP {} — {}", status.as_u16(), snippet));
    }

    let parsed: ChatResponse = resp
        .json()
        .await
        .map_err(|e| format!("Grok 응답 파싱 실패: {e}"))?;
    Ok(parsed
        .choices
        .into_iter()
        .next()
        .and_then(|c| c.message.content)
        .unwrap_or_default())
}

// ───────────────────────── 이미지 (grok-imagine-*) ─────────────────────────

/// 공통 resolution(1K/2K/4K) → Grok `resolution`. Grok 은 1k/2k 만 지원(4K 없음 → 2k).
fn grok_resolution(resolution: &str) -> &'static str {
    match resolution.to_uppercase().as_str() {
        "2K" | "4K" => "2k",
        _ => "1k",
    }
}

/// UI 비율 → Grok 허용 비율(공식: 1:1·3:4·4:3·9:16·16:9·2:3·3:2·1:2·2:1·19.5:9 등).
/// UI 의 21:9 는 Grok 미허용 → 최광각 19.5:9 로 매핑(미상은 1:1). 잘못된 값은 400 이라 거름.
fn grok_aspect_ratio(ar: &str) -> &'static str {
    match ar {
        "1:1" => "1:1",
        "3:4" => "3:4",
        "4:3" => "4:3",
        "9:16" => "9:16",
        "16:9" => "16:9",
        "2:3" => "2:3",
        "3:2" => "3:2",
        "1:2" => "1:2",
        "2:1" => "2:1",
        "21:9" => "19.5:9", // 울트라와이드 → Grok 최광각
        _ => "1:1",
    }
}

#[derive(Deserialize)]
struct ImageResponse {
    data: Option<Vec<ImageItem>>,
}

#[derive(Deserialize)]
struct ImageItem {
    b64_json: Option<String>,
    url: Option<String>,
}

/// 이미지 생성(model = grok-imagine-image-quality 등). aspect_ratio·resolution 직접 전달
/// (size 환산 불필요). 참조 이미지는 grok-imagine 미지원이라 받지 않는다(텍스트→이미지).
pub async fn generate_image(
    api_key: &str,
    model: &str,
    prompt: &str,
    aspect_ratio: &str,
    resolution: &str,
) -> Result<Vec<String>, String> {
    let body = serde_json::json!({
        "model": model,
        "prompt": prompt,
        "n": 1,
        "aspect_ratio": grok_aspect_ratio(aspect_ratio),
        "resolution": grok_resolution(resolution),
        "response_format": "b64_json",
    });

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(IMAGE_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("HTTP 클라이언트 생성 실패: {e}"))?;

    let resp = client
        .post(IMAGE_URL)
        .header("authorization", format!("Bearer {api_key}"))
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Grok 네트워크 오류: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        let raw = resp.text().await.unwrap_or_default();
        let snippet: String = raw.chars().take(400).collect();
        return Err(format!("Grok HTTP {} — {}", status.as_u16(), snippet));
    }

    let parsed: ImageResponse = resp
        .json()
        .await
        .map_err(|e| format!("Grok 응답 파싱 실패: {e}"))?;
    let items = parsed.data.unwrap_or_default();
    if items.is_empty() {
        return Err("Grok에서 이미지를 생성하지 못했습니다.".to_string());
    }
    // grok-imagine 출력은 jpg. b64_json 우선, url 폴백.
    let urls: Vec<String> = items
        .into_iter()
        .filter_map(|item| {
            item.b64_json
                .map(|b64| format!("data:image/jpeg;base64,{b64}"))
                .or(item.url)
        })
        .collect();
    if urls.is_empty() {
        return Err("Grok 응답에 이미지가 포함되지 않았습니다.".to_string());
    }
    Ok(urls)
}

#[cfg(test)]
mod tests {
    use super::grok_resolution;

    #[test]
    fn resolution_maps_to_grok_tiers() {
        assert_eq!(grok_resolution("1K"), "1k");
        assert_eq!(grok_resolution("2K"), "2k");
        assert_eq!(grok_resolution("4K"), "2k"); // Grok 은 4K 없음 → 2k
        assert_eq!(grok_resolution("2k"), "2k"); // 소문자 입력도 정규화
        assert_eq!(grok_resolution(""), "1k");
    }
}
