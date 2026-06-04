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
use ndarray::{ArrayBase, Axis, IxDyn, ViewRepr};
use ort::session::{builder::GraphOptimizationLevel, Session};
use ort::value::TensorRef;
use pyannote_rs::{EmbeddingExtractor, EmbeddingManager};
use std::cmp::Ordering;
use std::path::{Path, PathBuf};
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

    // pyannote-rs 0.3.4 의 get_segments 는 std::iter::from_fn 안에서 window 하나를 처리한
    // 뒤 segments_queue 가 비면 None 을 반환 → iterator 가 즉시 조기 종료된다. 회의 녹음처럼
    // 첫 10초 window 내내 발화가 silence 로 끊기지 않으면 segment 가 하나도 push 되지 않아
    // 결과가 0개가 된다(= "화자 0명 식별" 버그). segment_audio 는 동일 로직을 쓰되 빈
    // window 는 건너뛰고 모든 window 소진 시에만 종료하도록 고친 자체 구현이다.
    let seg_iter = segment_audio(pcm_i16, sample_rate, &seg_model)?;

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
    // segment 를 하나씩 받아 즉시 embedding → seg 는 루프 끝에서 drop. 모든 LocalSegment
    // (각자 PCM 복사본 보유)를 한꺼번에 들고 있지 않아 대용량 입력의 메모리 누적/OOM 방지.
    for seg_res in seg_iter {
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
            start_sec: seg.start,
            end_sec: seg.end,
            speaker_id,
        });
    }

    Ok(results)
}

/// segmentation 모델이 찾은 한 발화 구간 (pyannote-rs `Segment` 의 자체 포팅 동치).
struct LocalSegment {
    start: f64,
    end: f64,
    samples: Vec<i16>,
}

/// sub_row 에서 argmax index. pyannote-rs segment.rs:find_max_index 1:1.
fn find_max_index(row: ArrayBase<ViewRepr<&f32>, IxDyn>) -> ConverterResult<usize> {
    let (max_index, _) = row
        .iter()
        .enumerate()
        .max_by(|a, b| a.1.partial_cmp(b.1).unwrap_or(Ordering::Equal))
        .ok_or_else(|| ConverterError::Internal("sub_row 가 비어있음".into()))?;
    Ok(max_index)
}

/// segmentation-3.0.onnx 로 발화 구간을 **하나씩 yield** 하는 iterator — pyannote-rs
/// 0.3.4 `get_segments` 의 fixed 포팅.
///
/// 원본은 `std::iter::from_fn` 안에서 매 `next()` 마다 window 하나를 처리하고
/// `segments_queue.pop_front()` 이 비면 `None` 을 반환했다. `from_fn` 은 `None` 에서
/// iterator 를 종료하므로, segment 가 안 나온 window 를 만나는 즉시 전체가 끝나버린다
/// (긴 발화 → 빈 결과 → "화자 0명" 버그). 여기서는 `loop` 로 감싸 빈 window 는 건너뛰고
/// 모든 window 를 소진했을 때만 종료한다.
///
/// Vec 로 전부 모으지 않고 iterator 로 흘려보내는 이유: 각 LocalSegment 는 자기 구간의
/// PCM 복사본(`samples`)을 들고 있어, 4시간 16kHz 같은 대용량 입력에서 전체를 retain 하면
/// 수백 MB 가 중복 누적돼 OOM 위험. 호출측이 segment 를 받아 embedding 후 즉시 drop 하면
/// 동시에 살아있는 복사본은 한 개뿐이다.
fn segment_audio(
    samples: &[i16],
    sample_rate: u32,
    model_path: &Path,
) -> ConverterResult<impl Iterator<Item = ConverterResult<LocalSegment>>> {
    let mut session = Session::builder()
        .map_err(|e| ConverterError::Internal(format!("seg session builder: {:?}", e)))?
        .with_optimization_level(GraphOptimizationLevel::Level3)
        .map_err(|e| ConverterError::Internal(format!("seg optimization: {:?}", e)))?
        .with_intra_threads(1)
        .map_err(|e| ConverterError::Internal(format!("seg intra_threads: {:?}", e)))?
        .with_inter_threads(1)
        .map_err(|e| ConverterError::Internal(format!("seg inter_threads: {:?}", e)))?
        .commit_from_file(model_path)
        .map_err(|e| ConverterError::Internal(format!("seg commit_from_file: {:?}", e)))?;

    // pyannote segmentation 프레임 파라미터 (segment.rs 동일).
    let frame_size = 270;
    let frame_start = 721;
    let window_size = (sample_rate * 10) as usize; // 10초

    // 끝에 무음 padding (segment.rs 동일). 입력이 window 의 정확한 배수여도 항상
    // 무음 window 하나를 더 붙인다 (배수면 pad_len == window_size). 마지막 발화가
    // EOF 까지 silence 없이 이어질 때, 이 무음 프레임이 있어야 is_speeching → silence
    // 전환이 일어나 마지막 화자 segment 가 마감/yield 된다. `if rem != 0` 로 생략하면
    // 배수 입력의 끝 발화를 통째로 놓친다.
    let padded_samples = {
        let mut padded = Vec::from(samples);
        let pad_len = window_size - (samples.len() % window_size);
        padded.extend(std::iter::repeat(0i16).take(pad_len));
        padded
    };
    // 원본 길이만 캡처 (인덱스 경계 계산용) — samples 참조는 클로저로 넘기지 않는다.
    let orig_len = samples.len();

    let mut is_speeching = false;
    let mut offset = frame_start;
    let mut start_offset = 0.0_f64;
    let mut start_iter = (0..padded_samples.len()).step_by(window_size);
    let mut queue: std::collections::VecDeque<LocalSegment> = std::collections::VecDeque::new();

    Ok(std::iter::from_fn(move || {
        loop {
            // 이전 window 에서 만든 segment 가 남아있으면 먼저 비운다.
            if let Some(seg) = queue.pop_front() {
                return Some(Ok(seg));
            }
            // 다음 window 처리. 모든 window 를 소진하면 iterator 종료.
            let start = start_iter.next()?;
            let end = (start + window_size).min(padded_samples.len());
            let window = &padded_samples[start..end];

            let array = ndarray::Array1::from_iter(window.iter().map(|&x| x as f32));
            let array = array.view().insert_axis(Axis(0)).insert_axis(Axis(1));

            let input = match TensorRef::from_array_view(array.into_dyn()) {
                Ok(t) => t,
                Err(e) => {
                    return Some(Err(ConverterError::Internal(format!(
                        "seg input tensor: {:?}",
                        e
                    ))))
                }
            };
            let outputs = match session.run(ort::inputs![input]) {
                Ok(o) => o,
                Err(e) => {
                    return Some(Err(ConverterError::Internal(format!(
                        "seg session.run: {:?}",
                        e
                    ))))
                }
            };
            let out = match outputs.get("output") {
                Some(o) => o,
                None => return Some(Err(ConverterError::Internal("seg output tensor 없음".into()))),
            };
            let (shape, data) = match out.try_extract_tensor::<f32>() {
                Ok(t) => t,
                Err(e) => {
                    return Some(Err(ConverterError::Internal(format!(
                        "seg extract tensor: {:?}",
                        e
                    ))))
                }
            };
            let shape_slice: Vec<usize> = (0..shape.len()).map(|i| shape[i] as usize).collect();
            let view = match ndarray::ArrayViewD::<f32>::from_shape(IxDyn(&shape_slice), data) {
                Ok(v) => v,
                Err(e) => {
                    return Some(Err(ConverterError::Internal(format!(
                        "seg view reshape: {:?}",
                        e
                    ))))
                }
            };

            for row in view.outer_iter() {
                for sub_row in row.axis_iter(Axis(0)) {
                    let max_index = match find_max_index(sub_row) {
                        Ok(i) => i,
                        Err(e) => return Some(Err(e)),
                    };
                    if max_index != 0 {
                        if !is_speeching {
                            start_offset = offset as f64;
                            is_speeching = true;
                        }
                    } else if is_speeching {
                        let start_sec = start_offset / sample_rate as f64;
                        let end_sec = offset as f64 / sample_rate as f64;
                        // 인덱스 경계 보호 (segment.rs 동일).
                        let start_idx = start_offset.min((orig_len - 1) as f64) as usize;
                        let end_idx = (offset as f64).min(orig_len as f64) as usize;
                        is_speeching = false;
                        if end_idx > start_idx {
                            queue.push_back(LocalSegment {
                                start: start_sec,
                                end: end_sec,
                                samples: padded_samples[start_idx..end_idx].to_vec(),
                            });
                        }
                    }
                    offset += frame_size;
                }
            }
            // window 처리 끝 → loop 상단에서 queue pop 재시도 (비었으면 다음 window).
        }
    }))
}

/// PCM segments 가 비어있는 케이스 등 — 안전한 기본값.
#[allow(dead_code)]
pub fn empty() -> Vec<DiarSegment> {
    Vec::new()
}
