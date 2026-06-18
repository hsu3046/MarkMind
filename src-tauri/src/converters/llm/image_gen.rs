//! 이미지 생성 — Gemini 3.1 Flash Image / OpenAI gpt-image-1.
//!
//! lumina-studio `imageGen.ts` 의 handleGemini/handleOpenAI 를 Rust(reqwest)로 포팅.
//! WKWebView 의 fetch CORS 제약을 피하려 네이티브 HTTP 로 호출(텍스트 LLM 과 동일 경로).
//! 참조 이미지는 프론트에서 `data:image/...;base64,...` 문자열로 전달.
//! 두 공급사 모두 결과를 base64 data URL 배열(개수 1)로 정규화해 반환 — 삽입/저장 공통.
//!
//! 에러는 `<provider> HTTP <status> — <snippet>` 형태 String 으로 반환하고,
//! 사용자용 메시지 변환(humanize)은 프론트(imageGen.ts)에서 수행한다.

use base64::Engine;
use serde::Deserialize;
use std::time::Duration;

/// 이미지 생성은 4K/참조 등으로 텍스트보다 느릴 수 있어 넉넉히.
const TIMEOUT_SECS: u64 = 180;

/// data URL(`data:{mime};base64,{data}`) → (mime, base64) 분리. 형식 불일치 시 None.
fn parse_data_url(s: &str) -> Option<(String, String)> {
    let rest = s.strip_prefix("data:")?;
    let (mime, b64) = rest.split_once(";base64,")?;
    if mime.is_empty() || b64.is_empty() {
        return None;
    }
    Some((mime.to_string(), b64.to_string()))
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("HTTP 클라이언트 생성 실패: {e}"))
}

/// 참조 이미지가 붙은 경우 프롬프트 앞에 사용 지시를 덧붙인다(lumina 와 동일 문구).
fn prompt_with_refs(prompt: &str, ref_count: usize) -> String {
    if ref_count == 0 {
        prompt.to_string()
    } else {
        format!(
            "Using the {ref_count} attached reference image(s), generate a photograph with the following specifications:\n\n{prompt}"
        )
    }
}

// ───────────────────────── Gemini 3.1 Flash Image ─────────────────────────

/// quality → Gemini `imageSize` 매핑.
fn gemini_image_size(quality: &str) -> &'static str {
    match quality {
        "4k" => "4K",
        "2k" => "2K",
        _ => "1K",
    }
}

#[derive(Deserialize)]
struct GeminiResponse {
    candidates: Option<Vec<GeminiCandidate>>,
}
#[derive(Deserialize)]
struct GeminiCandidate {
    content: Option<GeminiContent>,
}
#[derive(Deserialize)]
struct GeminiContent {
    parts: Option<Vec<GeminiPart>>,
}
#[derive(Deserialize)]
struct GeminiPart {
    #[serde(rename = "inlineData")]
    inline_data: Option<GeminiInlineData>,
}
#[derive(Deserialize)]
struct GeminiInlineData {
    #[serde(rename = "mimeType")]
    mime_type: String,
    data: String,
}

/// Gemini 이미지 생성. 참조 이미지는 `inlineData` 로 본문에 포함.
pub async fn generate_gemini(
    api_key: &str,
    prompt: &str,
    aspect_ratio: &str,
    quality: &str,
    reference_images: &[String],
) -> Result<Vec<String>, String> {
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key={api_key}"
    );

    // parts: 참조 이미지(inlineData) 먼저, 그 다음 text.
    let mut parts: Vec<serde_json::Value> = Vec::new();
    for img in reference_images {
        if let Some((mime, b64)) = parse_data_url(img) {
            parts.push(serde_json::json!({
                "inlineData": { "mimeType": mime, "data": b64 }
            }));
        }
    }
    parts.push(serde_json::json!({
        "text": prompt_with_refs(prompt, reference_images.len())
    }));

    let mut image_config = serde_json::Map::new();
    if !aspect_ratio.is_empty() {
        image_config.insert("aspectRatio".into(), serde_json::json!(aspect_ratio));
    }
    image_config.insert(
        "imageSize".into(),
        serde_json::json!(gemini_image_size(quality)),
    );

    let body = serde_json::json!({
        "contents": [{ "parts": parts }],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": image_config,
        }
    });

    let client = http_client()?;
    let resp = client
        .post(&url)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Gemini 네트워크 오류: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        let raw = resp.text().await.unwrap_or_default();
        let snippet: String = raw.chars().take(400).collect();
        return Err(format!("Gemini HTTP {} — {}", status.as_u16(), snippet));
    }

    let parsed: GeminiResponse = resp
        .json()
        .await
        .map_err(|e| format!("Gemini 응답 파싱 실패: {e}"))?;

    let first = parsed
        .candidates
        .unwrap_or_default()
        .into_iter()
        .next()
        .ok_or_else(|| "Gemini에서 이미지를 생성하지 못했습니다.".to_string())?;
    let part_list = first.content.and_then(|c| c.parts).unwrap_or_default();
    let image = part_list
        .into_iter()
        .find_map(|p| p.inline_data)
        .ok_or_else(|| "Gemini 응답에 이미지가 포함되지 않았습니다.".to_string())?;

    Ok(vec![format!(
        "data:{};base64,{}",
        image.mime_type, image.data
    )])
}

// ───────────────────────── OpenAI gpt-image-1 ─────────────────────────

/// aspect ratio → OpenAI `size`(정사각/가로/세로 3종).
fn openai_size(aspect_ratio: &str) -> &'static str {
    let dims: Vec<f64> = aspect_ratio
        .split(':')
        .filter_map(|x| x.trim().parse().ok())
        .collect();
    if dims.len() == 2 && dims[0] > 0.0 && dims[1] > 0.0 {
        let ratio = dims[0] / dims[1];
        if (ratio - 1.0).abs() < 0.05 {
            "1024x1024"
        } else if ratio > 1.0 {
            "1536x1024"
        } else {
            "1024x1536"
        }
    } else {
        "1024x1024"
    }
}

/// quality → OpenAI `quality`(standard=medium / 2k·4k=high).
fn openai_quality(quality: &str) -> &'static str {
    match quality {
        "2k" | "4k" => "high",
        _ => "medium",
    }
}

#[derive(Deserialize)]
struct OpenAiImageResponse {
    data: Option<Vec<OpenAiImageItem>>,
}
#[derive(Deserialize)]
struct OpenAiImageItem {
    b64_json: Option<String>,
    url: Option<String>,
}

/// OpenAI 이미지 생성. 참조 有 → `/v1/images/edits`(multipart), 無 → `/v1/images/generations`(JSON).
pub async fn generate_openai(
    api_key: &str,
    prompt: &str,
    aspect_ratio: &str,
    quality: &str,
    reference_images: &[String],
) -> Result<Vec<String>, String> {
    let size = openai_size(aspect_ratio);
    let oai_quality = openai_quality(quality);
    let has_refs = !reference_images.is_empty();
    let client = http_client()?;

    let resp = if has_refs {
        // 참조 이미지 → /v1/images/edits (multipart/form-data)
        let mut form = reqwest::multipart::Form::new();
        for (i, img) in reference_images.iter().enumerate() {
            if let Some((mime, b64)) = parse_data_url(img) {
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(&b64)
                    .map_err(|e| format!("참조 이미지 디코딩 실패: {e}"))?;
                let ext = mime.split('/').nth(1).unwrap_or("png");
                let part = reqwest::multipart::Part::bytes(bytes)
                    .file_name(format!("reference_{}.{}", i + 1, ext))
                    .mime_str(&mime)
                    .map_err(|e| format!("참조 이미지 MIME 오류: {e}"))?;
                form = form.part("image[]", part);
            }
        }
        form = form
            .text("model", "gpt-image-1")
            .text("prompt", prompt_with_refs(prompt, reference_images.len()))
            .text("n", "1")
            .text("size", size)
            .text("quality", oai_quality);

        client
            .post("https://api.openai.com/v1/images/edits")
            .header("authorization", format!("Bearer {api_key}"))
            .multipart(form)
            .send()
            .await
            .map_err(|e| format!("OpenAI 네트워크 오류: {e}"))?
    } else {
        // 텍스트만 → /v1/images/generations (JSON)
        let body = serde_json::json!({
            "model": "gpt-image-1",
            "prompt": prompt,
            "n": 1,
            "size": size,
            "quality": oai_quality,
            "moderation": "low",
        });
        client
            .post("https://api.openai.com/v1/images/generations")
            .header("authorization", format!("Bearer {api_key}"))
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("OpenAI 네트워크 오류: {e}"))?
    };

    let status = resp.status();
    if !status.is_success() {
        let raw = resp.text().await.unwrap_or_default();
        let snippet: String = raw.chars().take(400).collect();
        return Err(format!("OpenAI HTTP {} — {}", status.as_u16(), snippet));
    }

    let parsed: OpenAiImageResponse = resp
        .json()
        .await
        .map_err(|e| format!("OpenAI 응답 파싱 실패: {e}"))?;
    let items = parsed.data.unwrap_or_default();
    if items.is_empty() {
        return Err("OpenAI에서 이미지를 생성하지 못했습니다.".to_string());
    }
    // gpt-image-1 은 항상 b64_json. url 폴백도 일단 수용.
    let urls: Vec<String> = items
        .into_iter()
        .filter_map(|item| {
            item.b64_json
                .map(|b64| format!("data:image/png;base64,{b64}"))
                .or(item.url)
        })
        .collect();
    if urls.is_empty() {
        return Err("OpenAI 응답에 이미지가 포함되지 않았습니다.".to_string());
    }
    Ok(urls)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_data_url_ok() {
        let (mime, b64) = parse_data_url("data:image/png;base64,AAAA").unwrap();
        assert_eq!(mime, "image/png");
        assert_eq!(b64, "AAAA");
    }

    #[test]
    fn parse_data_url_rejects_malformed() {
        assert!(parse_data_url("https://example.com/a.png").is_none());
        assert!(parse_data_url("data:image/png;base64,").is_none());
        assert!(parse_data_url("data:;base64,AAAA").is_none());
    }

    #[test]
    fn gemini_size_mapping() {
        assert_eq!(gemini_image_size("4k"), "4K");
        assert_eq!(gemini_image_size("2k"), "2K");
        assert_eq!(gemini_image_size("standard"), "1K");
        assert_eq!(gemini_image_size(""), "1K");
    }

    #[test]
    fn openai_size_mapping() {
        assert_eq!(openai_size("1:1"), "1024x1024");
        assert_eq!(openai_size("16:9"), "1536x1024");
        assert_eq!(openai_size("9:16"), "1024x1536");
        assert_eq!(openai_size("4:3"), "1536x1024");
        assert_eq!(openai_size("garbage"), "1024x1024");
    }

    #[test]
    fn openai_quality_mapping() {
        assert_eq!(openai_quality("standard"), "medium");
        assert_eq!(openai_quality("2k"), "high");
        assert_eq!(openai_quality("4k"), "high");
    }

    #[test]
    fn prompt_refs_prefix() {
        assert_eq!(prompt_with_refs("a cat", 0), "a cat");
        assert!(prompt_with_refs("a cat", 2).contains("2 attached reference"));
        assert!(prompt_with_refs("a cat", 2).ends_with("a cat"));
    }
}
