//! ChatGPT(Codex 구독) 클라이언트 — 본인 Codex CLI 로그인 토큰 재사용.
//!
//! 비공개 경로: `POST chatgpt.com/backend-api/codex/responses` (Responses API + SSE).
//! 공식 문서화되지 않아 헤더·바디·응답 형식이 codex 버전마다 바뀔 수 있다(미검증).
//! 진단 로그(status, 빈 출력 시 SSE 앞부분)를 남겨 형식 불일치를 빠르게 잡는다.
//! 토큰 값은 절대 로깅하지 않는다.

use crate::converters::error::{ConverterError, ConverterResult};
use crate::converters::{GenerateResult, UsageInfo};
use std::time::Duration;

const CODEX_URL: &str = "https://chatgpt.com/backend-api/codex/responses";

pub async fn generate_text(
    access_token: &str,
    account_id: Option<&str>,
    model: &str,
    system: Option<&str>,
    prompt: &str,
) -> ConverterResult<GenerateResult> {
    let body = serde_json::json!({
        "model": model,
        "instructions": system.unwrap_or(""),
        "input": [{ "role": "user", "content": prompt }],
        "stream": true,
        "store": false,
    });

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| ConverterError::Network(e.to_string()))?;
    let session_id = uuid::Uuid::new_v4().to_string();

    let mut rb = client
        .post(CODEX_URL)
        .header("authorization", format!("Bearer {}", access_token))
        .header("content-type", "application/json")
        .header("accept", "text/event-stream")
        .header("originator", "codex_cli_rs")
        .header("openai-beta", "responses=experimental")
        .header("session_id", &session_id);
    if let Some(acc) = account_id {
        rb = rb.header("chatgpt-account-id", acc);
    }

    let resp = rb
        .json(&body)
        .send()
        .await
        .map_err(|e| ConverterError::Network(e.to_string()))?;
    let status = resp.status();

    if !status.is_success() {
        let raw = resp.text().await.unwrap_or_default();
        let snippet: String = raw.chars().take(500).collect();
        eprintln!("[codex] 에러 본문: {}", snippet);
        return Err(ConverterError::Codex(format!("HTTP {} — {}", status.as_u16(), snippet)));
    }

    let sse = resp
        .text()
        .await
        .map_err(|e| ConverterError::Network(e.to_string()))?;
    let text = parse_sse_output(&sse);

    if text.trim().is_empty() {
        // 형식 불일치 진단 — 앞부분만(모델 출력 구조, 토큰/민감정보 없음).
        let head: String = sse.chars().take(500).collect();
        eprintln!("[codex] 빈 출력 — SSE 앞부분: {}", head);
        return Err(ConverterError::Codex(
            "응답에서 텍스트를 추출하지 못했습니다(형식 불일치). 로그를 확인하세요.".into(),
        ));
    }

    Ok(GenerateResult {
        text,
        // 구독 호출은 토큰/비용 정보가 표준 형식으로 오지 않으므로 0 으로 둔다.
        usage: UsageInfo {
            model: model.to_string(),
            input_tokens: 0,
            output_tokens: 0,
            cost_usd: 0.0,
        },
    })
}

/// Responses API SSE 파싱 — `data: {json}` 라인에서 출력 텍스트를 누적.
/// delta 스트림(`response.output_text.delta`)을 우선 쓰고, 비면 완료 이벤트의
/// 중첩 output 구조에서 fallback 추출한다(형식 변형 관용 흡수).
fn parse_sse_output(sse: &str) -> String {
    let mut out = String::new();
    for line in sse.lines() {
        let line = line.trim();
        let Some(data) = line.strip_prefix("data:") else {
            continue;
        };
        let data = data.trim();
        if data.is_empty() || data == "[DONE]" {
            continue;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(data) else {
            continue;
        };
        let t = v.get("type").and_then(|x| x.as_str()).unwrap_or("");
        match t {
            "response.output_text.delta" => {
                if let Some(d) = v.get("delta").and_then(|x| x.as_str()) {
                    out.push_str(d);
                }
            }
            "response.completed" | "response.output_item.done" => {
                if out.is_empty() {
                    if let Some(txt) = extract_completed_text(&v) {
                        out.push_str(&txt);
                    }
                }
            }
            _ => {}
        }
    }
    out
}

/// 완료 이벤트의 중첩 구조에서 output_text 텍스트를 긁어온다.
/// `response.output[].content[].text` 와 `item.content[].text` 두 변형을 탐색.
fn extract_completed_text(v: &serde_json::Value) -> Option<String> {
    let mut acc = String::new();
    if let Some(arr) = v
        .get("response")
        .and_then(|r| r.get("output"))
        .and_then(|o| o.as_array())
    {
        for item in arr {
            if let Some(content) = item.get("content").and_then(|c| c.as_array()) {
                for c in content {
                    if let Some(txt) = c.get("text").and_then(|t| t.as_str()) {
                        acc.push_str(txt);
                    }
                }
            }
        }
    }
    if let Some(content) = v.get("item").and_then(|i| i.get("content")).and_then(|c| c.as_array()) {
        for c in content {
            if let Some(txt) = c.get("text").and_then(|t| t.as_str()) {
                acc.push_str(txt);
            }
        }
    }
    if acc.is_empty() {
        None
    } else {
        Some(acc)
    }
}
