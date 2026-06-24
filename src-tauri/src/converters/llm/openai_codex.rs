//! ChatGPT(Codex 구독) 클라이언트 — 본인 Codex CLI 로그인 토큰 재사용.
//!
//! 비공개 경로: `POST chatgpt.com/backend-api/codex/responses` (Responses API + SSE).
//! 공식 문서화되지 않아 헤더·바디·응답 형식이 codex 버전마다 바뀔 수 있다(미검증).
//! 진단 로그(status, 빈 출력 시 SSE 앞부분)를 남겨 형식 불일치를 빠르게 잡는다.
//! 토큰 값은 절대 로깅하지 않는다.

use crate::converters::error::{ConverterError, ConverterResult};
use crate::converters::{GenerateResult, UsageInfo};
use futures_util::StreamExt;
use std::time::Duration;

const CODEX_URL: &str = "https://chatgpt.com/backend-api/codex/responses";
const CONNECT_TIMEOUT_SECS: u64 = 30;
const REQUEST_TIMEOUT_SECS: u64 = 180;

pub async fn generate_text(
    access_token: &str,
    account_id: Option<&str>,
    model: &str,
    system: Option<&str>,
    prompt: &str,
    _max_output_tokens: Option<u32>,
) -> ConverterResult<GenerateResult> {
    generate_text_inner(access_token, account_id, model, system, prompt, false).await
}

pub async fn generate_text_without_total_timeout(
    access_token: &str,
    account_id: Option<&str>,
    model: &str,
    system: Option<&str>,
    prompt: &str,
    _max_output_tokens: Option<u32>,
) -> ConverterResult<GenerateResult> {
    generate_text_inner(access_token, account_id, model, system, prompt, true).await
}

async fn generate_text_inner(
    access_token: &str,
    account_id: Option<&str>,
    model: &str,
    system: Option<&str>,
    prompt: &str,
    without_total_timeout: bool,
) -> ConverterResult<GenerateResult> {
    // chatgpt.com Codex backend is not the public Responses API and currently rejects
    // `max_output_tokens` with HTTP 400. Keep the argument for call-site parity, but do
    // not send it on the subscription path.
    let body = serde_json::json!({
        "model": model,
        "instructions": system.unwrap_or(""),
        "input": [{ "role": "user", "content": prompt }],
        "stream": true,
        "store": false,
    });

    let mut builder =
        reqwest::Client::builder().connect_timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS));
    if !without_total_timeout {
        builder = builder.timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS));
    }
    let client = builder
        .build()
        .map_err(|e| ConverterError::Network(e.to_string()))?;
    let session_id = uuid::Uuid::new_v4().to_string();

    let mut rb = client
        .post(CODEX_URL)
        .header("authorization", format!("Bearer {}", access_token))
        .header("content-type", "application/json")
        .header("accept", "text/event-stream")
        .header("accept-encoding", "identity")
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
        return Err(ConverterError::Codex(format!(
            "HTTP {} — {}",
            status.as_u16(),
            snippet
        )));
    }

    let text = parse_sse_output_stream(resp).await?;

    if text.trim().is_empty() {
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

async fn parse_sse_output_stream(resp: reqwest::Response) -> ConverterResult<String> {
    let mut stream = resp.bytes_stream();
    let mut pending = String::new();
    let mut out = String::new();
    let mut head = String::new();
    let mut completed = false;
    let mut terminal_error: Option<String> = None;

    while let Some(chunk) = stream.next().await {
        let chunk = match chunk {
            Ok(chunk) => chunk,
            Err(err) => {
                let suffix = if out.trim().is_empty() {
                    String::new()
                } else {
                    " after partial output; partial output was discarded".to_string()
                };
                return Err(ConverterError::Network(format!("{err}{suffix}")));
            }
        };
        let text = String::from_utf8_lossy(&chunk);
        if head.len() < 500 {
            head.push_str(&text);
            if head.len() > 500 {
                head.truncate(500);
            }
        }
        pending.push_str(&text);
        while let Some(pos) = pending.find('\n') {
            let line = pending[..pos].trim_end_matches('\r').trim().to_string();
            pending = pending[pos + 1..].to_string();
            parse_sse_line_into(&line, &mut out, &mut completed, &mut terminal_error);
            if let Some(err) = terminal_error.take() {
                return Err(ConverterError::Codex(err));
            }
        }
    }
    if !pending.trim().is_empty() {
        parse_sse_line_into(
            pending.trim(),
            &mut out,
            &mut completed,
            &mut terminal_error,
        );
    }
    if let Some(err) = terminal_error {
        return Err(ConverterError::Codex(err));
    }
    if out.trim().is_empty() {
        eprintln!("[codex] 빈 출력 — SSE 앞부분: {}", head);
    }
    if !completed {
        return Err(ConverterError::Codex(
            "SSE stream ended before response.completed; partial output was discarded.".into(),
        ));
    }
    Ok(out)
}

/// Responses API SSE 파싱 — `data: {json}` 라인에서 출력 텍스트를 누적.
/// delta 스트림(`response.output_text.delta`)을 우선 쓰고, 비면 완료 이벤트의
/// 중첩 output 구조에서 fallback 추출한다(형식 변형 관용 흡수).
fn parse_sse_output(sse: &str) -> String {
    let mut out = String::new();
    let mut completed = false;
    let mut terminal_error = None;
    for line in sse.lines() {
        parse_sse_line_into(line, &mut out, &mut completed, &mut terminal_error);
    }
    out
}

fn parse_sse_line_into(
    line: &str,
    out: &mut String,
    completed: &mut bool,
    terminal_error: &mut Option<String>,
) {
    let line = line.trim();
    let Some(data) = line.strip_prefix("data:") else {
        return;
    };
    let data = data.trim();
    if data.is_empty() || data == "[DONE]" {
        return;
    }
    let Ok(v) = serde_json::from_str::<serde_json::Value>(data) else {
        return;
    };
    let t = v.get("type").and_then(|x| x.as_str()).unwrap_or("");
    match t {
        "response.output_text.delta" => {
            if let Some(d) = v.get("delta").and_then(|x| x.as_str()) {
                out.push_str(d);
            }
        }
        "response.completed" | "response.output_item.done" => {
            if t == "response.completed" {
                *completed = true;
            }
            if out.is_empty() {
                if let Some(txt) = extract_completed_text(&v) {
                    out.push_str(&txt);
                }
            }
        }
        "response.failed" | "response.incomplete" | "error" => {
            *terminal_error = Some(extract_terminal_error(&v));
        }
        _ => {}
    }
}

fn extract_terminal_error(v: &serde_json::Value) -> String {
    v.pointer("/response/error/message")
        .or_else(|| v.pointer("/error/message"))
        .or_else(|| v.pointer("/response/incomplete_details/reason"))
        .and_then(|x| x.as_str())
        .map(|msg| format!("Codex SSE terminal event: {msg}"))
        .unwrap_or_else(|| "Codex SSE terminal error event".to_string())
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
    if let Some(content) = v
        .get("item")
        .and_then(|i| i.get("content"))
        .and_then(|c| c.as_array())
    {
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

// ───────────────────────── 이미지 생성 (image_generation 툴) ─────────────────────────
//
// ChatGPT 구독으로 이미지 생성 — 텍스트와 같은 Responses API 에 `image_generation` 툴을
// 얹는다(mainline 모델 gpt-5.5 등). 반환은 base64 data URL 1개로 정규화 — API 키 경로
// (image_gen.rs)와 동일 형식이라 프론트 삽입/저장이 공급사·인증과 무관하게 공통 동작.
//
// 주의: codex backend 의 SSE 는 공식 OpenAI API 와 이미지 위치가 다르다(실측 2026-06-18):
//   - codex:  `response.output_item.done` 의 item(type=image_generation_call).result
//   - 공식 API: `response.completed` 의 response.output[].result
// 그래서 output_item.done 을 우선하고 completed·partial_image 를 폴백으로 둔다.
//
// 구독 호출은 codex usage limit 에 누적된다(이미지/텍스트 공통). 한도 초과 시 HTTP 429
//   `usage_limit_reached` 본문이 그대로 에러에 실려 프론트(imageGen.ts)가 안내로 변환한다.

/// 이미지 생성은 느리므로(특히 high/대형) 넉넉히 5분.
const IMAGE_TIMEOUT_SECS: u64 = 300;

/// codex 구독으로 이미지 생성. 반환은 `data:image/png;base64,...` 1개.
/// codex backend 는 image_generation 툴의 size/quality 를 무시한다(항상 1254x1254/low,
/// 실측 2026-06-19) → 보내지 않음. 비율은 호출부가 프롬프트로 후처리한다.
pub async fn generate_image(
    access_token: &str,
    account_id: Option<&str>,
    model: &str,
    prompt: &str,
) -> Result<Vec<String>, String> {
    let body = serde_json::json!({
        "model": model,
        "instructions": "",
        "input": [{ "role": "user", "content": prompt }],
        "stream": true,
        "store": false,
        "tools": [{ "type": "image_generation" }],
    });

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(IMAGE_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("HTTP 클라이언트 생성 실패: {e}"))?;
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
        .map_err(|e| format!("Codex 네트워크 오류: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        let raw = resp.text().await.unwrap_or_default();
        let snippet: String = raw.chars().take(500).collect();
        return Err(format!("Codex HTTP {} — {}", status.as_u16(), snippet));
    }

    let sse = resp
        .text()
        .await
        .map_err(|e| format!("Codex 네트워크 오류: {e}"))?;
    let b64 = extract_image_b64(&sse).ok_or_else(|| {
        // 형식 불일치 진단 — 앞부분만(이미지 base64 미포함 영역, 토큰 없음).
        let head: String = sse.chars().take(500).collect();
        eprintln!("[codex-image] 이미지 추출 실패 — SSE 앞부분: {}", head);
        "응답에서 이미지를 추출하지 못했습니다(형식 불일치). 로그를 확인하세요.".to_string()
    })?;
    Ok(vec![format!("data:image/png;base64,{}", b64)])
}

/// SSE 에서 생성 이미지 base64 추출. codex(output_item.done) 우선 → 공식 API(completed)
/// → partial_image 순 폴백. 형식 변형을 관용 흡수한다.
fn extract_image_b64(sse: &str) -> Option<String> {
    let mut from_item_done: Option<String> = None;
    let mut from_completed: Option<String> = None;
    let mut from_partial: Option<String> = None;

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
        match v.get("type").and_then(|x| x.as_str()).unwrap_or("") {
            // codex backend 최종 경로 — item(type=image_generation_call).result.
            "response.output_item.done" => {
                if let Some(b64) = image_call_result(v.get("item")) {
                    from_item_done = Some(b64);
                }
            }
            // 공식 OpenAI API 형식 폴백 — response.output[] 중 image_generation_call.result.
            "response.completed" => {
                if let Some(arr) = v
                    .get("response")
                    .and_then(|r| r.get("output"))
                    .and_then(|o| o.as_array())
                {
                    for item in arr {
                        if let Some(b64) = image_call_result(Some(item)) {
                            from_completed = Some(b64);
                        }
                    }
                }
            }
            // 최후 폴백 — 스트리밍 부분 이미지(완성본과 동일 크기로 오는 경우 있음).
            "response.image_generation_call.partial_image" => {
                if let Some(b64) = v
                    .get("partial_image_b64")
                    .and_then(|x| x.as_str())
                    .filter(|s| !s.is_empty())
                {
                    from_partial = Some(b64.to_string());
                }
            }
            _ => {}
        }
    }
    from_item_done.or(from_completed).or(from_partial)
}

/// item 이 image_generation_call 이면 그 result(base64) 반환.
fn image_call_result(item: Option<&serde_json::Value>) -> Option<String> {
    let item = item?;
    if item.get("type").and_then(|t| t.as_str()) != Some("image_generation_call") {
        return None;
    }
    item.get("result")
        .and_then(|r| r.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// codex backend 형식 — output_item.done 의 item.result 추출(우선순위 1).
    #[test]
    fn extract_image_from_output_item_done() {
        let sse = r#"data: {"type":"response.image_generation_call.partial_image","partial_image_b64":"UEFSVElBTA=="}
data: {"type":"response.output_item.done","item":{"type":"image_generation_call","result":"RklOQUw="}}
data: {"type":"response.completed","response":{"output":[]}}"#;
        assert_eq!(extract_image_b64(sse).as_deref(), Some("RklOQUw="));
    }

    /// 공식 OpenAI API 형식 — completed 의 output[].result 폴백.
    #[test]
    fn extract_image_from_completed_fallback() {
        let sse = r#"data: {"type":"response.completed","response":{"output":[{"type":"message"},{"type":"image_generation_call","result":"Q09NUExFVEVE"}]}}"#;
        assert_eq!(extract_image_b64(sse).as_deref(), Some("Q09NUExFVEVE"));
    }

    /// 둘 다 없으면 partial_image_b64 최후 폴백.
    #[test]
    fn extract_image_from_partial_last_resort() {
        let sse = r#"data: {"type":"response.image_generation_call.partial_image","partial_image_b64":"UEFSVElBTA=="}"#;
        assert_eq!(extract_image_b64(sse).as_deref(), Some("UEFSVElBTA=="));
    }

    /// 이미지 없는 텍스트 응답 → None(추출 실패 → 호출부가 에러 처리).
    #[test]
    fn extract_image_none_when_absent() {
        let sse = r#"data: {"type":"response.output_text.delta","delta":"hello"}
data: {"type":"response.completed","response":{"output":[{"type":"message"}]}}"#;
        assert_eq!(extract_image_b64(sse), None);
    }

    #[test]
    fn parse_sse_output_collects_text_deltas() {
        let sse = r#"data: {"type":"response.output_text.delta","delta":"<html>"}
data: {"type":"response.output_text.delta","delta":"ok</html>"}
data: [DONE]"#;
        assert_eq!(parse_sse_output(sse), "<html>ok</html>");
    }

    #[test]
    fn parse_sse_output_falls_back_to_completed_text() {
        let sse = r#"data: {"type":"response.completed","response":{"output":[{"content":[{"text":"done"}]}]}}"#;
        assert_eq!(parse_sse_output(sse), "done");
    }
}
