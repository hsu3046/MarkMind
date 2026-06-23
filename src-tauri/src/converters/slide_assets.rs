use super::keychain::{get_key, Provider};
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
    if !allows_stock_lookup(&intent) {
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

    let unsplash_key =
        get_key(Provider::Unsplash).map_err(|e| format!("Unsplash 키 조회 실패: {e}"))?;
    let pexels_key = get_key(Provider::Pexels).map_err(|e| format!("Pexels 키 조회 실패: {e}"))?;
    let brandfetch_key =
        get_key(Provider::Brandfetch).map_err(|e| format!("Brandfetch 키 조회 실패: {e}"))?;

    let (openverse, wikimedia, unsplash, pexels, brandfetch) = tokio::join!(
        search_openverse(&client, &intent, &query),
        search_wikimedia(&client, &intent, &query),
        search_unsplash(&client, &intent, &query, unsplash_key.as_deref()),
        search_pexels(&client, &intent, &query, pexels_key.as_deref()),
        search_brandfetch(&client, &intent, &query, brandfetch_key.as_deref())
    );

    let mut candidates = Vec::new();
    extend_provider_candidates(&mut candidates, "openverse", openverse);
    extend_provider_candidates(&mut candidates, "wikimedia", wikimedia);
    extend_provider_candidates(&mut candidates, "unsplash", unsplash);
    extend_provider_candidates(&mut candidates, "pexels", pexels);
    extend_provider_candidates(&mut candidates, "brandfetch", brandfetch);
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

fn extend_provider_candidates(
    candidates: &mut Vec<CandidateAsset>,
    provider: &str,
    result: Result<Vec<CandidateAsset>, String>,
) {
    match result {
        Ok(items) => candidates.extend(items),
        Err(err) => log::debug!("[slide_assets] {provider} search skipped: {err}"),
    }
}

fn allows_stock_lookup(intent: &StockSlideAssetIntent) -> bool {
    !intent
        .source_preference
        .as_deref()
        .unwrap_or("auto")
        .eq_ignore_ascii_case("none")
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

async fn search_unsplash(
    client: &reqwest::Client,
    intent: &StockSlideAssetIntent,
    query: &str,
    key: Option<&str>,
) -> Result<Vec<CandidateAsset>, String> {
    let Some(key) = key.map(str::trim).filter(|v| !v.is_empty()) else {
        return Ok(Vec::new());
    };
    if intent.role == "logo" || intent.source_preference.as_deref() == Some("logo") {
        return Ok(Vec::new());
    }
    let url = format!(
        "https://api.unsplash.com/search/photos?query={}&per_page=10&order_by=relevant&content_filter=high",
        urlencoding::encode(query)
    );
    let v: Value = client
        .get(url)
        .header("Authorization", format!("Client-ID {}", key))
        .header("Accept-Version", "v1")
        .send()
        .await
        .map_err(|e| format!("Unsplash 검색 실패: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Unsplash 검색 응답 오류: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Unsplash 응답 파싱 실패: {e}"))?;
    let mut out = Vec::new();
    for item in v
        .get("results")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let Some(raw_url) = item
            .get("urls")
            .and_then(|u| u.get("raw"))
            .and_then(Value::as_str)
        else {
            continue;
        };
        let width = u32_field(item, "width");
        let height = u32_field(item, "height");
        let user = item.get("user").and_then(Value::as_object);
        let photographer = user
            .and_then(|u| u.get("name"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|v| !v.is_empty());
        let source_url = item
            .get("links")
            .and_then(|l| l.get("html"))
            .and_then(Value::as_str)
            .map(|u| append_query(u, &[("utm_source", "markmind"), ("utm_medium", "referral")]));
        let attribution = photographer
            .map(|name| format!("Photo by {name} on Unsplash"))
            .or_else(|| Some("Unsplash".to_string()));
        let mut candidate = CandidateAsset {
            provider: "unsplash",
            url: unsplash_image_url(raw_url, intent),
            source_url,
            attribution,
            license: Some("Unsplash License".to_string()),
            width,
            height,
            mime: Some("image/jpeg".to_string()),
            score: 0.0,
        };
        candidate.score = score_candidate(&candidate, intent) + 1.2;
        out.push(candidate);
    }
    Ok(out)
}

async fn search_pexels(
    client: &reqwest::Client,
    intent: &StockSlideAssetIntent,
    query: &str,
    key: Option<&str>,
) -> Result<Vec<CandidateAsset>, String> {
    let Some(key) = key.map(str::trim).filter(|v| !v.is_empty()) else {
        return Ok(Vec::new());
    };
    if intent.role == "logo" || intent.source_preference.as_deref() == Some("logo") {
        return Ok(Vec::new());
    }
    let url = format!(
        "https://api.pexels.com/v1/search?query={}&per_page=12&locale=ko-KR",
        urlencoding::encode(query)
    );
    let v: Value = client
        .get(url)
        .header("Authorization", key)
        .send()
        .await
        .map_err(|e| format!("Pexels 검색 실패: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Pexels 검색 응답 오류: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Pexels 응답 파싱 실패: {e}"))?;
    let mut out = Vec::new();
    for item in v
        .get("photos")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let src = item.get("src").and_then(Value::as_object);
        let url = src
            .and_then(|s| {
                if stock_orientation(intent) == Some("portrait") {
                    s.get("portrait").or_else(|| s.get("large2x"))
                } else if stock_orientation(intent) == Some("square") {
                    s.get("large2x").or_else(|| s.get("large"))
                } else {
                    s.get("landscape").or_else(|| s.get("large2x"))
                }
            })
            .and_then(Value::as_str)
            .map(str::to_string);
        let Some(url) = url else {
            continue;
        };
        let width = u32_field(item, "width");
        let height = u32_field(item, "height");
        let photographer = item
            .get("photographer")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|v| !v.is_empty());
        let source_url = item.get("url").and_then(Value::as_str).map(str::to_string);
        let attribution = photographer
            .map(|name| format!("Photo by {name} on Pexels"))
            .or_else(|| Some("Pexels".to_string()));
        let mut candidate = CandidateAsset {
            provider: "pexels",
            url,
            source_url,
            attribution,
            license: Some("Pexels License".to_string()),
            width,
            height,
            mime: Some("image/jpeg".to_string()),
            score: 0.0,
        };
        candidate.score = score_candidate(&candidate, intent) + 1.0;
        out.push(candidate);
    }
    Ok(out)
}

async fn search_brandfetch(
    client: &reqwest::Client,
    intent: &StockSlideAssetIntent,
    query: &str,
    key: Option<&str>,
) -> Result<Vec<CandidateAsset>, String> {
    let Some(key) = key.map(str::trim).filter(|v| !v.is_empty()) else {
        return Ok(Vec::new());
    };
    if !brandfetch_should_search(intent, query) {
        return Ok(Vec::new());
    }
    let brand_query = brandfetch_query(intent, query);
    if brand_query.is_empty() {
        return Ok(Vec::new());
    }

    let mut out = Vec::new();
    if let Ok(mut exact) = brandfetch_brand_candidates(client, &brand_query, key).await {
        out.append(&mut exact);
    }
    if let Ok(mut searched) = brandfetch_search_candidates(client, &brand_query, key).await {
        out.append(&mut searched);
    }
    for candidate in &mut out {
        candidate.score += score_candidate(candidate, intent) + 2.4;
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
            // Aspect is only a light preference. The slide renderers crop to the actual slot.
            score += (1.0 - (target - actual).abs()).max(0.0) * 0.35;
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

fn stock_orientation(intent: &StockSlideAssetIntent) -> Option<&'static str> {
    let ratio = intent.aspect.as_deref().and_then(aspect_ratio)?;
    if ratio > 1.25 {
        Some("landscape")
    } else if ratio < 0.85 {
        Some("portrait")
    } else {
        Some("square")
    }
}

fn append_query(url: &str, params: &[(&str, &str)]) -> String {
    let mut out = url.to_string();
    let mut sep = if out.contains('?') { '&' } else { '?' };
    for (key, value) in params {
        out.push(sep);
        out.push_str(key);
        out.push('=');
        out.push_str(urlencoding::encode(value).as_ref());
        sep = '&';
    }
    out
}

fn unsplash_image_url(raw_url: &str, intent: &StockSlideAssetIntent) -> String {
    let params = if let Some(ratio) = intent.aspect.as_deref().and_then(aspect_ratio) {
        let (w, h) = if ratio > 1.55 {
            ("1920", "1080")
        } else if ratio > 1.15 {
            ("1600", "1200")
        } else if ratio < 0.85 {
            ("1080", "1440")
        } else {
            ("1600", "1600")
        };
        vec![
            ("w", w),
            ("h", h),
            ("fit", "crop"),
            ("crop", "entropy"),
            ("auto", "format"),
            ("q", "85"),
        ]
    } else {
        vec![
            ("w", "1600"),
            ("fit", "max"),
            ("auto", "format"),
            ("q", "85"),
        ]
    };
    append_query(raw_url, &params)
}

fn brandfetch_should_search(intent: &StockSlideAssetIntent, query: &str) -> bool {
    if intent.role == "logo" || intent.source_preference.as_deref() == Some("logo") {
        return true;
    }
    let text = [
        intent.entity.as_deref().unwrap_or_default(),
        query,
        intent.title.as_str(),
    ]
    .join(" ")
    .to_lowercase();
    text.contains("logo") || text.contains("brand") || text.contains("company")
}

fn brandfetch_query(intent: &StockSlideAssetIntent, query: &str) -> String {
    let raw = intent
        .entity
        .as_deref()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or(query)
        .trim();
    let cleaned = raw
        .replace("presentation background", "")
        .replace("presentation supporting visual", "")
        .replace("editorial concept image", "")
        .replace("logo", "")
        .replace("Logo", "")
        .replace("brand", "")
        .replace("Brand", "")
        .trim()
        .trim_matches(|c: char| c == '-' || c == ':' || c == '/' || c.is_whitespace())
        .to_string();
    cleaned
        .chars()
        .take(90)
        .collect::<String>()
        .trim()
        .to_string()
}

async fn brandfetch_search_candidates(
    client: &reqwest::Client,
    query: &str,
    client_id: &str,
) -> Result<Vec<CandidateAsset>, String> {
    let url = format!(
        "https://api.brandfetch.io/v2/search/{}?c={}",
        urlencoding::encode(query),
        urlencoding::encode(client_id)
    );
    let v: Value = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Brandfetch 검색 실패: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Brandfetch 검색 응답 오류: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Brandfetch 검색 응답 파싱 실패: {e}"))?;
    let mut out = Vec::new();
    for item in v.as_array().into_iter().flatten().take(5) {
        let Some(url) = item.get("icon").and_then(Value::as_str).map(str::to_string) else {
            continue;
        };
        let name = item
            .get("name")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .unwrap_or("Brand");
        let domain = item
            .get("domain")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|v| !v.is_empty());
        out.push(CandidateAsset {
            provider: "brandfetch",
            url,
            source_url: domain.map(|d| format!("https://brandfetch.com/{d}")),
            attribution: Some(format!("{name} / Brandfetch")),
            license: Some("Brandfetch".to_string()),
            width: None,
            height: None,
            mime: None,
            score: 0.0,
        });
    }
    Ok(out)
}

async fn brandfetch_brand_candidates(
    client: &reqwest::Client,
    identifier: &str,
    bearer_token: &str,
) -> Result<Vec<CandidateAsset>, String> {
    let url = format!(
        "https://api.brandfetch.io/v2/brands/{}?allowNsfw=false",
        urlencoding::encode(identifier)
    );
    let v: Value = client
        .get(url)
        .bearer_auth(bearer_token)
        .send()
        .await
        .map_err(|e| format!("Brandfetch 브랜드 조회 실패: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Brandfetch 브랜드 조회 응답 오류: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Brandfetch 브랜드 응답 파싱 실패: {e}"))?;
    Ok(brandfetch_assets_from_brand(&v))
}

fn brandfetch_assets_from_brand(v: &Value) -> Vec<CandidateAsset> {
    let name = v
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("Brand");
    let domain = v
        .get("domain")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let source_url = domain.map(|d| format!("https://brandfetch.com/{d}"));
    let mut out = Vec::new();
    for section in ["logos", "images"] {
        for asset in v
            .get(section)
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            for format in asset
                .get("formats")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let Some(url) = format
                    .get("src")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                else {
                    continue;
                };
                out.push(CandidateAsset {
                    provider: "brandfetch",
                    url,
                    source_url: source_url.clone(),
                    attribution: Some(format!("{name} / Brandfetch")),
                    license: Some("Brandfetch".to_string()),
                    width: u32_field(format, "width"),
                    height: u32_field(format, "height"),
                    mime: None,
                    score: if section == "logos" { 1.2 } else { 0.4 },
                });
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn intent(source_preference: Option<&str>) -> StockSlideAssetIntent {
        StockSlideAssetIntent {
            title: "AI adoption conditions".to_string(),
            role: "support".to_string(),
            query: Some("workplace collaboration training".to_string()),
            entity: None,
            aspect: Some("16:9".to_string()),
            source_preference: source_preference.map(str::to_string),
            license_strictness: Some("presentation".to_string()),
        }
    }

    #[test]
    fn generated_preference_still_allows_forced_stock_lookup() {
        let item = intent(Some("generated"));

        assert!(allows_stock_lookup(&item));
        assert_eq!(stock_query(&item), "workplace collaboration training");
    }

    #[test]
    fn none_preference_blocks_stock_lookup() {
        assert!(!allows_stock_lookup(&intent(Some("none"))));
    }

    #[test]
    fn unsplash_url_crops_to_requested_aspect() {
        let mut item = intent(None);
        item.aspect = Some("4:3".to_string());

        let url = unsplash_image_url("https://images.unsplash.com/photo-1", &item);

        assert!(url.contains("w=1600"));
        assert!(url.contains("h=1200"));
        assert!(url.contains("fit=crop"));
        assert!(url.contains("crop=entropy"));
    }

    #[test]
    fn unsplash_url_crops_portrait_assets() {
        let mut item = intent(None);
        item.aspect = Some("3:4".to_string());

        let url = unsplash_image_url("https://images.unsplash.com/photo-1", &item);

        assert!(url.contains("w=1080"));
        assert!(url.contains("h=1440"));
        assert!(url.contains("fit=crop"));
    }
}
