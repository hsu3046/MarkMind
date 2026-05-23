//! 음성 변환 파이프라인 — doc-converter src/services/audio-pipeline.ts 포팅.
//!
//! - 짧은 파일 (≤9분): inline base64 → Gemini 단일 호출
//! - 긴 파일 (>9분, ≤4시간): 10분 청크 분할 → File API 순차 처리
//!   - 청크 간 컨텍스트 (직전 청크 마지막 발화) 전달 → 화자 라벨 일관성
//! - 결과: 타임스탬프 버전 + 클린 버전 2개 .md
//!
//! VAD 무음 제거 (trimSilence=true) 는 향후 구현 — 현재는 옵션 무시.

use super::audio_splitter::{
    cleanup_chunks, probe_duration, probe_recording_time, split_audio_to_chunks, AudioChunk,
};
use super::error::{ConverterError, ConverterResult};
use super::keychain::{get_key, Provider};
use super::llm::gemini;
use super::progress::{fmt_duration, ProgressEmitter};
use super::templates::{build_evidence_markdown, EvidenceMeta};
use super::vad::{cleanup_trimmed, trim_silence, trimmed_to_original, SegmentMap, TrimResult, VadOptions};
use super::{conversions_dir, CostSummary, EvidenceType, UsageInfo, MODEL_AUDIO};
use base64::Engine;
use chrono::{FixedOffset, Utc};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::path::Path;

const CHUNK_THRESHOLD_SEC: f64 = 9.0 * 60.0;
const CHUNK_DURATION_SEC: f64 = 10.0 * 60.0;
const MAX_DURATION_SEC: f64 = 4.0 * 3600.0;
const PREV_CONTEXT_LINES: usize = 6;

const BASE_TRANSCRIBE_PROMPT: &str = "이 오디오 파일의 내용을 한국어로 정확하게 녹취해주세요.

## 요구사항:
1. 화자를 구분해주세요 (화자A, 화자B 등).
2. 타임스탬프를 [HH:MM:SS] 형식으로 포함해주세요.
3. 아래 형식으로 출력해주세요:

**[00:00:12] 화자A:** 대화 내용...

**[00:00:25] 화자B:** 대화 내용...

4. 불확실한 부분은 (불명확) 표시를 해주세요.
5. 위 형식의 녹취록만 출력하세요. 추가 설명은 불필요합니다.";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioJobOptions {
    pub file_path: String,
    #[serde(rename = "originalName", skip_serializing_if = "Option::is_none")]
    pub original_name: Option<String>,
    #[serde(default, rename = "trimSilence")]
    pub trim_silence: bool,
    #[serde(rename = "outputDir", skip_serializing_if = "Option::is_none")]
    pub output_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioJobResult {
    #[serde(rename = "timestampedPath")]
    pub timestamped_path: String,
    #[serde(rename = "cleanPath")]
    pub clean_path: String,
    pub cost: CostSummary,
}

pub async fn run(
    emitter: &ProgressEmitter,
    opts: AudioJobOptions,
    app: &tauri::AppHandle,
) -> ConverterResult<AudioJobResult> {
    let api_key = get_key(Provider::Gemini)?
        .ok_or(ConverterError::MissingApiKey("Gemini"))?;
    let file_path = Path::new(&opts.file_path).to_path_buf();
    let file_name = opts
        .original_name
        .clone()
        .unwrap_or_else(|| file_path.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string());
    let basename = std::path::Path::new(&file_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("audio")
        .to_string();

    emitter.emit(format!("📤 파일 확인 완료 — {}", file_name), None);

    let recorded_at_dt = probe_recording_time(&file_path).await.ok().flatten();
    let recorded_at = recorded_at_dt.map(format_kst);
    if let Some(r) = &recorded_at {
        emitter.emit(format!("🕐 녹음 시각: {}", r), None);
    }

    // VAD 무음 제거 (옵션 ON 시)
    let mut trim: Option<TrimResult> = None;
    let mut work_path = file_path.clone();
    if opts.trim_silence {
        match trim_silence(app, &file_path, VadOptions::default(), emitter).await {
            Ok(tr) => {
                if !tr.is_passthrough {
                    work_path = tr.trimmed_path.clone();
                }
                trim = Some(tr);
            }
            Err(e) => {
                emitter.emit(
                    "⚠️ 무음 제거 실패 — 원본 그대로 진행합니다",
                    Some(e.to_string()),
                );
            }
        }
    }

    let result = run_pipeline_core(
        &api_key,
        emitter,
        &work_path,
        &file_name,
        &basename,
        recorded_at,
        trim.as_ref(),
        opts.output_dir,
    )
    .await;

    if let Some(tr) = trim.as_ref() {
        cleanup_trimmed(tr).await;
    }

    return result;
}

async fn run_pipeline_core(
    api_key: &str,
    emitter: &ProgressEmitter,
    work_path: &Path,
    file_name: &str,
    basename: &str,
    recorded_at: Option<String>,
    trim: Option<&TrimResult>,
    output_dir: Option<String>,
) -> ConverterResult<AudioJobResult> {
    let file_path = work_path.to_path_buf();
    let segment_map: Option<Vec<SegmentMap>> = trim.map(|t| t.segment_map.clone());
    let duration = match probe_duration(&file_path).await {
        Ok(d) => d,
        Err(e) => {
            emitter.emit("⚠️ 길이 측정 실패 — 그대로 진행합니다", Some(e.to_string()));
            return run_inline_path(
                api_key,
                emitter,
                &file_path,
                file_name,
                basename,
                recorded_at,
                output_dir,
                segment_map.as_deref(),
            )
            .await;
        }
    };

    if duration > MAX_DURATION_SEC {
        return Err(ConverterError::Validation(format!(
            "오디오 길이 {:.1}분이 최대 한도({:.0}분)를 초과합니다.",
            duration / 60.0,
            MAX_DURATION_SEC / 60.0
        )));
    }

    if duration <= CHUNK_THRESHOLD_SEC {
        emitter.emit(format!("🎙️ 녹취 중... ({})", fmt_duration(duration)), None);
        return run_inline_path(
            api_key,
            emitter,
            &file_path,
            file_name,
            basename,
            recorded_at,
            output_dir,
            segment_map.as_deref(),
        )
        .await;
    }

    // 청크 모드
    let num_chunks = (duration / CHUNK_DURATION_SEC).ceil() as usize;
    emitter.emit(
        "🔪 녹음 파일 분할 중",
        Some(format!(
            "{}분씩 {}조각",
            (CHUNK_DURATION_SEC / 60.0) as u64,
            num_chunks
        )),
    );

    let chunks = split_audio_to_chunks(&file_path, CHUNK_DURATION_SEC).await?;
    emitter.emit("✅ 분할 완료", None);

    let mut usages: Vec<UsageInfo> = Vec::new();
    let chunk_results = transcribe_chunks_sequential(api_key, &chunks, emitter, &mut usages).await;
    cleanup_chunks(&chunks).await;
    let chunk_results = chunk_results?;

    emitter.emit("💾 결과 합치는 중...", None);

    let mut merged = chunk_results
        .iter()
        .map(|r| offset_timestamps(&r.text, r.start_sec).trim().to_string())
        .collect::<Vec<_>>()
        .join("\n\n");

    // trim 적용 시 timestamp 가 trimmed 시각 기준 → 원본 시각으로 역매핑
    if let Some(map) = segment_map.as_deref() {
        merged = map_timestamps_to_original(&merged, map);
    }

    save_audio_results(
        emitter,
        merged,
        file_name.to_string(),
        basename.to_string(),
        recorded_at,
        usages,
        output_dir,
    )
    .await
}

#[derive(Debug)]
struct ChunkResult {
    start_sec: f64,
    text: String,
}

async fn run_inline_path(
    api_key: &str,
    emitter: &ProgressEmitter,
    file_path: &Path,
    file_name: &str,
    basename: &str,
    recorded_at: Option<String>,
    output_dir: Option<String>,
    segment_map: Option<&[SegmentMap]>,
) -> ConverterResult<AudioJobResult> {
    let start = std::time::Instant::now();
    let buffer = tokio::fs::read(file_path).await?;
    let mime = guess_mime(file_path);
    let base64 = base64::engine::general_purpose::STANDARD.encode(&buffer);
    let result = gemini::generate_text(
        api_key,
        MODEL_AUDIO,
        BASE_TRANSCRIBE_PROMPT,
        vec![gemini::InlineData {
            mime_type: mime.into(),
            data_base64: base64,
        }],
        None,
    )
    .await?;
    emitter.emit(
        "✅ 녹취 완료",
        Some(format!("{:.0}초 소요", start.elapsed().as_secs_f64())),
    );

    // trim 적용 시 timestamp 가 trimmed 시각 기준 → 원본 시각으로 역매핑
    let body = if let Some(map) = segment_map {
        map_timestamps_to_original(&result.text, map)
    } else {
        result.text
    };

    let usages = vec![result.usage];
    save_audio_results(
        emitter,
        body,
        file_name.to_string(),
        basename.to_string(),
        recorded_at,
        usages,
        output_dir,
    )
    .await
}

/// trimmed 시각 기준 [HH:MM:SS] 를 원본 시각으로 역변환.
/// VAD trim 적용 후 Gemini 응답의 모든 timestamp 에 적용.
fn map_timestamps_to_original(text: &str, map: &[SegmentMap]) -> String {
    let re = Regex::new(r"\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]").unwrap();
    re.replace_all(text, |caps: &regex::Captures| {
        let a: f64 = caps[1].parse().unwrap_or(0.0);
        let b: f64 = caps[2].parse().unwrap_or(0.0);
        let c: f64 = caps.get(3).and_then(|m| m.as_str().parse().ok()).unwrap_or(-1.0);
        let trimmed = if c >= 0.0 {
            a * 3600.0 + b * 60.0 + c
        } else {
            a * 60.0 + b
        };
        let original = trimmed_to_original(trimmed, map);
        format_ts(original as i64)
    })
    .into_owned()
}

async fn transcribe_chunks_sequential(
    api_key: &str,
    chunks: &[AudioChunk],
    emitter: &ProgressEmitter,
    usages: &mut Vec<UsageInfo>,
) -> ConverterResult<Vec<ChunkResult>> {
    let total = chunks.len();
    let mut prev_context: Option<String> = None;
    let mut results = Vec::with_capacity(chunks.len());
    let mut cumulative_cost = 0.0;

    for (i, chunk) in chunks.iter().enumerate() {
        emitter.emit(
            format!("🎙️ {}/{}번째 조각 녹취 중...", i + 1, total),
            if i == 0 { None } else { Some("이전 대화 이어받기".into()) },
        );
        let prompt = build_prompt_with_context(prev_context.as_deref());
        let start = std::time::Instant::now();
        let mime = guess_mime(&chunk.chunk_path);
        let progress_cb = |msg: &str| emitter.emit(msg.to_string(), None);
        let result = gemini::generate_text_with_file_api(
            api_key,
            MODEL_AUDIO,
            &prompt,
            &chunk.chunk_path,
            mime,
            Some(&progress_cb),
        )
        .await?;
        cumulative_cost += result.usage.cost_usd;
        usages.push(result.usage.clone());
        emitter.emit(
            format!("✅ {}/{}번째 완료", i + 1, total),
            Some(format!(
                "{:.0}초 소요 · 누적 ${:.3}",
                start.elapsed().as_secs_f64(),
                cumulative_cost
            )),
        );
        prev_context = Some(extract_last_speaker_lines(&result.text, PREV_CONTEXT_LINES));
        results.push(ChunkResult {
            start_sec: chunk.start_sec,
            text: result.text,
        });
    }
    Ok(results)
}

fn build_prompt_with_context(prev_context: Option<&str>) -> String {
    match prev_context {
        Some(ctx) if !ctx.is_empty() => format!(
            "{}\n\n## 직전 구간 마지막 발화 (참고용 — 라벨 일관성)\n이 오디오는 같은 미팅의 이어지는 구간입니다. 직전에 등장한 화자가 다시 말하면 같은 라벨(화자A/B 등)을 유지하세요. 새 화자라면 다음 알파벳(화자C, 화자D...)을 부여하세요.\n\n{}",
            BASE_TRANSCRIBE_PROMPT, ctx
        ),
        _ => BASE_TRANSCRIBE_PROMPT.to_string(),
    }
}

fn extract_last_speaker_lines(text: &str, n: usize) -> String {
    // 1차: 표준 형식 (`**[HH:MM:SS] 화자A:**` 또는 `**[MM:SS] Speaker1:**`)
    // 2차 fallback: bold 마커 없거나 비표준 화자명 (`화자 김철수:`, `Speaker B:` 등) 도 수집.
    // doc-converter 와 동일한 컨텍스트 일관성 유지 + LLM 응답 변형에 견고.
    let strict = Regex::new(
        r"\*\*\[\d{1,2}:\d{2}(?::\d{2})?\]\s+[^\*\n]+?:\*\*\s*[^\n]+",
    )
    .expect("regex compile");
    let mut matches: Vec<&str> = strict.find_iter(text).map(|m| m.as_str()).collect();

    if matches.is_empty() {
        // bold 마커 없는 변형 — `[00:12] 화자A: 발언...`
        let loose = Regex::new(
            r"\[\d{1,2}:\d{2}(?::\d{2})?\]\s+[^\*\n:]+?:\s*[^\n]+",
        )
        .expect("regex compile");
        matches = loose.find_iter(text).map(|m| m.as_str()).collect();
    }

    let take = matches.len().saturating_sub(n);
    matches[take..].join("\n")
}

fn offset_timestamps(text: &str, offset_sec: f64) -> String {
    let re = Regex::new(r"\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]").unwrap();
    let offset_sec_i64 = offset_sec as i64;
    re.replace_all(text, |caps: &regex::Captures| {
        let a: i64 = caps[1].parse().unwrap_or(0);
        let b: i64 = caps[2].parse().unwrap_or(0);
        let c: i64 = caps.get(3).and_then(|m| m.as_str().parse().ok()).unwrap_or(-1);
        let total = if c >= 0 {
            a * 3600 + b * 60 + c
        } else {
            a * 60 + b
        };
        let final_total = total + offset_sec_i64;
        format_ts(final_total)
    })
    .into_owned()
}

fn format_ts(total_sec: i64) -> String {
    let h = total_sec / 3600;
    let m = (total_sec % 3600) / 60;
    let s = total_sec % 60;
    format!("[{:02}:{:02}:{:02}]", h, m, s)
}

fn remove_timestamps(timestamped: &str) -> String {
    let re = Regex::new(r"\*\*\[\d{1,2}:\d{2}(?::\d{2})?\]\s*").unwrap();
    re.replace_all(timestamped, "**").into_owned()
}

fn guess_mime(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "m4a" | "qta" => "audio/mp4",
        "aac" => "audio/aac",
        "ogg" => "audio/ogg",
        "flac" => "audio/flac",
        "wma" => "audio/x-ms-wma",
        "amr" => "audio/amr",
        "opus" => "audio/opus",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        _ => "audio/mpeg",
    }
}

fn format_kst(dt: chrono::DateTime<chrono::Utc>) -> String {
    let kst = FixedOffset::east_opt(9 * 3600).unwrap();
    dt.with_timezone(&kst).format("%Y-%m-%d %H:%M").to_string()
}

async fn save_audio_results(
    emitter: &ProgressEmitter,
    body: String,
    file_name: String,
    basename: String,
    recorded_at: Option<String>,
    usages: Vec<UsageInfo>,
    output_dir: Option<String>,
) -> ConverterResult<AudioJobResult> {
    let target_dir = output_dir
        .as_deref()
        .map(std::path::PathBuf::from)
        .unwrap_or_else(conversions_dir);
    std::fs::create_dir_all(&target_dir)?;

    let meta = EvidenceMeta::new(EvidenceType::Transcript, file_name.clone())
        .with_recorded_at(recorded_at);

    let timestamped_md = build_evidence_markdown(&meta, body.trim());
    let clean_md = build_evidence_markdown(&meta, remove_timestamps(&body).trim());

    let safe = sanitize(&basename);
    let timestamped_path = unique_path(&target_dir, &format!("녹취록_{}_타임스탬프", safe), "md");
    let clean_path = unique_path(&target_dir, &format!("녹취록_{}", safe), "md");
    std::fs::write(&timestamped_path, &timestamped_md)?;
    std::fs::write(&clean_path, &clean_md)?;

    // doc-converter 와 동일: 마지막 저장 step 은 표시하지 않음. 결과 카드의 경로로 충분.

    let _ = Utc::now(); // 미사용 경고 회피

    Ok(AudioJobResult {
        timestamped_path: timestamped_path.to_string_lossy().into_owned(),
        clean_path: clean_path.to_string_lossy().into_owned(),
        cost: CostSummary::from_usages(usages),
    })
}

fn sanitize(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '_' || c == '-' || c == ' ' || c == '.' {
                c
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim()
        .to_string()
}

fn unique_path(dir: &Path, stem: &str, ext: &str) -> std::path::PathBuf {
    let base = dir.join(format!("{}.{}", stem, ext));
    if !base.exists() {
        return base;
    }
    for i in 2..1000 {
        let candidate = dir.join(format!("{} ({}).{}", stem, i, ext));
        if !candidate.exists() {
            return candidate;
        }
    }
    base
}

// ─── Tests ───
#[cfg(test)]
mod tests {
    use super::*;

    /// offset_timestamps — [HH:MM:SS] 에 offset 적용
    #[test]
    fn test_offset_timestamps_hhmmss() {
        let text = "**[00:05:00] 화자A:** 안녕하세요";
        let result = offset_timestamps(text, 600.0); // +10분
        assert!(result.contains("[00:15:00]"));
    }

    /// offset_timestamps — [MM:SS] 형식도 처리 (Gemini 가 짧은 청크에서 단축 출력)
    #[test]
    fn test_offset_timestamps_mmss() {
        let text = "**[05:30] 화자A:** 발언";
        let result = offset_timestamps(text, 0.0);
        // [MM:SS] → [HH:MM:SS] 변환
        assert!(result.contains("[00:05:30]"));
    }

    /// remove_timestamps — 모든 [HH:MM:SS] 제거
    #[test]
    fn test_remove_timestamps() {
        let text = "**[00:05:00] 화자A:** 안녕\n**[00:06:00] 화자B:** 네";
        let result = remove_timestamps(text);
        assert!(!result.contains('['));
        assert!(result.contains("화자A:**"));
    }

    /// format_ts — i64 초 → [HH:MM:SS]
    #[test]
    fn test_format_ts() {
        assert_eq!(format_ts(0), "[00:00:00]");
        assert_eq!(format_ts(3661), "[01:01:01]");
        assert_eq!(format_ts(86400), "[24:00:00]");
    }

    /// extract_last_speaker_lines — 표준 형식 매칭
    #[test]
    fn test_extract_last_speaker_lines_strict() {
        let text = "**[00:00:10] 화자A:** 첫 번째\n**[00:00:20] 화자B:** 두 번째\n**[00:00:30] 화자C:** 세 번째";
        let result = extract_last_speaker_lines(text, 2);
        assert!(result.contains("화자B"));
        assert!(result.contains("화자C"));
        assert!(!result.contains("화자A")); // 마지막 2개만
    }

    /// extract_last_speaker_lines — 비표준 형식 fallback (bold 마커 없음)
    #[test]
    fn test_extract_last_speaker_lines_loose_fallback() {
        let text = "[00:05] 화자A: 발언 1\n[00:10] 화자B: 발언 2";
        let result = extract_last_speaker_lines(text, 5);
        // strict 패턴은 매칭 안 됨 → loose fallback
        assert!(result.contains("화자A") || result.contains("화자B"));
    }

    /// map_timestamps_to_original — segment_map 으로 trimmed → original 시각 매핑
    #[test]
    fn test_map_timestamps_to_original() {
        use crate::converters::vad::SegmentMap;
        // trimmed [0-10] → original [30-40]
        let map = vec![SegmentMap {
            trimmed_start: 0.0,
            trimmed_end: 10.0,
            original_start: 30.0,
            original_end: 40.0,
        }];
        let text = "**[00:00:05] 화자A:** 발언";
        let result = map_timestamps_to_original(text, &map);
        // trimmed 5초 = original 35초
        assert!(result.contains("[00:00:35]"));
    }
}
