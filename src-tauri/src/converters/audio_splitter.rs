//! ffmpeg 기반 오디오 청크 분할 + duration/녹음시각 추출.
//!
//! doc-converter src/utils/audio-splitter.ts 포팅.
//! - probe_duration: ffprobe -show_entries format=duration
//! - probe_recording_time: ffprobe 메타데이터 creation_time / date / TDRC
//! - split_audio_to_chunks: -ss/-t/-c copy (재인코딩 회피)
//!
//! ffmpeg/ffprobe binary 는 ffmpeg-sidecar 가 자동 다운로드 후 사용자 home 캐시.

use crate::converters::error::{ConverterError, ConverterResult};
use chrono::DateTime;
use std::path::{Path, PathBuf};
use std::sync::Once;
use tokio::process::Command;

static INIT: Once = Once::new();

const CHUNK_SIZE_GUARD_BYTES: u64 = 150 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct AudioChunk {
    pub chunk_path: PathBuf,
    pub start_sec: f64,
    #[allow(dead_code)]
    pub index: usize,
}

/// App 시작 시 한 번 호출. ffmpeg binary 가 없으면 다운로드.
pub fn ensure_ffmpeg_blocking() -> ConverterResult<()> {
    let mut err: Option<String> = None;
    INIT.call_once(|| {
        if let Err(e) = ffmpeg_sidecar::download::auto_download() {
            err = Some(e.to_string());
        }
    });
    if let Some(msg) = err {
        return Err(ConverterError::Ffmpeg(format!(
            "ffmpeg 자동 다운로드 실패: {}",
            msg
        )));
    }
    Ok(())
}

fn ffmpeg_binary() -> &'static str {
    "ffmpeg"
}

fn ffprobe_binary() -> &'static str {
    "ffprobe"
}

/// 오디오 길이 (초)
pub async fn probe_duration(path: &Path) -> ConverterResult<f64> {
    ensure_ffmpeg_blocking()?;
    let output = Command::new(ffprobe_binary())
        .args([
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
        ])
        .arg(path)
        .output()
        .await
        .map_err(|e| ConverterError::Ffmpeg(format!("ffprobe 실행 실패: {}", e)))?;
    if !output.status.success() {
        return Err(ConverterError::Ffmpeg(format!(
            "ffprobe duration 측정 실패 (exit {}): {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        )));
    }
    let raw = String::from_utf8_lossy(&output.stdout);
    let trimmed = raw.trim();
    trimmed.parse::<f64>().map_err(|_| {
        ConverterError::Ffmpeg(format!("ffprobe duration 파싱 실패: '{}'", trimmed))
    })
}

/// 녹음 시각 메타데이터 추출. 없으면 Ok(None).
pub async fn probe_recording_time(
    path: &Path,
) -> ConverterResult<Option<chrono::DateTime<chrono::Utc>>> {
    ensure_ffmpeg_blocking()?;
    let output = Command::new(ffprobe_binary())
        .args(["-v", "quiet", "-print_format", "json", "-show_format"])
        .arg(path)
        .output()
        .await
        .map_err(|e| ConverterError::Ffmpeg(format!("ffprobe 실행 실패: {}", e)))?;
    if !output.status.success() {
        return Ok(None);
    }
    let raw = String::from_utf8_lossy(&output.stdout);
    let parsed: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return Ok(None),
    };
    let tags = parsed.get("format").and_then(|f| f.get("tags"));
    let Some(tags) = tags else {
        return Ok(None);
    };
    for key in [
        "creation_time",
        "CREATION_TIME",
        "date",
        "DATE",
        "TDRC",
        "TDOR",
        "recorded_date",
    ] {
        if let Some(s) = tags.get(key).and_then(|v| v.as_str()) {
            if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
                return Ok(Some(dt.with_timezone(&chrono::Utc)));
            }
            // "YYYY-MM-DD HH:MM:SS" 형식
            if let Ok(naive) = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S") {
                return Ok(Some(DateTime::from_naive_utc_and_offset(
                    naive,
                    chrono::Utc,
                )));
            }
            // 연도만 ("YYYY")
            if s.len() == 4 {
                if let Ok(year) = s.parse::<i32>() {
                    if let Some(dt) = chrono::NaiveDate::from_ymd_opt(year, 1, 1)
                        .and_then(|d| d.and_hms_opt(0, 0, 0))
                    {
                        return Ok(Some(DateTime::from_naive_utc_and_offset(dt, chrono::Utc)));
                    }
                }
            }
        }
    }
    Ok(None)
}

/// 오디오를 시간 단위 청크로 분할.
/// 입력 옆 임시 디렉토리에 mp3 청크 생성. 호출자가 cleanup_chunks() 로 정리.
pub async fn split_audio_to_chunks(
    input: &Path,
    chunk_duration_sec: f64,
) -> ConverterResult<Vec<AudioChunk>> {
    ensure_ffmpeg_blocking()?;
    let duration = probe_duration(input).await?;
    let num_chunks = (duration / chunk_duration_sec).ceil() as usize;

    let parent = input.parent().unwrap_or_else(|| Path::new("."));
    let out_dir = parent.join(format!("audio_chunks_{}", uuid::Uuid::new_v4().simple()));
    tokio::fs::create_dir_all(&out_dir).await?;

    let mut chunks = Vec::with_capacity(num_chunks);
    for i in 0..num_chunks {
        let intended_start = i as f64 * chunk_duration_sec;
        let chunk_path = out_dir.join(format!("chunk_{:03}.mp3", i));

        // 1st try: -c copy (재인코딩 없음 — 빠름)
        let try1 = Command::new(ffmpeg_binary())
            .args(["-y", "-ss"])
            .arg(format!("{}", intended_start))
            .args(["-t"])
            .arg(format!("{}", chunk_duration_sec))
            .arg("-i")
            .arg(input)
            .args(["-c", "copy", "-vn"])
            .arg(&chunk_path)
            .output()
            .await;
        let copy_ok = match try1 {
            Ok(o) => o.status.success() && tokio::fs::metadata(&chunk_path).await.is_ok(),
            Err(_) => false,
        };
        if !copy_ok {
            // fallback: 128kbps mp3 재인코딩
            let _ = tokio::fs::remove_file(&chunk_path).await;
            let try2 = Command::new(ffmpeg_binary())
                .args(["-y", "-ss"])
                .arg(format!("{}", intended_start))
                .args(["-t"])
                .arg(format!("{}", chunk_duration_sec))
                .arg("-i")
                .arg(input)
                .args(["-vn", "-acodec", "libmp3lame", "-b:a", "128k"])
                .arg(&chunk_path)
                .output()
                .await
                .map_err(|e| ConverterError::Ffmpeg(format!("청크 분할 실패: {}", e)))?;
            if !try2.status.success() {
                return Err(ConverterError::Ffmpeg(format!(
                    "청크 {} 분할 실패: {}",
                    i,
                    String::from_utf8_lossy(&try2.stderr)
                )));
            }
        }

        // 사이즈 가드: 150MB 초과 시 64kbps 다운샘플
        if let Ok(meta) = tokio::fs::metadata(&chunk_path).await {
            if meta.len() > CHUNK_SIZE_GUARD_BYTES {
                let _ = tokio::fs::remove_file(&chunk_path).await;
                let _ = Command::new(ffmpeg_binary())
                    .args(["-y", "-ss"])
                    .arg(format!("{}", intended_start))
                    .args(["-t"])
                    .arg(format!("{}", chunk_duration_sec))
                    .arg("-i")
                    .arg(input)
                    .args(["-vn", "-acodec", "libmp3lame", "-b:a", "64k"])
                    .arg(&chunk_path)
                    .output()
                    .await;
            }
        }

        chunks.push(AudioChunk {
            chunk_path,
            start_sec: intended_start,
            index: i,
        });
    }

    // 실측 길이로 누적 startSec 보정
    let mut cumulative = 0.0;
    for chunk in chunks.iter_mut() {
        let measured = probe_duration(&chunk.chunk_path).await.unwrap_or(chunk_duration_sec);
        chunk.start_sec = cumulative;
        cumulative += measured;
    }

    Ok(chunks)
}

pub async fn cleanup_chunks(chunks: &[AudioChunk]) {
    if let Some(first) = chunks.first() {
        if let Some(dir) = first.chunk_path.parent() {
            let _ = tokio::fs::remove_dir_all(dir).await;
        }
    }
}
