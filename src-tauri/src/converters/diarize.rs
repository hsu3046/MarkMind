//! 화자 분리 (speaker diarization) — pyannote-rs 기반.
//!
//! 입력: 16kHz mono PCM (i16). VAD 가 이미 만드는 포맷 그대로 사용 가능.
//! 출력: Vec<DiarSegment { start_sec, end_sec, speaker_id }> — 4시간 전체를 한 번에
//!       분석해 글로벌 speaker_id 부여. 청크 경계 무관.
//!
//! ONNX 모델 2개를 .app 안 resources/ 에서 로드:
//!   - segmentation-3.0.onnx
//!   - wespeaker_en_voxceleb_CAM++.onnx

use crate::converters::error::{ConverterError, ConverterResult};
use pyannote_rs::{EmbeddingExtractor, EmbeddingManager};
use std::path::PathBuf;
use tauri::Manager;

/// 한 발화 구간의 화자 ID. speaker_id 는 0-indexed integer (글로벌 — 청크 무관).
#[derive(Debug, Clone)]
pub struct DiarSegment {
    pub start_sec: f64,
    pub end_sec: f64,
    pub speaker_id: usize,
}

/// 사용자가 최대 화자 수 제한 — 기본 8 (대부분 회의 커버).
/// 초과 발화는 가장 유사한 기존 화자로 흡수.
const DEFAULT_MAX_SPEAKERS: usize = 8;

/// search_speaker threshold — cosine distance. 0.5 가 pyannote 권장 default.
/// 낮을수록 같은 화자 인정 빡빡함 (false negative ↑), 높을수록 느슨 (false positive ↑).
const SPEAKER_THRESHOLD: f32 = 0.5;

/// .app 안 resources 경로 — Tauri AppHandle 로 해결.
fn resolve_model_path(app: &tauri::AppHandle, name: &str) -> ConverterResult<PathBuf> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| ConverterError::Internal(format!("resource_dir: {}", e)))?;
    let candidates = [
        resource_dir.join("resources").join(name),
        resource_dir.join(name),
    ];
    for p in &candidates {
        if p.is_file() {
            return Ok(p.clone());
        }
    }
    // dev fallback — src-tauri/resources/
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join(name);
    if dev.is_file() {
        return Ok(dev);
    }
    Err(ConverterError::Internal(format!(
        "diarize 모델 {} 못 찾음 (resources/ 에 동봉 필요)",
        name
    )))
}

/// 16kHz mono PCM (i16) 입력 → 글로벌 화자 segments.
/// 4시간 음성도 한 번에 처리 가능 (메모리 ~1.4GB peak 가능, 큰 입력은 사전 청크 권장).
pub fn diarize_pcm(
    app: &tauri::AppHandle,
    pcm_i16: &[i16],
    sample_rate: u32,
    max_speakers: Option<usize>,
) -> ConverterResult<Vec<DiarSegment>> {
    if sample_rate != 16000 {
        return Err(ConverterError::Internal(format!(
            "diarize 입력은 16kHz 만 지원 (받은 값: {} Hz)",
            sample_rate
        )));
    }

    let seg_model = resolve_model_path(app, "segmentation-3.0.onnx")?;
    let emb_model = resolve_model_path(app, "wespeaker_en_voxceleb_CAM++.onnx")?;

    let max_spk = max_speakers.unwrap_or(DEFAULT_MAX_SPEAKERS);

    let segments_iter = pyannote_rs::get_segments(
        pcm_i16,
        sample_rate,
        seg_model.to_str().ok_or_else(|| {
            ConverterError::Internal("seg_model path non-UTF8".into())
        })?,
    )
    .map_err(|e| ConverterError::Internal(format!("get_segments: {:?}", e)))?;

    let mut extractor = EmbeddingExtractor::new(emb_model.to_str().ok_or_else(|| {
        ConverterError::Internal("emb_model path non-UTF8".into())
    })?)
    .map_err(|e| ConverterError::Internal(format!("EmbeddingExtractor: {:?}", e)))?;
    let mut manager = EmbeddingManager::new(max_spk);

    // pyannote-rs `EmbeddingManager` 는 speaker_id 를 1-indexed 로 부여 (1, 2, 3, ...).
    // 에러/None 케이스의 segment 는 results 에 안 넣음 → apply_diar_labels 의 "매칭
    // 없음 → 원본 라벨 유지" fallback 으로 자연히 떨어진다. 임의의 0 같은 sentinel
    // ID 를 넣으면 잘못된 화자에 합쳐지는 위험.
    let mut results: Vec<DiarSegment> = Vec::new();
    for seg_res in segments_iter {
        let seg = match seg_res {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[diarize] segment skip: {:?}", e);
                continue;
            }
        };
        let embedding = match extractor.compute(&seg.samples) {
            Ok(e) => e,
            Err(e) => {
                eprintln!("[diarize] embedding fail @ {:.1}s: {:?}", seg.start, e);
                continue;
            }
        };
        let v: Vec<f32> = embedding.collect();
        let speaker_id_opt = if manager.get_all_speakers().len() == max_spk {
            manager.get_best_speaker_match(v).ok()
        } else {
            manager.search_speaker(v, SPEAKER_THRESHOLD)
        };
        let Some(speaker_id) = speaker_id_opt else {
            // max 도달 + threshold 못 넘는 신규 화자 — skip (원본 라벨 유지)
            continue;
        };
        results.push(DiarSegment {
            start_sec: seg.start as f64,
            end_sec: seg.end as f64,
            speaker_id,
        });
    }

    Ok(results)
}

/// PCM segments 가 비어있는 케이스 등 — 안전한 기본값.
#[allow(dead_code)]
pub fn empty() -> Vec<DiarSegment> {
    Vec::new()
}
