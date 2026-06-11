//! 클라우드 화자분리 — pyannote.ai web API (precision-2).
//!
//! 흐름 (공식 pyannoteai SDK 와 동일한 REST 시퀀스):
//!   1) POST /media/input {"url":"media://..."} → presigned PUT URL
//!   2) PUT <presigned> (오디오 바이트 업로드, 24h 임시 저장)
//!   3) POST /diarize {"url", "model":"precision-2", "numSpeakers"?} → {"jobId"}
//!   4) GET /jobs/{jobId} 폴링 → output.diarization [{speaker,start,end}]
//!
//! 출력은 기존 `DiarSegment{start_sec,end_sec,speaker_id}` 로 변환 →
//! 다운스트림 `apply_diar_labels`(시각 매칭) 가 그대로 동작한다.
//! 자작 로컬 diarization(diarize.rs/pyannote-rs)을 대체.

use super::diar::{labels_to_segments, DiarSegment};
use super::error::{ConverterError, ConverterResult};
use serde::Deserialize;
use std::path::Path;
use std::time::Duration;

const API_BASE: &str = "https://api.pyannote.ai/v1";
const POLL_INTERVAL_SECS: u64 = 5;
const POLL_MAX_ATTEMPTS: u32 = 360; // 5s * 360 = 30분 상한
/// 업로드 PUT 전용 타임아웃. 수 시간 녹음(수백 MB)은 일반 회선에서 업로드만 수 분이
/// 걸릴 수 있어, 제어용 소요청(presign/submit/poll)의 client 전역 180s 와 분리한다.
const UPLOAD_TIMEOUT_SECS: u64 = 1800; // 30분

#[derive(Deserialize)]
struct PresignedResp {
    url: String,
}

#[derive(Deserialize)]
struct JobIdResp {
    #[serde(rename = "jobId")]
    job_id: String,
}

#[derive(Deserialize)]
struct JobResp {
    status: String,
    #[serde(default)]
    output: Option<JobOutput>,
}

#[derive(Deserialize, Default)]
struct JobOutput {
    #[serde(default)]
    diarization: Vec<RawTurn>,
    #[serde(default)]
    error: Option<String>,
}

#[derive(Deserialize)]
struct RawTurn {
    speaker: String,
    start: f64,
    end: f64,
}

/// 오디오 파일을 pyannote.ai 로 보내 화자 구간을 받아 `DiarSegment` 로 반환.
/// `num_speakers = None` 이면 자동 감지.
pub async fn diarize_cloud(
    api_key: &str,
    file_path: &Path,
    num_speakers: Option<usize>,
) -> ConverterResult<Vec<DiarSegment>> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()?;

    // 1) presigned URL 발급
    let media_url = format!("media://markmind/{}", uuid::Uuid::new_v4().simple());
    let presigned = create_presigned(&client, api_key, &media_url).await?;

    // 2) 파일 업로드 (presigned PUT — 인증 헤더 불필요). per-request 타임아웃이
    //    client 전역(180s)을 override — 대용량 파일의 느린 업로드 허용.
    let bytes = tokio::fs::read(file_path).await?;
    let put = client
        .put(&presigned)
        .timeout(Duration::from_secs(UPLOAD_TIMEOUT_SECS))
        .body(bytes)
        .send()
        .await?;
    if !put.status().is_success() {
        return Err(ConverterError::Internal(format!(
            "pyannote.ai 업로드 실패 (HTTP {})",
            put.status()
        )));
    }

    // 3) diarize 작업 제출
    let job_id = submit_diarize(&client, api_key, &media_url, num_speakers).await?;

    // 4) 폴링 → 화자 구간 → DiarSegment
    let turns = poll_job(&client, api_key, &job_id).await?;
    Ok(labels_to_segments(
        turns.into_iter().map(|t| (t.start, t.end, t.speaker)).collect(),
    ))
}

async fn create_presigned(
    client: &reqwest::Client,
    api_key: &str,
    media_url: &str,
) -> ConverterResult<String> {
    let resp = client
        .post(format!("{API_BASE}/media/input"))
        .bearer_auth(api_key)
        .json(&serde_json::json!({ "url": media_url }))
        .send()
        .await?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(api_error("media/input", status, &body));
    }
    let r: PresignedResp = resp.json().await?;
    Ok(r.url)
}

async fn submit_diarize(
    client: &reqwest::Client,
    api_key: &str,
    media_url: &str,
    num_speakers: Option<usize>,
) -> ConverterResult<String> {
    let mut body = serde_json::json!({ "url": media_url, "model": "precision-2" });
    if let Some(n) = num_speakers {
        body["numSpeakers"] = serde_json::json!(n);
    }
    let resp = client
        .post(format!("{API_BASE}/diarize"))
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await?;
    let status = resp.status();
    if !status.is_success() {
        let txt = resp.text().await.unwrap_or_default();
        return Err(api_error("diarize", status, &txt));
    }
    let r: JobIdResp = resp.json().await?;
    Ok(r.job_id)
}

async fn poll_job(
    client: &reqwest::Client,
    api_key: &str,
    job_id: &str,
) -> ConverterResult<Vec<RawTurn>> {
    for _ in 0..POLL_MAX_ATTEMPTS {
        let resp = client
            .get(format!("{API_BASE}/jobs/{job_id}"))
            .bearer_auth(api_key)
            .send()
            .await?;
        let status = resp.status();
        if !status.is_success() {
            let txt = resp.text().await.unwrap_or_default();
            return Err(api_error("jobs", status, &txt));
        }
        let job: JobResp = resp.json().await?;
        match job.status.as_str() {
            "succeeded" => {
                return Ok(job.output.unwrap_or_default().diarization);
            }
            "failed" | "canceled" => {
                let msg = job
                    .output
                    .and_then(|o| o.error)
                    .unwrap_or_else(|| "원인 미상".into());
                return Err(ConverterError::Internal(format!(
                    "pyannote.ai 작업 {} — {}",
                    job.status, msg
                )));
            }
            _ => {
                tokio::time::sleep(Duration::from_secs(POLL_INTERVAL_SECS)).await;
            }
        }
    }
    Err(ConverterError::Internal(
        "pyannote.ai 작업 시간 초과 (30분)".into(),
    ))
}

fn api_error(route: &str, status: reqwest::StatusCode, body: &str) -> ConverterError {
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return ConverterError::Internal(
            "pyannote.ai 인증 실패 — Settings 에서 API 키를 확인하세요".into(),
        );
    }
    let snippet: String = body.chars().take(200).collect();
    ConverterError::Internal(format!("pyannote.ai {} 오류 (HTTP {}): {}", route, status, snippet))
}
