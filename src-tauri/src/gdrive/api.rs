//! Google Drive v3 REST API wrapper.
//!
//! Stage 2 에서 구현 예정. 현재는 스텁.
//!
//! 계획:
//! - list_files(query, page_size) → 마크다운 파일 목록
//! - download_file(file_id) → 본문 텍스트
//! - upload_file(name, content, parent_id) → 새 파일 생성
//! - update_file(file_id, content) → 기존 파일 덮어쓰기
//! - search_files(name_query) → 이름으로 검색
//!
//! 모든 호출은 `auth::get_or_refresh_access_token()` 으로 Bearer 토큰 획득 후
//! `DRIVE_API_BASE` / `DRIVE_UPLOAD_BASE` 로 요청.

use super::auth;
use super::error::{GDriveError, GDriveResult};
use super::{DRIVE_API_BASE, DRIVE_UPLOAD_BASE};
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DriveFile {
    pub id: String,
    pub name: String,
    #[serde(rename = "mimeType")]
    pub mime_type: String,
    #[serde(rename = "modifiedTime", default)]
    pub modified_time: Option<String>,
    #[serde(default)]
    pub size: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ListResponse {
    files: Vec<DriveFile>,
    #[serde(rename = "nextPageToken", default)]
    next_page_token: Option<String>,
}

/// 마크다운 파일 목록 — drive.file scope 라 앱이 만든/연 파일만 보임.
/// query 예: `mimeType='text/markdown' and trashed=false`
///
/// `max_results`: 가져올 최대 파일 수 (None = 무제한, 끝까지 follow `nextPageToken`).
/// API 호출 1회당 page_size=100 (Drive max). 1000개 가져오려면 10번 호출.
pub async fn list_files(query: Option<&str>, max_results: Option<u32>) -> GDriveResult<Vec<DriveFile>> {
    const PAGE_SIZE: u32 = 100; // Drive API max
    const SAFETY_LIMIT: u32 = 10_000; // 무한 loop 방어

    let token = auth::get_or_refresh_access_token().await?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()?;

    let mut all = Vec::new();
    let mut page_token: Option<String> = None;
    let cap = max_results.unwrap_or(SAFETY_LIMIT);

    loop {
        let mut url = format!(
            "{}/files?pageSize={}&fields=files(id,name,mimeType,modifiedTime,size),nextPageToken&orderBy=modifiedTime desc",
            DRIVE_API_BASE, PAGE_SIZE
        );
        if let Some(q) = query {
            url.push_str("&q=");
            url.push_str(&urlencoding::encode(q));
        }
        if let Some(ref tok) = page_token {
            url.push_str("&pageToken=");
            url.push_str(&urlencoding::encode(tok));
        }

        let res = client.get(&url).bearer_auth(&token).send().await?;
        if !res.status().is_success() {
            let status = res.status();
            let body = res.text().await.unwrap_or_default();
            return Err(GDriveError::Api(format!("list_files ({}): {}", status, body)));
        }
        let parsed: ListResponse = res.json().await?;
        all.extend(parsed.files);

        if all.len() as u32 >= cap {
            all.truncate(cap as usize);
            break;
        }
        match parsed.next_page_token {
            Some(t) if !t.is_empty() => page_token = Some(t),
            _ => break,
        }
        if all.len() as u32 >= SAFETY_LIMIT {
            break;
        }
    }

    Ok(all)
}

/// 파일 본문 다운로드 (텍스트).
/// - 일반 binary 파일 (`.md` 업로드 등) → `?alt=media`
/// - Google Docs → `/export?mimeType=text/markdown` (2024-07 부터 Google 지원)
/// - 기타 Google Editors (Sheets/Slides/Forms 등) → markdown 변환 불가 에러
pub async fn download_file(file_id: &str, mime_type: &str) -> GDriveResult<String> {
    let token = auth::get_or_refresh_access_token().await?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()?;

    let url = if mime_type == "application/vnd.google-apps.document" {
        format!(
            "{}/files/{}/export?mimeType=text/markdown",
            DRIVE_API_BASE, file_id
        )
    } else if mime_type.starts_with("application/vnd.google-apps.") {
        return Err(GDriveError::Api(format!(
            "이 파일 형식은 마크다운으로 변환할 수 없습니다: {}",
            mime_type
        )));
    } else {
        format!("{}/files/{}?alt=media", DRIVE_API_BASE, file_id)
    };

    let res = client.get(&url).bearer_auth(&token).send().await?;
    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(GDriveError::Api(format!(
            "download_file ({}): {}",
            status, body
        )));
    }
    let text = res.text().await?;
    Ok(text)
}

/// 새 파일 생성 (multipart upload). 반환: 생성된 파일 메타.
pub async fn upload_file(
    name: &str,
    content: &str,
    parent_id: Option<&str>,
) -> GDriveResult<DriveFile> {
    let token = auth::get_or_refresh_access_token().await?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()?;

    let mut metadata = serde_json::json!({
        "name": name,
        "mimeType": "text/markdown",
    });
    if let Some(pid) = parent_id {
        metadata["parents"] = serde_json::json!([pid]);
    }

    // multipart/related — Google Drive 표준 업로드 패턴
    let boundary = format!("markmind_{}", uuid::Uuid::new_v4());
    let body = format!(
        "--{boundary}\r\n\
         Content-Type: application/json; charset=UTF-8\r\n\r\n\
         {metadata}\r\n\
         --{boundary}\r\n\
         Content-Type: text/markdown; charset=UTF-8\r\n\r\n\
         {content}\r\n\
         --{boundary}--",
        boundary = boundary,
        metadata = metadata.to_string(),
        content = content,
    );

    let url = format!(
        "{}/files?uploadType=multipart&fields=id,name,mimeType,modifiedTime,size",
        DRIVE_UPLOAD_BASE
    );
    let res = client
        .post(&url)
        .bearer_auth(&token)
        .header(
            "Content-Type",
            format!("multipart/related; boundary={}", boundary),
        )
        .body(body)
        .send()
        .await?;
    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(GDriveError::Api(format!(
            "upload_file ({}): {}",
            status, body
        )));
    }
    let file: DriveFile = res.json().await?;
    Ok(file)
}

/// 기존 파일 덮어쓰기 (PATCH content).
pub async fn update_file(file_id: &str, content: &str) -> GDriveResult<DriveFile> {
    let token = auth::get_or_refresh_access_token().await?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()?;
    let url = format!(
        "{}/files/{}?uploadType=media&fields=id,name,mimeType,modifiedTime,size",
        DRIVE_UPLOAD_BASE, file_id
    );

    let res = client
        .patch(&url)
        .bearer_auth(&token)
        .header("Content-Type", "text/markdown; charset=UTF-8")
        .body(content.to_string())
        .send()
        .await?;
    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(GDriveError::Api(format!(
            "update_file ({}): {}",
            status, body
        )));
    }
    let file: DriveFile = res.json().await?;
    Ok(file)
}
