//! Tauri command 모음 — frontend 에서 invoke() 로 호출.
//!
//! 각 명령은 비동기로 파이프라인 실행 + ProgressEmitter 로 진행상황 stream.

use super::audio_pipeline::{self, AudioJobOptions, AudioJobResult};
use super::error::ConverterError;
use super::notes_pipeline::{self, NotesJobOptions, NotesJobResult};
use super::ocr_pipeline::{self, OcrJobOptions, OcrJobResult};
use super::progress::ProgressEmitter;
use serde::Serialize;
use tauri::AppHandle;

#[derive(Debug, Serialize)]
pub struct JobError {
    pub message: String,
    #[serde(rename = "jobId")]
    pub job_id: String,
}

/// Frontend 가 jobId 전달하면 그걸 사용 — listener 필터링으로 다른 윈도우의 동시
/// 진행 event 와 분리. 없으면 자체 생성 (backward compat).
fn new_emitter(app: AppHandle, requested: Option<String>) -> ProgressEmitter {
    let id = requested
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| format!("job-{}", uuid::Uuid::new_v4().simple()));
    ProgressEmitter::new(app, id)
}

fn err_to_string(e: ConverterError) -> String {
    e.to_string()
}

#[tauri::command]
pub async fn run_audio_job(
    app: AppHandle,
    options: AudioJobOptions,
    job_id: Option<String>,
) -> Result<AudioJobResult, String> {
    let emitter = new_emitter(app.clone(), job_id);
    audio_pipeline::run(&emitter, options, &app)
        .await
        .map_err(err_to_string)
}

#[tauri::command]
pub async fn run_ocr_job(
    app: AppHandle,
    options: OcrJobOptions,
    job_id: Option<String>,
) -> Result<OcrJobResult, String> {
    let emitter = new_emitter(app, job_id);
    ocr_pipeline::run(&emitter, options)
        .await
        .map_err(err_to_string)
}

#[tauri::command]
pub async fn run_notes_job(
    app: AppHandle,
    options: NotesJobOptions,
    job_id: Option<String>,
) -> Result<NotesJobResult, String> {
    let emitter = new_emitter(app.clone(), job_id);
    notes_pipeline::run(&emitter, options, &app)
        .await
        .map_err(err_to_string)
}

/// 인라인 OCR — 결과 markdown 문자열만 반환 (.md 저장 안 함).
/// 에디터에 이미지 드래그 시 사용.
#[tauri::command]
pub async fn run_ocr_inline(
    app: AppHandle,
    image_path: String,
    job_id: Option<String>,
) -> Result<String, String> {
    let emitter = new_emitter(app, job_id);
    ocr_pipeline::run_inline(&emitter, &image_path)
        .await
        .map_err(err_to_string)
}

/// 변환 결과 .md 파일의 기본 저장 디렉토리 반환 (오늘 날짜)
#[tauri::command]
pub fn get_conversions_dir() -> String {
    super::conversions_dir().to_string_lossy().into_owned()
}

// ─── 화자 라벨 후처리 (STT 결과 정리용) ─────────────────────────

/// Speaker-line patterns we accept, in priority order. LLM output isn't
/// 100% consistent — same prompt can return any of:
///   1. `**[00:00:12] 화자A:**`        ← canonical bold envelope
///   2. `**화자A:**`                   ← clean version (no timestamp)
///   3. `[00:00:12] **화자A**:`        ← bold around label only
///   4. `[00:00:12] 화자A:`            ← no bold at all
///   5. `**화자A**:`                   ← bold around label, no timestamp
///
/// `extract_last_speaker_lines` already runs a strict+loose fallback for the
/// chunk-context use case. The extractor/renamer used to support only #1+#2
/// which silently dropped any document the model returned in formats #3-#5.
/// Symptom: "감지된 화자 라벨이 없습니다" on outputs that did contain
/// speakers.
///
/// To control false positives in the no-bold paths we anchor each pattern at
/// line start AND require either a timestamp prefix or a bold marker — so
/// arbitrary "참고: ..." / "Title: ..." mid-document doesn't get misread
/// as a speaker.
fn speaker_line_patterns() -> Result<Vec<regex::Regex>, regex::Error> {
    Ok(vec![
        // 1: **[time] LABEL:**   /   **LABEL:**          (full bold envelope)
        regex::Regex::new(
            r"(?m)^\*\*(?:\[\d{1,2}:\d{2}(?::\d{2})?\]\s+)?([^\*\n:]{1,40}?):\*\*",
        )?,
        // 2: [time] **LABEL**:   (timestamp + label-only bold, colon outside)
        regex::Regex::new(
            r"(?m)^\[\d{1,2}:\d{2}(?::\d{2})?\]\s+\*\*([^\*\n:]{1,40}?)\*\*\s*:\s",
        )?,
        // 3: [time] LABEL:       (timestamp anchored, no bold)
        regex::Regex::new(
            r"(?m)^\[\d{1,2}:\d{2}(?::\d{2})?\]\s+([^\*\n:]{1,40}?):\s+\S",
        )?,
        // 4: **LABEL**:          (bold around label, no timestamp — clean variant)
        regex::Regex::new(
            r"(?m)^\*\*([^\*\n:]{1,40}?)\*\*\s*:\s",
        )?,
    ])
}

/// 마크다운 본문에서 화자 라벨 추출.
/// 4단계 fallback 패턴(see [[speaker_line_patterns]]) 으로 LLM 출력 변형을
/// 모두 흡수. 발견된 모든 고유 라벨을 등장 순서대로 반환.
#[tauri::command]
pub fn extract_speakers(paths: Vec<String>) -> Result<Vec<String>, String> {
    use std::collections::BTreeSet;
    let patterns = speaker_line_patterns().map_err(|e| e.to_string())?;

    let mut order: Vec<String> = Vec::new();
    let mut seen: BTreeSet<String> = BTreeSet::new();
    for path in &paths {
        let Ok(content) = std::fs::read_to_string(path) else {
            continue;
        };
        for re in &patterns {
            for cap in re.captures_iter(&content) {
                if let Some(m) = cap.get(1) {
                    let label = m.as_str().trim().to_string();
                    if label.is_empty() {
                        continue;
                    }
                    if seen.insert(label.clone()) {
                        order.push(label);
                    }
                }
            }
        }
    }
    Ok(order)
}

/// 여러 STT 결과 .md 파일을 순서대로 합쳐 새 .md 1개 생성.
/// frontend 가 multi-file STT 후 호출 — 각 파일의 frontmatter 1번만 유지,
/// 본문은 `## 파일N — 이름.m4a` 헤더로 구분해 이어붙임.
#[tauri::command]
pub fn merge_md_files(
    paths: Vec<String>,
    labels: Vec<String>,
    output_dir: String,
    output_basename: String,
) -> Result<String, String> {
    if paths.is_empty() {
        return Err("합칠 파일이 없습니다.".into());
    }
    let dir = std::path::PathBuf::from(&output_dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let mut combined = String::new();
    let mut frontmatter_emitted = false;
    for (idx, p) in paths.iter().enumerate() {
        let content = std::fs::read_to_string(p).map_err(|e| e.to_string())?;
        let (front, body) = split_frontmatter(&content);
        if !frontmatter_emitted {
            if let Some(f) = front {
                combined.push_str(&f);
                if !combined.ends_with('\n') {
                    combined.push('\n');
                }
                combined.push('\n');
            }
            frontmatter_emitted = true;
        }
        let label = labels.get(idx).cloned().unwrap_or_else(|| format!("파일 {}", idx + 1));
        combined.push_str(&format!("## 파일 {} — {}\n\n", idx + 1, label));
        combined.push_str(body.trim());
        combined.push_str("\n\n");
    }

    let safe_base = output_basename
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '_' || c == '-' || c == ' ' { c } else { '_' })
        .collect::<String>();
    let target = dir.join(format!("{}.md", safe_base.trim()));
    // 충돌 시 (2), (3) ...
    let final_path = if !target.exists() {
        target
    } else {
        let mut i = 2;
        loop {
            let candidate = dir.join(format!("{} ({}).md", safe_base.trim(), i));
            if !candidate.exists() {
                break candidate;
            }
            i += 1;
            if i > 999 {
                break target.clone();
            }
        }
    };
    std::fs::write(&final_path, combined).map_err(|e| e.to_string())?;
    Ok(final_path.to_string_lossy().into_owned())
}

fn split_frontmatter(md: &str) -> (Option<String>, String) {
    if !md.starts_with("---") {
        return (None, md.to_string());
    }
    let after = &md[3..];
    let Some(end) = after.find("\n---") else {
        return (None, md.to_string());
    };
    let front = &md[..3 + end + 4]; // ---{front}---
    let rest = &md[3 + end + 4..];
    let rest = rest.strip_prefix('\n').unwrap_or(rest);
    (Some(front.to_string()), rest.to_string())
}

/// 화자 라벨 일괄 치환. mappings: (from, to). `to` 가 빈 문자열이면 그 화자의
/// 모든 발화 라인 통째로 제거 (라벨 prefix 부터 다음 발화 직전까지).
#[tauri::command]
pub fn rename_speakers(
    paths: Vec<String>,
    mappings: Vec<(String, String)>,
) -> Result<(), String> {
    use std::collections::HashMap;
    // 빈 매핑 / 동일 매핑 정리
    let mut rename: HashMap<String, String> = HashMap::new();
    let mut delete: Vec<String> = Vec::new();
    for (from, to) in mappings {
        let f = from.trim().to_string();
        let t = to.trim().to_string();
        if f.is_empty() || f == t {
            continue;
        }
        if t.is_empty() {
            delete.push(f);
        } else {
            rename.insert(f, t);
        }
    }
    if rename.is_empty() && delete.is_empty() {
        return Ok(());
    }

    // Each tier captures prefix / label / suffix / rest separately so the
    // rebuilt header keeps its original markup. Order matches
    // [[speaker_line_patterns]] — strictest first.
    let header_patterns = [
        // 1: **[time] LABEL:**   or  **LABEL:**
        regex::Regex::new(
            r"^(?P<prefix>\*\*(?:\[\d{1,2}:\d{2}(?::\d{2})?\]\s+)?)(?P<label>[^\*\n:]{1,40}?)(?P<suffix>:\*\*)\s*(?P<rest>.*)$",
        )
        .map_err(|e| e.to_string())?,
        // 2: [time] **LABEL**:
        regex::Regex::new(
            r"^(?P<prefix>\[\d{1,2}:\d{2}(?::\d{2})?\]\s+\*\*)(?P<label>[^\*\n:]{1,40}?)(?P<suffix>\*\*\s*:)\s+(?P<rest>\S.*)$",
        )
        .map_err(|e| e.to_string())?,
        // 3: [time] LABEL:
        regex::Regex::new(
            r"^(?P<prefix>\[\d{1,2}:\d{2}(?::\d{2})?\]\s+)(?P<label>[^\*\n:]{1,40}?)(?P<suffix>:)\s+(?P<rest>\S.*)$",
        )
        .map_err(|e| e.to_string())?,
        // 4: **LABEL**:
        regex::Regex::new(
            r"^(?P<prefix>\*\*)(?P<label>[^\*\n:]{1,40}?)(?P<suffix>\*\*\s*:)\s*(?P<rest>.*)$",
        )
        .map_err(|e| e.to_string())?,
    ];

    // any_header_matches checks if a line begins with ANY of the four tiers.
    // Defined inline (no closure) to avoid the lifetime gymnastics that come
    // from trying to return a `regex::Captures<'_>` from a closure — the
    // captures borrow from the input string, and proving that to the
    // checker for a Fn(&str) -> Option<Captures<'?>> is more verbose than
    // just inlining the loop at the call site.
    let any_header_matches = |s: &str| -> bool {
        header_patterns.iter().any(|p| p.is_match(s))
    };

    for path in &paths {
        let original = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
        let mut out = String::with_capacity(original.len());

        let lines: Vec<&str> = original.split_inclusive('\n').collect();
        let mut i = 0;
        while i < lines.len() {
            let line = lines[i];
            let trimmed_line = line.trim_end_matches('\n');

            // Walk tiers in priority order; first match wins. We re-do this
            // small loop per line rather than via a closure (see comment on
            // any_header_matches) because each `captures()` borrow lives
            // only as long as `trimmed_line`.
            let mut matched_label: Option<String> = None;
            let mut matched_prefix = "";
            let mut matched_suffix = "";
            let mut matched_rest = "";
            for p in &header_patterns {
                if let Some(caps) = p.captures(trimmed_line) {
                    matched_label = caps
                        .name("label")
                        .map(|m| m.as_str().trim().to_string());
                    matched_prefix = caps.name("prefix").map(|m| m.as_str()).unwrap_or("");
                    matched_suffix = caps.name("suffix").map(|m| m.as_str()).unwrap_or("");
                    matched_rest = caps.name("rest").map(|m| m.as_str()).unwrap_or("");
                    break;
                }
            }

            if let Some(label) = matched_label {
                if delete.iter().any(|d| d == &label) {
                    // 이 화자 발화 통째로 제거 — 다음 화자 헤더 만날 때까지 skip
                    i += 1;
                    while i < lines.len() {
                        let next = lines[i].trim_end_matches('\n');
                        if any_header_matches(next) {
                            break;
                        }
                        i += 1;
                    }
                    continue;
                }
                if let Some(new_label) = rename.get(&label) {
                    out.push_str(matched_prefix);
                    out.push_str(new_label);
                    out.push_str(matched_suffix);
                    if !matched_rest.is_empty() {
                        out.push(' ');
                        out.push_str(matched_rest);
                    }
                    if line.ends_with('\n') {
                        out.push('\n');
                    }
                    i += 1;
                    continue;
                }
            }

            out.push_str(line);
            i += 1;
        }

        std::fs::write(path, &out).map_err(|e| e.to_string())?;
    }
    Ok(())
}
