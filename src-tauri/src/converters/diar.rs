//! 화자분리 공용 타입 + 헬퍼. 로컬(diarize_local) / 클라우드(diarize_cloud) 양쪽이 공유.
//! 자작 pyannote-rs 구현(구 diarize.rs)은 폐기됨 — 검증된 pyannote(로컬 Python / 클라우드)로 대체.

/// 한 발화 구간의 화자. speaker_id 는 1-indexed (apply_diar_labels 가 "화자{id}" 로 포맷).
#[derive(Debug, Clone)]
pub struct DiarSegment {
    pub start_sec: f64,
    pub end_sec: f64,
    pub speaker_id: usize,
}

/// (start, end, speaker_label) 목록 → DiarSegment. speaker 문자열("SPEAKER_00" 등)을
/// 첫 등장 순서로 1-indexed usize 에 매핑.
pub fn labels_to_segments(turns: Vec<(f64, f64, String)>) -> Vec<DiarSegment> {
    use std::collections::HashMap;
    let mut ids: HashMap<String, usize> = HashMap::new();
    let mut next: usize = 1;
    turns
        .into_iter()
        .map(|(start, end, label)| {
            let id = *ids.entry(label).or_insert_with(|| {
                let cur = next;
                next += 1;
                cur
            });
            DiarSegment {
                start_sec: start,
                end_sec: end,
                speaker_id: id,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_labels_to_segments_first_appearance_order() {
        let turns = vec![
            (0.0, 1.0, "SPEAKER_02".to_string()),
            (1.0, 2.0, "SPEAKER_00".to_string()),
            (2.0, 3.0, "SPEAKER_02".to_string()),
        ];
        let segs = labels_to_segments(turns);
        assert_eq!(segs[0].speaker_id, 1); // SPEAKER_02 → 1
        assert_eq!(segs[1].speaker_id, 2); // SPEAKER_00 → 2
        assert_eq!(segs[2].speaker_id, 1);
    }
}
