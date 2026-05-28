//! 화자 라벨 후처리 dedup —
//!
//! 단일 LLM이 회의 녹취 + 화자 분리 + 정리를 한 번에 처리하면 같은 사람을
//! 청크 경계에서 다른 라벨(화자A → 화자C 식)로 부여하는 케이스가 흔하다.
//! 이 모듈은 전사 끝난 뒤 라이트한 LLM 호출 한 번으로:
//!
//!   1. 텍스트에서 발견된 모든 화자 라벨 + 각 라벨의 첫 몇 문장 수집
//!   2. "같은 사람으로 보이는 라벨 그룹을 알려달라" 고 LLM 에 물어보기
//!   3. 응답한 alias → primary 매핑을 원본 텍스트에 적용
//!
//! 정확도가 높은 추가 GPU 모델을 도입하지 않고도 명시적 cross-chunk
//! 일관성 보정이 가능하다. 비용: 모델 한 번 호출 (~수십 토큰 입력 +
//! 짧은 JSON 출력) — 전사 비용의 1% 미만.
//!
//! 한계: LLM 판단도 완벽하지 않으므로 응답이 confident 한 그룹만 묶도록
//! 프롬프트에서 false-positive 우선 회피를 명시한다.

use crate::converters::error::ConverterResult;
use crate::converters::llm::gemini;
use crate::converters::progress::ProgressEmitter;
use crate::converters::UsageInfo;
use regex::Regex;
use serde::Deserialize;
use std::collections::HashMap;

/// 파일/문자열에 STT timestamp 가 한 번이라도 나오는지. STT 결과면 항상 true,
/// 메타 / 손편집 마크다운은 false. (commands.rs::has_any_timestamp 와 동일.)
fn has_any_timestamp(text: &str) -> bool {
    static TS_RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let re = TS_RE.get_or_init(|| {
        Regex::new(r"\[\d{1,2}:\d{2}(?::\d{2})?\]").expect("regex compile")
    });
    re.is_match(text)
}

/// 후처리 dedup 에서 호출할 모델. 정확한 판단보다 latency / cost 우선이라
/// `gemini-3.1-flash-lite` 사용 (이미 audio MODEL_AUDIO 와 동일).
const DEDUP_MODEL: &str = "gemini-3.1-flash-lite";

/// 라벨당 LLM 에 보내는 발화 샘플 수. 너무 적으면 판단 근거 부족,
/// 너무 많으면 컨텍스트만 잡아먹음.
const SAMPLES_PER_SPEAKER: usize = 4;

/// 한 발화 샘플당 최대 글자수 — 긴 발화는 앞부분만.
const MAX_SAMPLE_CHARS: usize = 140;

const SYSTEM_PROMPT: &str =
    "당신은 회의 녹취록의 화자 라벨을 검토해서 같은 사람으로 보이는 라벨을 통합해주는 보조원입니다.";

const USER_PROMPT_TEMPLATE: &str = r#"다음은 자동 STT 가 분리한 화자별 발화 샘플입니다.

같은 사람이 다른 라벨로 잘못 분리됐을 가능성이 있는 그룹을 찾아주세요.

화자 샘플:
{samples}

판단 기준:
- 자기소개 ("저는 ~", "제가 ~") 같은 라벨에 다른 사람 이름이 있다 → 절대 묶지 않음
- 다른 라벨에서 같은 발화자가 일관되게 자기를 지칭하는 어휘 / 직책 / 말투 사용
- 발화 1-2개뿐인 라벨이 흐름상 다른 화자의 자연스러운 연속으로 보임 (chunk 경계 분리 오류)

확신이 없으면 묶지 마세요. 같은 사람을 다른 라벨로 두는 false negative 가, 다른 사람을 같이 묶어버리는 false positive 보다 낫습니다.

JSON 형식으로만 응답하세요. 묶을 그룹이 없으면 빈 배열:

{
  "groups": [
    {"primary": "<유지할 라벨>", "aliases": ["<통합할 라벨>", ...]}
  ]
}
"#;

#[derive(Debug, Deserialize)]
struct DedupResponse {
    groups: Vec<DedupGroup>,
}

#[derive(Debug, Deserialize)]
struct DedupGroup {
    primary: String,
    aliases: Vec<String>,
}

pub struct DedupOutcome {
    pub text: String,
    pub usage: Option<UsageInfo>,
    /// alias → primary 통합된 라벨 수
    pub merged_count: usize,
}

/// 전사 텍스트에 dedup 후처리 적용.
///
/// - 화자 ≤ 2명이면 분리 오류 가능성 낮으므로 LLM 호출 없이 그대로 반환
/// - LLM 응답 파싱 실패 / 빈 그룹이면 원본 그대로 (안전 fallback)
/// - 응답에 명시된 alias 가 실제 화자 목록에 없으면 무시 (환각 방지)
pub async fn dedup_speakers(
    transcript: &str,
    api_key: &str,
    emitter: &ProgressEmitter,
) -> ConverterResult<DedupOutcome> {
    // Structural sanity gate — STT output always carries [HH:MM:SS]
    // markers. If somehow this path is invoked on a metadata-only doc
    // (notes / hand-edited), the LLM dedup prompt would receive header
    // labels (`**일시:**`, `**참석자:**`) as speaker candidates and could
    // collapse them into one another. Bail before any LLM call.
    if !has_any_timestamp(transcript) {
        return Ok(DedupOutcome {
            text: transcript.to_string(),
            usage: None,
            merged_count: 0,
        });
    }
    let samples = extract_speaker_samples(transcript);
    if samples.len() < 3 {
        return Ok(DedupOutcome {
            text: transcript.to_string(),
            usage: None,
            merged_count: 0,
        });
    }

    emitter.emit(
        "🔍 화자 라벨 검토 중...",
        Some(format!("{}명 분석", samples.len())),
    );

    let samples_text = render_samples(&samples);
    let user_prompt = USER_PROMPT_TEMPLATE.replace("{samples}", &samples_text);
    let full_prompt = format!("{}\n\n{}", SYSTEM_PROMPT, user_prompt);

    let result = gemini::generate_text(
        api_key,
        DEDUP_MODEL,
        &full_prompt,
        vec![],
        Some(gemini::GenerationConfig {
            max_output_tokens: Some(512),
            temperature: Some(0.2),
        }),
    )
    .await?;

    // Gemini 가 JSON 외에 설명이나 코드펜스를 붙이는 경우 대비
    let raw = result.text.trim();
    let json_slice = extract_json_block(raw).unwrap_or(raw);

    let parsed: DedupResponse = match serde_json::from_str(json_slice) {
        Ok(p) => p,
        Err(e) => {
            emitter.emit(
                "⚠️ 화자 라벨 검토 결과 파싱 실패 — 원본 유지",
                Some(e.to_string()),
            );
            return Ok(DedupOutcome {
                text: transcript.to_string(),
                usage: Some(result.usage),
                merged_count: 0,
            });
        }
    };

    let known_labels: std::collections::HashSet<&str> =
        samples.iter().map(|s| s.label.as_str()).collect();

    let mut rename: HashMap<String, String> = HashMap::new();
    for g in parsed.groups {
        let primary = g.primary.trim().to_string();
        if primary.is_empty() || !known_labels.contains(primary.as_str()) {
            continue;
        }
        for a in g.aliases {
            let alias = a.trim().to_string();
            if alias.is_empty() || alias == primary {
                continue;
            }
            // LLM hallucinated label — skip
            if !known_labels.contains(alias.as_str()) {
                continue;
            }
            rename.insert(alias, primary.clone());
        }
    }

    if rename.is_empty() {
        emitter.emit("✅ 화자 라벨 검토 완료 — 통합 대상 없음", None);
        return Ok(DedupOutcome {
            text: transcript.to_string(),
            usage: Some(result.usage),
            merged_count: 0,
        });
    }

    let summary = rename
        .iter()
        .map(|(a, p)| format!("{} → {}", a, p))
        .collect::<Vec<_>>()
        .join(", ");
    emitter.emit(
        format!("🧹 화자 라벨 통합 — {}건", rename.len()),
        Some(summary),
    );

    let new_text = apply_rename(transcript, &rename);
    Ok(DedupOutcome {
        text: new_text,
        usage: Some(result.usage),
        merged_count: rename.len(),
    })
}

struct SpeakerSample {
    label: String,
    utterances: Vec<String>,
}

/// 텍스트에서 (label, body) 쌍을 등장 순서대로 모음. 각 라벨당 첫 N개만 보관.
///
/// commands.rs::speaker_line_patterns 와 동일 4-tier fallback — 본문 시작에서
/// 라벨을 떼낸 뒤 그 라인의 나머지 + 다음 헤더까지의 내용을 발화로 본다.
fn extract_speaker_samples(text: &str) -> Vec<SpeakerSample> {
    // Same 3-tier set as commands.rs::speaker_line_patterns. The
    // `**LABEL**:` (no timestamp) shape is omitted on purpose — it would
    // match meeting-note metadata lines (`**일시**: ...` etc.) and feed
    // them to dedup as speaker candidates, which then poisons the LLM
    // prompt and could cause real labels to be merged with metadata
    // labels.
    let header_patterns = [
        Regex::new(
            r"^(?P<prefix>\*\*(?:\[\d{1,2}:\d{2}(?::\d{2})?\]\s+)?)(?P<label>[^\*\n:]{1,40}?):\*\*\s*(?P<rest>.*)$",
        )
        .expect("regex compile"),
        Regex::new(
            r"^(?P<prefix>\[\d{1,2}:\d{2}(?::\d{2})?\]\s+\*\*)(?P<label>[^\*\n:]{1,40}?)\*\*\s*:\s+(?P<rest>\S.*)$",
        )
        .expect("regex compile"),
        Regex::new(
            r"^(?P<prefix>\[\d{1,2}:\d{2}(?::\d{2})?\]\s+)(?P<label>[^\*\n:]{1,40}?):\s+(?P<rest>\S.*)$",
        )
        .expect("regex compile"),
    ];

    let mut by_label: HashMap<String, Vec<String>> = HashMap::new();
    let mut order: Vec<String> = Vec::new();

    let mut current_label: Option<String> = None;
    let mut current_buf: String = String::new();

    for line in text.lines() {
        let mut matched_label: Option<String> = None;
        let mut matched_rest: &str = "";
        for p in &header_patterns {
            if let Some(caps) = p.captures(line) {
                matched_label = caps
                    .name("label")
                    .map(|m| m.as_str().trim().to_string());
                matched_rest = caps.name("rest").map(|m| m.as_str()).unwrap_or("");
                break;
            }
        }

        if let Some(label) = matched_label {
            // flush previous
            if let Some(prev) = current_label.take() {
                push_utterance(&mut by_label, &mut order, &prev, &current_buf);
                current_buf.clear();
            }
            current_label = Some(label);
            current_buf.push_str(matched_rest);
        } else if current_label.is_some() {
            if !line.trim().is_empty() {
                if !current_buf.is_empty() {
                    current_buf.push(' ');
                }
                current_buf.push_str(line.trim());
            }
        }
    }
    if let Some(prev) = current_label.take() {
        push_utterance(&mut by_label, &mut order, &prev, &current_buf);
    }

    order
        .into_iter()
        .map(|label| {
            let utterances = by_label.remove(&label).unwrap_or_default();
            SpeakerSample { label, utterances }
        })
        .collect()
}

fn push_utterance(
    by_label: &mut HashMap<String, Vec<String>>,
    order: &mut Vec<String>,
    label: &str,
    body: &str,
) {
    let entry = by_label.entry(label.to_string()).or_insert_with(|| {
        order.push(label.to_string());
        Vec::new()
    });
    if entry.len() >= SAMPLES_PER_SPEAKER {
        return;
    }
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return;
    }
    let snippet: String = trimmed.chars().take(MAX_SAMPLE_CHARS).collect();
    entry.push(snippet);
}

fn render_samples(samples: &[SpeakerSample]) -> String {
    samples
        .iter()
        .map(|s| {
            let utterances = s
                .utterances
                .iter()
                .enumerate()
                .map(|(i, u)| format!("  {}. {}", i + 1, u))
                .collect::<Vec<_>>()
                .join("\n");
            format!("[{}]\n{}", s.label, utterances)
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// LLM 이 ```json ... ``` 또는 그 외 설명 텍스트로 응답한 경우 JSON 블록만 추출.
fn extract_json_block(raw: &str) -> Option<&str> {
    // ``` fenced block
    if let Some(start) = raw.find("```") {
        let after = &raw[start + 3..];
        // optional `json` language tag
        let body_start = after.find('\n').map(|i| i + 1).unwrap_or(0);
        let body = &after[body_start..];
        if let Some(end) = body.find("```") {
            return Some(body[..end].trim());
        }
    }
    // bare JSON object — find first { and last }
    let first = raw.find('{')?;
    let last = raw.rfind('}')?;
    if last > first {
        Some(&raw[first..=last])
    } else {
        None
    }
}

/// rename 맵 적용 — commands.rs::rename_speakers 와 같은 3-tier 패턴.
/// (Tier 4 `**LABEL**:` 는 메타 라인 false-positive 위험으로 제외 — 본 모듈
/// 에서는 추출 단계에서 이미 걸러져 실제로는 도달할 일이 없지만, 안전
/// 차원에서도 같은 set 유지.)
fn apply_rename(text: &str, rename: &HashMap<String, String>) -> String {
    let header_patterns = [
        Regex::new(
            r"^(?P<prefix>\*\*(?:\[\d{1,2}:\d{2}(?::\d{2})?\]\s+)?)(?P<label>[^\*\n:]{1,40}?)(?P<suffix>:\*\*)\s*(?P<rest>.*)$",
        )
        .expect("regex compile"),
        Regex::new(
            r"^(?P<prefix>\[\d{1,2}:\d{2}(?::\d{2})?\]\s+\*\*)(?P<label>[^\*\n:]{1,40}?)(?P<suffix>\*\*\s*:)\s+(?P<rest>\S.*)$",
        )
        .expect("regex compile"),
        Regex::new(
            r"^(?P<prefix>\[\d{1,2}:\d{2}(?::\d{2})?\]\s+)(?P<label>[^\*\n:]{1,40}?)(?P<suffix>:)\s+(?P<rest>\S.*)$",
        )
        .expect("regex compile"),
    ];

    let mut out = String::with_capacity(text.len());
    for line in text.split_inclusive('\n') {
        let trimmed = line.trim_end_matches('\n');
        let mut replaced: Option<String> = None;
        for p in &header_patterns {
            if let Some(caps) = p.captures(trimmed) {
                let label = caps
                    .name("label")
                    .map(|m| m.as_str().trim().to_string())
                    .unwrap_or_default();
                if let Some(new_label) = rename.get(&label) {
                    let prefix = caps.name("prefix").map(|m| m.as_str()).unwrap_or("");
                    let suffix = caps.name("suffix").map(|m| m.as_str()).unwrap_or("");
                    let rest = caps.name("rest").map(|m| m.as_str()).unwrap_or("");
                    let mut rebuilt = String::new();
                    rebuilt.push_str(prefix);
                    rebuilt.push_str(new_label);
                    rebuilt.push_str(suffix);
                    if !rest.is_empty() {
                        rebuilt.push(' ');
                        rebuilt.push_str(rest);
                    }
                    if line.ends_with('\n') {
                        rebuilt.push('\n');
                    }
                    replaced = Some(rebuilt);
                    break;
                }
                // matched header but not in rename map — just emit as-is
                break;
            }
        }
        out.push_str(&replaced.unwrap_or_else(|| line.to_string()));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_samples_in_order() {
        let text = "**[00:00:01] 화자A:** 안녕하세요\n\n**[00:00:05] 화자B:** 반갑습니다\n\n**[00:00:10] 화자A:** 오늘 회의는…";
        let s = extract_speaker_samples(text);
        assert_eq!(s.len(), 2);
        assert_eq!(s[0].label, "화자A");
        assert_eq!(s[0].utterances.len(), 2);
        assert_eq!(s[1].label, "화자B");
    }

    #[test]
    fn apply_rename_full_bold() {
        let mut r = HashMap::new();
        r.insert("화자C".to_string(), "화자A".to_string());
        let text = "**[00:00:01] 화자C:** 발언\n";
        let out = apply_rename(text, &r);
        assert!(out.contains("화자A:**"));
        assert!(!out.contains("화자C:"));
    }

    #[test]
    fn json_block_handles_fenced() {
        let raw = "```json\n{\"groups\":[]}\n```";
        assert_eq!(extract_json_block(raw), Some("{\"groups\":[]}"));
    }

    #[test]
    fn json_block_handles_bare() {
        let raw = "다음과 같습니다: {\"groups\":[]} 끝.";
        assert_eq!(extract_json_block(raw), Some("{\"groups\":[]}"));
    }

    /// Regression guard for the Codex P2 false-positive: meeting-note
    /// metadata lines (`**일시**: ...`, `**참석자**: ...`) must not be
    /// picked up as speaker labels — they don't carry a timestamp and
    /// would otherwise be eligible for delete/rename in the editor.
    #[test]
    fn skips_meeting_metadata_lines() {
        let text = "**일시**: 2026년 5월 28일\n**장소**: 카페\n**참석자**: 승우, 재문\n\n**[00:00:05] 화자A:** 안녕하세요\n**[00:00:10] 화자B:** 반갑습니다";
        let s = extract_speaker_samples(text);
        let labels: Vec<&str> = s.iter().map(|s| s.label.as_str()).collect();
        assert_eq!(labels, vec!["화자A", "화자B"]);
        assert!(!labels.iter().any(|l| *l == "일시" || *l == "참석자" || *l == "장소"));
    }

    /// Codex follow-up P2 — Tier 1 `**LABEL:**` (colon INSIDE bold) is the
    /// exact shape of common meeting-notes metadata (`**일시:**`,
    /// `**참석자:**`). The user's screenshot had this verbatim. Tier 1
    /// can't be dropped without losing canonical STT recall, so we gate
    /// at the document level: if a doc has zero timestamps it's not an
    /// STT transcript, skip dedup entirely.
    #[test]
    fn timestamp_gate_blocks_metadata_only_doc() {
        // No timestamps → has_any_timestamp returns false → caller path
        // should bail before extract_speaker_samples ever runs. Test the
        // gate directly to keep the contract explicit.
        let metadata_only = "**일시:** 2026년 5월 28일 (목)\n**장소:** 카페\n**참석자:** 승우, 재문\n**결정사항:** 다음 주 확정";
        assert!(!has_any_timestamp(metadata_only));

        let stt_like = "**[00:00:05] 화자A:** 안녕하세요";
        assert!(has_any_timestamp(stt_like));

        // Even if extract_speaker_samples is called on the metadata doc
        // (defense-in-depth — caller's gate already short-circuits),
        // Tier 1 will still match "일시"/"참석자". That's fine because
        // the caller path bails before reaching here.
    }
}
