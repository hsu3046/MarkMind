//! 이미지 생성 — Gemini(Nano Banana 계열) / OpenAI(gpt-image-2).
//!
//! 모델 ID 는 호출부(Settings 의 전역 이미지 모델 선택)에서 인자로 전달받는다 —
//! Gemini 는 generateContent URL 에, OpenAI 는 요청 body 의 model 에 사용.
//! lumina-studio `imageGen.ts` 의 handleGemini/handleOpenAI 를 Rust(reqwest)로 포팅.
//! WKWebView 의 fetch CORS 제약을 피하려 네이티브 HTTP 로 호출(텍스트 LLM 과 동일 경로).
//! 참조 이미지는 프론트에서 `data:image/...;base64,...` 문자열로 전달.
//! 두 공급사 모두 결과를 base64 data URL 배열(개수 1)로 정규화해 반환 — 삽입/저장 공통.
//!
//! 옵션 매핑(두 공급사 구조가 다름 → 공통 입력을 각 API 형식으로 변환):
//!  - 공통 입력: aspect_ratio(비율) + resolution(1K/2K/4K). OpenAI 만 quality(low/medium/high).
//!  - Gemini: imageConfig 에 aspectRatio + imageSize(=resolution) 그대로.
//!  - OpenAI: size(=비율×해상도 환산 WxH) + quality 별개. (gpt-image-2 는 비율·해상도가 size 하나로 통합)
//!
//! 에러는 `<provider> HTTP <status> — <snippet>` 형태 String 으로 반환하고,
//! 사용자용 메시지 변환(humanize)은 프론트(imageGen.ts)에서 수행한다.

use base64::Engine;
use serde::Deserialize;
use std::time::Duration;

/// 이미지 생성은 4K/참조/high 품질이면 OpenAI 공식 기준 최대 2분+ 소요 → 넉넉히 5분.
const TIMEOUT_SECS: u64 = 300;

/// data URL(`data:{mime};base64,{data}`) → (mime, base64) 분리. 형식 불일치 시 None.
fn parse_data_url(s: &str) -> Option<(String, String)> {
    let rest = s.strip_prefix("data:")?;
    let (mime, b64) = rest.split_once(";base64,")?;
    if mime.is_empty() || b64.is_empty() {
        return None;
    }
    Some((mime.to_string(), b64.to_string()))
}

/// "16:9" → (16.0, 9.0). 형식 불일치 시 (1,1) 정사각 폴백.
fn parse_ratio(aspect_ratio: &str) -> (f64, f64) {
    let dims: Vec<f64> = aspect_ratio
        .split(':')
        .filter_map(|x| x.trim().parse().ok())
        .collect();
    if dims.len() == 2 && dims[0] > 0.0 && dims[1] > 0.0 {
        (dims[0], dims[1])
    } else {
        (1.0, 1.0)
    }
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

// ───────────────────────── Gemini (Nano Banana) ─────────────────────────

/// resolution(1K/2K/4K) → Gemini `imageSize`. 대문자 K 필수(소문자는 API 가 거부).
fn gemini_image_size(resolution: &str) -> &'static str {
    match resolution.to_uppercase().as_str() {
        "4K" => "4K",
        "2K" => "2K",
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

/// Gemini 이미지 생성. aspectRatio + imageSize(=resolution). 참조 이미지는 `inlineData` 로 포함.
pub async fn generate_gemini(
    api_key: &str,
    model: &str,
    prompt: &str,
    aspect_ratio: &str,
    resolution: &str,
    reference_images: &[String],
) -> Result<Vec<String>, String> {
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
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
        serde_json::json!(gemini_image_size(resolution)),
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

// ───────────────────────── OpenAI gpt-image-2 ─────────────────────────

/// resolution(1K/2K/4K) + aspect → OpenAI `size` "WxH".
/// gpt-image-2 제약: 양변 16 배수, 최대 변 3840, 총 픽셀 655,360~8,294,400, 비율 3:1 이내.
/// 비율을 유지하며 목표 해상도(픽셀)에 맞춰 계산 후 제약을 만족하도록 보정한다.
fn openai_size(aspect_ratio: &str, resolution: &str) -> String {
    const MIN_PX: i64 = 655_360;
    const MAX_PX: i64 = 8_294_400;
    const MAX_EDGE: i64 = 3840;
    let (rw, rh) = parse_ratio(aspect_ratio);
    let target = match resolution.to_uppercase().as_str() {
        "4K" => MAX_PX as f64,    // 4K — 제약상 최대 픽셀
        "2K" => 4_194_304.0,      // 2K ≈ 2048²
        _ => 1_048_576.0,         // 1K ≈ 1024²
    };
    // 비율 유지하며 목표 픽셀에 맞는 실수 변 길이
    let mut h = (target * rh / rw).sqrt();
    let mut w = h * rw / rh;
    // 최대 변 clamp(비율 유지)
    let max_edge = MAX_EDGE as f64;
    if w > max_edge {
        w = max_edge;
        h = w * rh / rw;
    }
    if h > max_edge {
        h = max_edge;
        w = h * rw / rh;
    }
    // 16 배수로 반올림(최소 16)
    let round16 = |v: f64| (((v / 16.0).round() as i64) * 16).max(16);
    let mut wi = round16(w);
    let mut hi = round16(h);
    // 최소 픽셀 보장(짧은 변부터 키움)
    while wi * hi < MIN_PX {
        if wi <= hi {
            wi += 16;
        } else {
            hi += 16;
        }
    }
    // 최대 픽셀/최대 변 보장(긴 변부터 줄임)
    while wi * hi > MAX_PX || wi > MAX_EDGE || hi > MAX_EDGE {
        if wi >= hi {
            wi -= 16;
        } else {
            hi -= 16;
        }
    }
    format!("{wi}x{hi}")
}

/// quality 입력 검증 — low/medium/high/auto 만 허용, 그 외 medium.
fn openai_quality(quality: &str) -> &'static str {
    match quality.to_lowercase().as_str() {
        "low" => "low",
        "high" => "high",
        "auto" => "auto",
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

/// OpenAI 이미지 생성(model = gpt-image-2 등). size(비율×해상도 환산) + quality 별개.
/// 참조 有 → `/v1/images/edits`(multipart), 無 → `/v1/images/generations`(JSON).
pub async fn generate_openai(
    api_key: &str,
    model: &str,
    prompt: &str,
    aspect_ratio: &str,
    resolution: &str,
    quality: &str,
    reference_images: &[String],
) -> Result<Vec<String>, String> {
    let size = openai_size(aspect_ratio, resolution);
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
            .text("model", model.to_string())
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
            "model": model,
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
    // gpt-image-2 는 항상 b64_json. url 폴백도 일단 수용.
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
    fn gemini_image_size_normalizes() {
        assert_eq!(gemini_image_size("4K"), "4K");
        assert_eq!(gemini_image_size("2k"), "2K"); // 소문자 입력도 대문자로
        assert_eq!(gemini_image_size("1K"), "1K");
        assert_eq!(gemini_image_size(""), "1K");
    }

    #[test]
    fn openai_quality_validates() {
        assert_eq!(openai_quality("low"), "low");
        assert_eq!(openai_quality("medium"), "medium");
        assert_eq!(openai_quality("HIGH"), "high");
        assert_eq!(openai_quality("garbage"), "medium");
    }

    /// openai_size: 제약(16배수·최대변3840·픽셀 655360~8294400)을 항상 만족해야.
    #[test]
    fn openai_size_satisfies_constraints() {
        for ar in ["1:1", "16:9", "9:16", "3:2", "2:3", "4:3", "21:9", "garbage"] {
            for res in ["1K", "2K", "4K"] {
                let s = openai_size(ar, res);
                let (w, h): (i64, i64) = {
                    let mut it = s.split('x').map(|x| x.parse::<i64>().unwrap());
                    (it.next().unwrap(), it.next().unwrap())
                };
                assert_eq!(w % 16, 0, "{ar}/{res}={s}: width not /16");
                assert_eq!(h % 16, 0, "{ar}/{res}={s}: height not /16");
                assert!(w <= 3840 && h <= 3840, "{ar}/{res}={s}: edge > 3840");
                let px = w * h;
                assert!((655_360..=8_294_400).contains(&px), "{ar}/{res}={s}: px {px} out of range");
            }
        }
    }

    /// 대표 케이스의 기대 해상도(비율·목표 픽셀 반영).
    #[test]
    fn openai_size_expected() {
        assert_eq!(openai_size("1:1", "1K"), "1024x1024");
        assert_eq!(openai_size("16:9", "4K"), "3840x2160");
    }

    #[test]
    fn prompt_refs_prefix() {
        assert_eq!(prompt_with_refs("a cat", 0), "a cat");
        assert!(prompt_with_refs("a cat", 2).contains("2 attached reference"));
        assert!(prompt_with_refs("a cat", 2).ends_with("a cat"));
    }
}
