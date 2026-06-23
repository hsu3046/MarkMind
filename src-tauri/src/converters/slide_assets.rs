use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{cmp::Ordering, time::Duration};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StockSlideAssetIntent {
    title: String,
    role: String,
    query: Option<String>,
    entity: Option<String>,
    aspect: Option<String>,
    source_preference: Option<String>,
    license_strictness: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedStockSlideAsset {
    data_url: String,
    provider: String,
    source_url: Option<String>,
    attribution: Option<String>,
    license: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
}

#[derive(Debug, Clone)]
struct CandidateAsset {
    provider: &'static str,
    url: String,
    source_url: Option<String>,
    attribution: Option<String>,
    license: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    mime: Option<String>,
    score: f64,
}

#[tauri::command]
pub async fn resolve_stock_slide_asset(
    intent: StockSlideAssetIntent,
) -> Result<Option<ResolvedStockSlideAsset>, String> {
    let source_preference = intent
        .source_preference
        .as_deref()
        .unwrap_or("auto")
        .to_ascii_lowercase();
    if source_preference == "none" || source_preference == "generated" {
        return Ok(None);
    }
    let query = stock_query(&intent);
    if query.trim().is_empty() {
        return Ok(None);
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .user_agent("MarkMind/0.9 slide asset resolver")
        .build()
        .map_err(|e| format!("이미지 검색 클라이언트 생성 실패: {e}"))?;

    let (openverse, wikimedia) = tokio::join!(
        search_openverse(&client, &intent, &query),
        search_wikimedia(&client, &intent, &query)
    );

    let mut candidates = Vec::new();
    if let Ok(items) = openverse {
        candidates.extend(items);
    }
    if let Ok(items) = wikimedia {
        candidates.extend(items);
    }
    candidates.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(Ordering::Equal));

    for candidate in candidates.into_iter().take(8) {
        match fetch_candidate(&client, candidate.clone()).await {
            Ok(asset) => return Ok(Some(asset)),
            Err(err) => {
                log::debug!(
                    "[slide_assets] candidate fetch skipped provider={} url={} err={}",
                    candidate.provider,
                    candidate.url,
                    err
                );
            }
        }
    }

    Ok(None)
}

fn stock_query(intent: &StockSlideAssetIntent) -> String {
    let mut parts = Vec::new();
    if let Some(entity) = intent
        .entity
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        parts.push(entity.to_string());
    }
    if let Some(query) = intent
        .query
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        parts.push(query.to_string());
    }
    if parts.is_empty() {
        parts.push(intent.title.trim().to_string());
    }
    if intent.role == "logo" && !parts.iter().any(|p| p.to_lowercase().contains("logo")) {
        parts.push("logo".to_string());
    }
    parts.join(" ")
}

async fn search_openverse(
    client: &reqwest::Client,
    intent: &StockSlideAssetIntent,
    query: &str,
) -> Result<Vec<CandidateAsset>, String> {
    if intent.source_preference.as_deref() == Some("logo") {
        return Ok(Vec::new());
    }
    let url = format!(
        "https://api.openverse.engineering/v1/images/?q={}&page_size=8&mature=false",
        urlencoding::encode(query)
    );
    let v: Value = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Openverse 검색 실패: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Openverse 검색 응답 오류: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Openverse 응답 파싱 실패: {e}"))?;
    let mut out = Vec::new();
    for item in v
        .get("results")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let Some(url) = item.get("url").and_then(Value::as_str).map(str::to_string) else {
            continue;
        };
        let width = u32_field(item, "width");
        let height = u32_field(item, "height");
        let license = item
            .get("license")
            .and_then(Value::as_str)
            .map(str::to_string);
        let creator = item
            .get("creator")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|v| !v.is_empty());
        let title = item
            .get("title")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|v| !v.is_empty());
        let attribution = match (title, creator) {
            (Some(t), Some(c)) => Some(format!("{t} — {c} / Openverse")),
            (Some(t), None) => Some(format!("{t} / Openverse")),
            (None, Some(c)) => Some(format!("{c} / Openverse")),
            (None, None) => Some("Openverse".to_string()),
        };
        let mut candidate = CandidateAsset {
            provider: "openverse",
            url,
            source_url: item
                .get("foreign_landing_url")
                .and_then(Value::as_str)
                .map(str::to_string),
            attribution,
            license,
            width,
            height,
            mime: None,
            score: 0.0,
        };
        candidate.score = score_candidate(&candidate, intent);
        out.push(candidate);
    }
    Ok(out)
}

async fn search_wikimedia(
    client: &reqwest::Client,
    intent: &StockSlideAssetIntent,
    query: &str,
) -> Result<Vec<CandidateAsset>, String> {
    let url = format!(
        "https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrlimit=8&gsrsearch={}&prop=imageinfo&iiprop=url|extmetadata|mime|size&format=json",
        urlencoding::encode(query)
    );
    let v: Value = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Wikimedia 검색 실패: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Wikimedia 검색 응답 오류: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Wikimedia 응답 파싱 실패: {e}"))?;
    let mut out = Vec::new();
    let Some(pages) = v
        .get("query")
        .and_then(|q| q.get("pages"))
        .and_then(Value::as_object)
    else {
        return Ok(out);
    };
    for page in pages.values() {
        let Some(info) = page
            .get("imageinfo")
            .and_then(Value::as_array)
            .and_then(|arr| arr.first())
        else {
            continue;
        };
        let Some(url) = info.get("url").and_then(Value::as_str).map(str::to_string) else {
            continue;
        };
        let mime = info.get("mime").and_then(Value::as_str).map(str::to_string);
        let width = u32_field(info, "width");
        let height = u32_field(info, "height");
        let meta = info.get("extmetadata").and_then(Value::as_object);
        let title = meta_value(meta, "ObjectName")
            .or_else(|| page.get("title").and_then(Value::as_str).map(clean_html));
        let author = meta_value(meta, "Artist").or_else(|| meta_value(meta, "Credit"));
        let license = meta_value(meta, "LicenseShortName").or_else(|| meta_value(meta, "License"));
        let attribution = match (title.as_deref(), author.as_deref()) {
            (Some(t), Some(a)) if !a.is_empty() => Some(format!("{t} — {a} / Wikimedia Commons")),
            (Some(t), _) => Some(format!("{t} / Wikimedia Commons")),
            _ => Some("Wikimedia Commons".to_string()),
        };
        let mut candidate = CandidateAsset {
            provider: "wikimedia",
            url,
            source_url: info
                .get("descriptionurl")
                .and_then(Value::as_str)
                .map(str::to_string),
            attribution,
            license,
            width,
            height,
            mime,
            score: 0.0,
        };
        candidate.score = score_candidate(&candidate, intent);
        out.push(candidate);
    }
    Ok(out)
}

async fn fetch_candidate(
    client: &reqwest::Client,
    candidate: CandidateAsset,
) -> Result<ResolvedStockSlideAsset, String> {
    let resp = client
        .get(&candidate.url)
        .send()
        .await
        .map_err(|e| format!("이미지 다운로드 실패: {e}"))?
        .error_for_status()
        .map_err(|e| format!("이미지 다운로드 응답 오류: {e}"))?;
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .and_then(normalize_mime)
        .or_else(|| candidate.mime.as_deref().and_then(normalize_mime))
        .ok_or_else(|| "지원하지 않는 이미지 형식".to_string())?;
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("이미지 바이트 읽기 실패: {e}"))?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("이미지가 너무 큼".to_string());
    }
    let b64 = STANDARD.encode(bytes);
    Ok(ResolvedStockSlideAsset {
        data_url: format!("data:{content_type};base64,{b64}"),
        provider: candidate.provider.to_string(),
        source_url: candidate.source_url,
        attribution: candidate.attribution,
        license: candidate.license,
        width: candidate.width,
        height: candidate.height,
    })
}

fn score_candidate(candidate: &CandidateAsset, intent: &StockSlideAssetIntent) -> f64 {
    let mut score = 0.0;
    if let (Some(w), Some(h)) = (candidate.width, candidate.height) {
        let megapixels = (w as f64 * h as f64) / 1_000_000.0;
        score += megapixels.min(6.0) * 0.5;
        if let Some(target) = intent.aspect.as_deref().and_then(aspect_ratio) {
            let actual = w as f64 / h.max(1) as f64;
            score += (2.0 - (target - actual).abs()).max(0.0);
        }
    }
    if candidate.provider == "wikimedia"
        && (intent.role == "logo" || intent.license_strictness.as_deref() == Some("open"))
    {
        score += 1.5;
    }
    if candidate.provider == "openverse" && intent.role != "logo" {
        score += 0.8;
    }
    if let Some(license) = candidate.license.as_deref().map(str::to_lowercase) {
        if license.contains("public") || license.contains("cc0") {
            score += 0.8;
        } else if license.contains("cc") || license.contains("creative") {
            score += 0.4;
        }
    }
    if candidate.mime.as_deref().is_some_and(|m| m.contains("svg")) && intent.role == "logo" {
        score += 0.6;
    }
    score
}

fn u32_field(value: &Value, key: &str) -> Option<u32> {
    value
        .get(key)
        .and_then(Value::as_u64)
        .and_then(|v| u32::try_from(v).ok())
}

fn meta_value(meta: Option<&serde_json::Map<String, Value>>, key: &str) -> Option<String> {
    meta.and_then(|m| m.get(key))
        .and_then(|v| v.get("value"))
        .and_then(Value::as_str)
        .map(clean_html)
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn clean_html(value: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for ch in value.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out.replace("&quot;", "\"")
        .replace("&amp;", "&")
        .replace("&#039;", "'")
}

fn normalize_mime(value: &str) -> Option<String> {
    let mime = value.split(';').next()?.trim().to_ascii_lowercase();
    match mime.as_str() {
        "image/jpeg" | "image/jpg" => Some("image/jpeg".to_string()),
        "image/png" => Some("image/png".to_string()),
        "image/svg+xml" => Some("image/svg+xml".to_string()),
        _ => None,
    }
}

fn aspect_ratio(value: &str) -> Option<f64> {
    let (w, h) = value.split_once(':')?;
    let w = w.trim().parse::<f64>().ok()?;
    let h = h.trim().parse::<f64>().ok()?;
    if w > 0.0 && h > 0.0 {
        Some(w / h)
    } else {
        None
    }
}
