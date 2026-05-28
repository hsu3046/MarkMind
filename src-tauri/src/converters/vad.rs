//! Silero VAD v5 ONNX 추론 + 무음 제거.
//!
//! doc-converter src/utils/vad.ts + trim-silence.ts 1:1 포팅.
//!
//! 흐름:
//!   1) ffmpeg 로 input → 16kHz mono PCM (s16le)
//!   2) Silero VAD 추론 (512-sample 윈도우, LSTM state carry-over)
//!   3) post-processing (threshold + min duration + pad + merge)
//!   4) ffmpeg concat demuxer 로 speech 구간만 이어붙인 mp3 + 매핑 테이블

use crate::converters::error::{ConverterError, ConverterResult};
use crate::converters::progress::{fmt_duration, ProgressEmitter};
use ndarray::{Array, Array1, Array3};
use super::audio_splitter::ffmpeg_path;
use ort::session::{builder::GraphOptimizationLevel, Session};
use ort::value::TensorRef;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tokio::process::Command;

const SAMPLE_RATE: u32 = 16000;
const WINDOW_SAMPLES: usize = 512;

// ONNX session 은 매 호출마다 생성하면 비싸므로 한 번 로드 후 재사용.
// Silero VAD 는 stateful 하지만 state 자체는 호출자가 관리 → session 공유 안전.
// - OnceLock 으로 lazy init (런타임 1회)
// - Mutex poisoning 시 PoisonError::into_inner() 로 복구 (panic 무시 — 데이터 정합성 OK)
static SESSION: OnceLock<Mutex<Session>> = OnceLock::new();

#[derive(Debug, Clone)]
pub struct SpeechSegment {
    pub start_sec: f64,
    pub end_sec: f64,
}

#[derive(Debug, Clone, Copy)]
pub struct VadOptions {
    pub threshold: f32,
    pub min_speech_duration_ms: u32,
    pub min_silence_duration_ms: u32,
    pub speech_pad_ms: u32,
    pub merge_gap_ms: u32,
}

impl Default for VadOptions {
    fn default() -> Self {
        Self {
            threshold: 0.5,
            min_speech_duration_ms: 250,
            min_silence_duration_ms: 1500,
            speech_pad_ms: 200,
            merge_gap_ms: 500,
        }
    }
}

/// trimmed 음성의 한 구간 ↔ 원본 음성의 한 구간 매핑.
#[derive(Debug, Clone, Copy)]
pub struct SegmentMap {
    pub trimmed_start: f64,
    pub trimmed_end: f64,
    pub original_start: f64,
    pub original_end: f64,
}

#[derive(Debug)]
pub struct TrimResult {
    pub trimmed_path: PathBuf,
    #[allow(dead_code)]
    pub original_duration: f64,
    #[allow(dead_code)]
    pub trimmed_duration: f64,
    pub segment_map: Vec<SegmentMap>,
    pub work_dir: PathBuf,
    /// segments 가 비어 입력 그대로 사용한 경우 — trimmed_path === input_path
    pub is_passthrough: bool,
}

/// VAD 추론 — doc-converter vad.ts:runVad 1:1.
pub fn run_vad(
    app: &tauri::AppHandle,
    pcm: &[i16],
    opts: VadOptions,
) -> ConverterResult<Vec<SpeechSegment>> {
    let model_path = resolve_model_path(app)?;
    let probs = run_inference(&model_path, pcm)?;
    Ok(post_process(
        &probs,
        PostProcessConfig {
            threshold: opts.threshold,
            min_speech_samples: ((opts.min_speech_duration_ms as f32 / 1000.0)
                * SAMPLE_RATE as f32) as usize,
            min_silence_samples: ((opts.min_silence_duration_ms as f32 / 1000.0)
                * SAMPLE_RATE as f32) as usize,
            speech_pad_samples: ((opts.speech_pad_ms as f32 / 1000.0)
                * SAMPLE_RATE as f32) as usize,
            merge_gap_samples: ((opts.merge_gap_ms as f32 / 1000.0)
                * SAMPLE_RATE as f32) as usize,
            total_samples: pcm.len(),
        },
    ))
}

fn ensure_session(model_path: &Path) -> ConverterResult<&'static Mutex<Session>> {
    if let Some(s) = SESSION.get() {
        return Ok(s);
    }
    let session = Session::builder()
        .map_err(|e| ConverterError::Vad(format!("Session builder: {}", e)))?
        .with_optimization_level(GraphOptimizationLevel::Level1)
        .map_err(|e| ConverterError::Vad(format!("optimization: {}", e)))?
        .with_intra_threads(1)
        .map_err(|e| ConverterError::Vad(format!("intra_threads: {}", e)))?
        .commit_from_file(model_path)
        .map_err(|e| ConverterError::Vad(format!("commit_from_file: {}", e)))?;
    // race: 다른 스레드가 먼저 set 했어도 set_or_init 으로 idempotent
    let _ = SESSION.set(Mutex::new(session));
    Ok(SESSION.get().expect("just initialized"))
}

fn run_inference(model_path: &Path, pcm: &[i16]) -> ConverterResult<Vec<f32>> {
    let session_mu = ensure_session(model_path)?;
    // poisoning 복구 — VAD 추론 panic 은 데이터 정합성에 영향 없으므로 inner 그대로 사용
    let mut session = session_mu
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    // LSTM hidden state: [2, 1, 128]. 윈도우마다 carry over.
    let mut state: Array3<f32> = Array3::<f32>::zeros((2, 1, 128));
    // sample rate 는 int64 tensor 로 매 호출에 전달 (Silero v5 입력 시그니처)
    let sr: Array1<i64> = Array::from_vec(vec![SAMPLE_RATE as i64]);

    let mut probs: Vec<f32> = Vec::with_capacity(pcm.len() / WINDOW_SAMPLES + 1);

    let total_windows = pcm.len() / WINDOW_SAMPLES;
    for w in 0..total_windows {
        let i = w * WINDOW_SAMPLES;
        // Int16 → Float32 정규화 (-1 ~ 1)
        let window: Array<f32, _> = Array::from_iter(
            pcm[i..i + WINDOW_SAMPLES]
                .iter()
                .map(|&s| (s as f32) / 32768.0),
        )
        .into_shape_with_order((1, WINDOW_SAMPLES))
        .map_err(|e| ConverterError::Vad(format!("input reshape: {}", e)))?;

        let outputs = session
            .run(ort::inputs![
                "input" => TensorRef::from_array_view(&window)
                    .map_err(|e| ConverterError::Vad(format!("input tensor: {}", e)))?,
                "state" => TensorRef::from_array_view(&state)
                    .map_err(|e| ConverterError::Vad(format!("state tensor: {}", e)))?,
                "sr" => TensorRef::from_array_view(&sr)
                    .map_err(|e| ConverterError::Vad(format!("sr tensor: {}", e)))?,
            ])
            .map_err(|e| ConverterError::Vad(format!("session.run: {}", e)))?;

        // output: speech 확률 (단일 f32)
        let out_array = outputs["output"]
            .try_extract_array::<f32>()
            .map_err(|e| ConverterError::Vad(format!("extract output: {}", e)))?;
        let prob = out_array.iter().next().copied().unwrap_or(0.0);
        probs.push(prob);

        // stateN: 다음 호출에 carry-over할 LSTM hidden state
        let new_state = outputs["stateN"]
            .try_extract_array::<f32>()
            .map_err(|e| ConverterError::Vad(format!("extract stateN: {}", e)))?;
        let new_state_vec: Vec<f32> = new_state.iter().copied().collect();
        state = Array3::from_shape_vec((2, 1, 128), new_state_vec)
            .map_err(|e| ConverterError::Vad(format!("state reshape: {}", e)))?;
    }

    Ok(probs)
}

struct PostProcessConfig {
    threshold: f32,
    min_speech_samples: usize,
    min_silence_samples: usize,
    speech_pad_samples: usize,
    merge_gap_samples: usize,
    total_samples: usize,
}

fn post_process(probs: &[f32], cfg: PostProcessConfig) -> Vec<SpeechSegment> {
    #[derive(Clone, Copy)]
    struct Seg {
        start: usize,
        end: usize,
    }
    let mut raw: Vec<Seg> = Vec::new();

    let mut triggered = false;
    let mut seg_start: usize = 0;
    let mut last_speech_end: usize = 0;
    let mut silence_count: usize = 0;

    for (w, &p) in probs.iter().enumerate() {
        let sample_pos = w * WINDOW_SAMPLES;
        let is_speech = p >= cfg.threshold;

        if is_speech && !triggered {
            triggered = true;
            seg_start = sample_pos;
            last_speech_end = sample_pos + WINDOW_SAMPLES;
            silence_count = 0;
        } else if is_speech && triggered {
            last_speech_end = sample_pos + WINDOW_SAMPLES;
            silence_count = 0;
        } else if !is_speech && triggered {
            silence_count += WINDOW_SAMPLES;
            if silence_count >= cfg.min_silence_samples {
                if last_speech_end.saturating_sub(seg_start) >= cfg.min_speech_samples {
                    raw.push(Seg {
                        start: seg_start,
                        end: last_speech_end,
                    });
                }
                triggered = false;
                silence_count = 0;
            }
        }
    }
    // tail segment 마감
    if triggered && last_speech_end.saturating_sub(seg_start) >= cfg.min_speech_samples {
        raw.push(Seg {
            start: seg_start,
            end: last_speech_end,
        });
    }

    // speech pad — 양끝에 여유. 인접 segment 의 경계는 침범 안 함.
    let mut padded: Vec<Seg> = Vec::with_capacity(raw.len());
    for (idx, s) in raw.iter().enumerate() {
        let prev_end = if idx > 0 { raw[idx - 1].end } else { 0 };
        let next_start = if idx < raw.len() - 1 {
            raw[idx + 1].start
        } else {
            cfg.total_samples
        };
        let start = s.start.saturating_sub(cfg.speech_pad_samples).max(prev_end);
        let end = (s.end + cfg.speech_pad_samples).min(next_start);
        padded.push(Seg { start, end });
    }

    // merge — pad 적용 후 가까워진 segment 합침
    let mut merged: Vec<Seg> = Vec::new();
    for s in padded {
        if let Some(last) = merged.last_mut() {
            if s.start.saturating_sub(last.end) <= cfg.merge_gap_samples {
                last.end = s.end;
                continue;
            }
        }
        merged.push(s);
    }

    merged
        .into_iter()
        .map(|s| SpeechSegment {
            start_sec: s.start as f64 / SAMPLE_RATE as f64,
            end_sec: s.end as f64 / SAMPLE_RATE as f64,
        })
        .collect()
}

// ─── trim_silence — doc-converter trim-silence.ts:trimSilence 1:1 ───

/// ffmpeg 로 input → 16kHz mono PCM (Int16Array 동치)
async fn decode_to_16k_pcm(input: &Path) -> ConverterResult<Vec<i16>> {
    let output = Command::new(ffmpeg_path()?)
        .args([
            "-i",
            input
                .to_str()
                .ok_or_else(|| ConverterError::Vad("non-UTF8 path".into()))?,
            "-ac",
            "1",
            "-ar",
            "16000",
            "-f",
            "s16le",
            "-loglevel",
            "error",
            "-",
        ])
        .output()
        .await
        .map_err(|e| ConverterError::Vad(format!("ffmpeg spawn: {}", e)))?;

    if !output.status.success() {
        return Err(ConverterError::Vad(format!(
            "ffmpeg PCM 디코드 실패 (exit {}): {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        )));
    }

    let bytes = output.stdout;
    let mut pcm = Vec::with_capacity(bytes.len() / 2);
    for chunk in bytes.chunks_exact(2) {
        pcm.push(i16::from_le_bytes([chunk[0], chunk[1]]));
    }
    Ok(pcm)
}

fn build_concat_demuxer_list(input_path: &Path, segments: &[SpeechSegment]) -> String {
    let escaped = input_path.to_string_lossy().replace('\'', "'\\''");
    let mut lines = vec!["ffconcat version 1.0".to_string()];
    for s in segments {
        lines.push(format!("file '{}'", escaped));
        lines.push(format!("inpoint {:.3}", s.start_sec));
        lines.push(format!("outpoint {:.3}", s.end_sec));
    }
    lines.push(String::new());
    lines.join("\n")
}

fn build_segment_map(segments: &[SpeechSegment]) -> Vec<SegmentMap> {
    let mut map: Vec<SegmentMap> = Vec::with_capacity(segments.len());
    let mut trimmed_cursor = 0.0_f64;
    for s in segments {
        let duration = s.end_sec - s.start_sec;
        map.push(SegmentMap {
            trimmed_start: trimmed_cursor,
            trimmed_end: trimmed_cursor + duration,
            original_start: s.start_sec,
            original_end: s.end_sec,
        });
        trimmed_cursor += duration;
    }
    map
}

/// input → VAD → trimmed mp3 + 매핑 테이블.
pub async fn trim_silence(
    app: &tauri::AppHandle,
    input: &Path,
    opts: VadOptions,
    emitter: &ProgressEmitter,
) -> ConverterResult<TrimResult> {
    // 임시 작업 디렉토리 — OS temp dir 사용 (input 폴더가 read-only 인 경우 대비).
    // tempfile 사용 안 함 (Drop 시 자동 삭제하지만 우리는 trim_result 가 work_dir 보유 후
    // cleanup_trimmed() 에서 명시 삭제)
    let work_dir = std::env::temp_dir().join(format!("markmind_vad_trim_{}", uuid::Uuid::new_v4().simple()));
    tokio::fs::create_dir_all(&work_dir).await?;

    // 1) PCM 디코드
    emitter.emit("🔊 오디오 분석 준비 중", None);
    let pcm = decode_to_16k_pcm(input).await?;
    let original_duration = pcm.len() as f64 / SAMPLE_RATE as f64;
    emitter.emit(
        format!("✅ 준비 완료 (총 {})", fmt_duration(original_duration)),
        None,
    );

    // 2) VAD 추론 (blocking — ONNX 는 동기) — spawn_blocking 으로 격리
    emitter.emit("🧠 대화 구간 찾는 중...", None);
    let app_handle = app.clone();
    let pcm_for_vad = pcm;
    let segments = tokio::task::spawn_blocking(move || run_vad(&app_handle, &pcm_for_vad, opts))
        .await
        .map_err(|e| ConverterError::Vad(format!("VAD spawn_blocking: {}", e)))??;

    if segments.is_empty() {
        emitter.emit(
            "⚠️ 대화 구간을 찾지 못해 정리 건너뜀",
            Some("원본 그대로 진행합니다".into()),
        );
        return Ok(TrimResult {
            trimmed_path: input.to_path_buf(),
            original_duration,
            trimmed_duration: original_duration,
            segment_map: vec![SegmentMap {
                trimmed_start: 0.0,
                trimmed_end: original_duration,
                original_start: 0.0,
                original_end: original_duration,
            }],
            work_dir,
            is_passthrough: true,
        });
    }

    let total_speech: f64 = segments
        .iter()
        .map(|s| s.end_sec - s.start_sec)
        .sum::<f64>();
    let ratio = (total_speech / original_duration) * 100.0;
    emitter.emit(
        format!("📒 대화 {}곳 발견", segments.len()),
        Some(format!(
            "총 {} (원본의 {:.0}%)",
            fmt_duration(total_speech),
            ratio
        )),
    );

    // 3) ffmpeg concat demuxer 로 trimmed mp3 생성.
    //
    // 이 단계는 입력 길이에 비례해 수십 초 ~ 분 단위로 길어질 수 있어서
    // 사용자가 "멈춘 거 아닌가?" 의심하기 쉽다. ffmpeg `.output()` 은
    // blocking 하나의 await 라 그 동안 emit 이 한 번도 안 나가는 게 원인.
    // 해결: ffmpeg 를 spawn 한 뒤 별도 tokio task 가 2초마다 heartbeat
    // 진행 메시지(⏳ 아이콘 + 경과 초)를 쏘게 해서 ProgressPanel 에
    // 살아 움직이는 신호를 만든다.
    emitter.emit(
        "✂️ 무음 잘라낸 파일 만드는 중...",
        Some(format!("{}개 segment 합치기", segments.len())),
    );
    let t_trim = std::time::Instant::now();
    let trimmed_path = work_dir.join("trimmed.mp3");
    let list_script = build_concat_demuxer_list(input, &segments);
    let list_path = work_dir.join("concat.txt");
    tokio::fs::write(&list_path, &list_script).await?;

    let mut child = Command::new(ffmpeg_path()?)
        .args([
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            list_path.to_str().unwrap(),
            "-acodec",
            "libmp3lame",
            "-b:a",
            "128k",
            "-loglevel",
            "error",
            trimmed_path.to_str().unwrap(),
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| ConverterError::Vad(format!("ffmpeg concat spawn: {}", e)))?;

    // Heartbeat task — emits an elapsed-time message every 2 seconds so the
    // UI keeps showing fresh activity while ffmpeg processes the concat.
    let hb_emitter = emitter.clone();
    let hb_token = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let hb_done = hb_token.clone();
    let hb_handle = tokio::spawn(async move {
        let start = std::time::Instant::now();
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            if hb_done.load(std::sync::atomic::Ordering::Relaxed) {
                break;
            }
            let secs = start.elapsed().as_secs();
            hb_emitter.emit(
                format!("⏳ 무음 잘라내는 중... ({}초 경과)", secs),
                None,
            );
        }
    });

    let output = child
        .wait_with_output()
        .await
        .map_err(|e| ConverterError::Vad(format!("ffmpeg concat wait: {}", e)))?;
    // Stop heartbeat as soon as ffmpeg exits. abort() is fine even if the
    // task already returned via the flag — it's a no-op.
    hb_token.store(true, std::sync::atomic::Ordering::Relaxed);
    hb_handle.abort();

    if !output.status.success() {
        return Err(ConverterError::Vad(format!(
            "ffmpeg concat 실패 (exit {}): {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        )));
    }

    // 4) 매핑 테이블 + trimmed 길이
    let segment_map = build_segment_map(&segments);
    let trimmed_duration = segment_map.last().map(|m| m.trimmed_end).unwrap_or(0.0);
    let saved = original_duration - trimmed_duration;
    emitter.emit(
        format!(
            "✅ 정리 완료 — {} → {}",
            fmt_duration(original_duration),
            fmt_duration(trimmed_duration)
        ),
        Some(format!(
            "{} 절약 ({:.0}초 소요)",
            fmt_duration(saved),
            t_trim.elapsed().as_secs_f64()
        )),
    );

    Ok(TrimResult {
        trimmed_path,
        original_duration,
        trimmed_duration,
        segment_map,
        work_dir,
        is_passthrough: false,
    })
}

/// trimmed 시각 → 원본 시각 역변환 (Gemini 응답의 [HH:MM:SS] 매핑)
pub fn trimmed_to_original(trimmed_sec: f64, map: &[SegmentMap]) -> f64 {
    if map.is_empty() {
        return trimmed_sec;
    }
    for m in map {
        if trimmed_sec >= m.trimmed_start && trimmed_sec <= m.trimmed_end {
            return m.original_start + (trimmed_sec - m.trimmed_start);
        }
    }
    let last = map.last().unwrap();
    if trimmed_sec > last.trimmed_end {
        return last.original_end;
    }
    trimmed_sec
}

pub async fn cleanup_trimmed(result: &TrimResult) {
    if result.is_passthrough {
        // 원본 그대로 사용한 경우 — workDir 만 정리, 원본은 절대 삭제 X
        let _ = tokio::fs::remove_dir_all(&result.work_dir).await;
    } else {
        let _ = tokio::fs::remove_dir_all(&result.work_dir).await;
    }
}

// ─── Tests ───
#[cfg(test)]
mod tests {
    use super::*;

    /// trimmed_to_original — 기본 매핑 (단일 segment)
    #[test]
    fn test_trimmed_to_original_single_segment() {
        let map = vec![SegmentMap {
            trimmed_start: 0.0,
            trimmed_end: 30.0,
            original_start: 5.0,
            original_end: 35.0,
        }];
        assert_eq!(trimmed_to_original(0.0, &map), 5.0);
        assert_eq!(trimmed_to_original(10.0, &map), 15.0);
        assert_eq!(trimmed_to_original(30.0, &map), 35.0);
    }

    /// trimmed_to_original — 다중 segment (무음 구간 잘려 trimmed 시각 압축)
    #[test]
    fn test_trimmed_to_original_multi_segment() {
        // 원본 [0-10] 화자 + [20-30] 무음 + [30-40] 화자
        // trimmed [0-10] [10-20]  ← 무음 10초 제거
        let map = vec![
            SegmentMap { trimmed_start: 0.0, trimmed_end: 10.0, original_start: 0.0, original_end: 10.0 },
            SegmentMap { trimmed_start: 10.0, trimmed_end: 20.0, original_start: 30.0, original_end: 40.0 },
        ];
        // trimmed 5초 = 원본 5초
        assert_eq!(trimmed_to_original(5.0, &map), 5.0);
        // trimmed 10초 = segment 경계 (첫 segment 끝)
        assert_eq!(trimmed_to_original(10.0, &map), 10.0);
        // trimmed 15초 = 두 번째 segment 의 5초 = 원본 35초
        assert_eq!(trimmed_to_original(15.0, &map), 35.0);
    }

    /// trimmed_to_original — 범위 초과 clamping
    #[test]
    fn test_trimmed_to_original_clamp() {
        let map = vec![SegmentMap {
            trimmed_start: 0.0, trimmed_end: 10.0,
            original_start: 0.0, original_end: 10.0,
        }];
        // 범위 초과 → 마지막 original_end 로 clamp
        assert_eq!(trimmed_to_original(15.0, &map), 10.0);
    }

    /// trimmed_to_original — 빈 map 은 입력 그대로
    #[test]
    fn test_trimmed_to_original_empty_map() {
        let map: Vec<SegmentMap> = vec![];
        assert_eq!(trimmed_to_original(42.0, &map), 42.0);
    }

    /// post_process — speech 가 전혀 없으면 빈 결과
    #[test]
    fn test_post_process_no_speech() {
        let probs = vec![0.1, 0.2, 0.1, 0.1]; // 모두 threshold 미만
        let cfg = PostProcessConfig {
            threshold: 0.5,
            min_speech_samples: 100,
            min_silence_samples: 100,
            speech_pad_samples: 0,
            merge_gap_samples: 0,
            total_samples: 4 * WINDOW_SAMPLES,
        };
        let result = post_process(&probs, cfg);
        assert!(result.is_empty());
    }

    /// post_process — 연속 speech window 가 단일 segment 로
    #[test]
    fn test_post_process_continuous_speech() {
        // 10 개 윈도우 모두 speech, 무음 0 → 1 segment
        let probs = vec![0.9; 10];
        let cfg = PostProcessConfig {
            threshold: 0.5,
            min_speech_samples: WINDOW_SAMPLES,
            min_silence_samples: WINDOW_SAMPLES * 4,
            speech_pad_samples: 0,
            merge_gap_samples: 0,
            total_samples: 10 * WINDOW_SAMPLES,
        };
        let result = post_process(&probs, cfg);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].start_sec, 0.0);
        assert!(result[0].end_sec > 0.0);
    }

    /// post_process — 짧은 silence 는 segment 분할 안 함 (min_silence_samples 미만)
    #[test]
    fn test_post_process_short_silence_merged() {
        // [speech speech silence speech] — silence 1 window 만 → min_silence_samples 미만
        let probs = vec![0.9, 0.9, 0.1, 0.9];
        let cfg = PostProcessConfig {
            threshold: 0.5,
            min_speech_samples: WINDOW_SAMPLES,
            min_silence_samples: WINDOW_SAMPLES * 4, // 4 windows 이상 무음만 분할
            speech_pad_samples: 0,
            merge_gap_samples: 0,
            total_samples: 4 * WINDOW_SAMPLES,
        };
        let result = post_process(&probs, cfg);
        // 짧은 무음은 단절 안 만들고 단일 segment 유지
        assert_eq!(result.len(), 1);
    }
}

/// VAD ONNX 모델 절대경로 (Tauri resources/silero_vad.onnx)
fn resolve_model_path(app: &tauri::AppHandle) -> ConverterResult<PathBuf> {
    use tauri::Manager;
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| ConverterError::Vad(format!("리소스 디렉토리 해석 실패: {}", e)))?;
    let path = resource_dir.join("resources").join("silero_vad.onnx");
    if !path.exists() {
        return Err(ConverterError::Vad(format!(
            "Silero VAD 모델 파일을 찾을 수 없습니다: {:?}",
            path
        )));
    }
    Ok(path)
}
