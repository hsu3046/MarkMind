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

/// 변환 결과 .md 파일의 기본 저장 디렉토리 반환 (오늘 날짜)
#[tauri::command]
pub fn get_conversions_dir() -> String {
    super::conversions_dir().to_string_lossy().into_owned()
}

// ─── PPTX 스마트 레이아웃 (이슈 #6) ─────────────────────────────
//
// 마크다운을 슬라이드용으로 "재구성"해 과밀 슬라이드를 막는다(규칙 기반의 약점
// 보완). 기존 converters 의 키체인 + LLM 클라이언트를 그대로 재사용한다.
// 반환은 프론트가 파싱하는 단순 슬라이드 JSON 문자열:
//   { "slides": [ { "title", "layout":"title|content", "bullets":[...], "notes"? } ] }

// 출력 토큰 상한 — 큰 덱(50장+)도 잘리지 않도록 넉넉히. 생성한 만큼만 과금.
const SLIDES_MAX_TOKENS: u32 = 32000;

const SLIDES_SYSTEM: &str = "You are a presentation designer. Convert the given Markdown document into a concise slide deck. Output STRICT minified JSON only (no prose, no code fences, no markdown) of the form: {\"slides\":[{\"title\":string,\"layout\":\"title\"|\"content\",\"bullets\":string[],\"notes\":string?}]}. Rules: the first slide is layout \"title\" (deck title + optional one-line subtitle as a single bullet); other slides are \"content\"; keep each bullet short (<= ~12 words); at most ~6 bullets per slide; split dense content across multiple slides to avoid overcrowding; omit the \"notes\" field unless it adds real speaker value (keeps output compact); preserve the document's language; do not invent facts.";

#[tauri::command]
pub async fn generate_slides_llm(
    markdown: String,
    provider: super::NotesProvider,
) -> Result<String, String> {
    use super::keychain::{get_key, Provider};
    use super::llm;

    let prompt = format!(
        "Convert this Markdown document into slides as specified.\n\n<markdown>\n{}\n</markdown>",
        markdown
    );

    let text = match provider {
        super::NotesProvider::Claude => {
            let key = get_key(Provider::Claude)
                .map_err(err_to_string)?
                .ok_or_else(|| "CLAUDE_API_KEY 가 없습니다. Settings 에서 등록하세요.".to_string())?;
            // 큰 문서(20장+)의 슬라이드 JSON 이 잘리면 프론트 파싱 실패 → 폴백.
            // 출력 토큰은 생성한 만큼만 과금되므로 상한은 넉넉히(미사용 시 비용 0).
            let opts = llm::anthropic::ClaudeOptions {
                max_output_tokens: Some(SLIDES_MAX_TOKENS),
                system: Some(SLIDES_SYSTEM.to_string()),
            };
            llm::anthropic::generate_text(
                llm::anthropic::ClaudeAuth::ApiKey(&key),
                super::MODEL_NOTES_CLAUDE,
                &prompt,
                Some(opts),
            )
            .await
            .map_err(err_to_string)?
            .text
        }
        super::NotesProvider::Gemini => {
            let key = get_key(Provider::Gemini)
                .map_err(err_to_string)?
                .ok_or_else(|| "GEMINI_API_KEY 가 없습니다. Settings 에서 등록하세요.".to_string())?;
            // Gemini 는 system 파라미터를 따로 안 받으므로 프롬프트 앞에 지시문 결합.
            let full = format!("{}\n\n{}", SLIDES_SYSTEM, prompt);
            let cfg = llm::gemini::GenerationConfig {
                max_output_tokens: Some(SLIDES_MAX_TOKENS),
                temperature: Some(0.3),
            };
            llm::gemini::generate_text(&key, super::MODEL_NOTES_GEMINI, &full, Vec::new(), Some(cfg))
                .await
                .map_err(err_to_string)?
                .text
        }
    };

    Ok(text)
}

// ─── 범용 Claude 텍스트 생성 (문법/번역/문서개선/구조화 — React AI 모드) ─────
//
// system + prompt 는 프론트(aiService)가 모드별로 구성해 전달하고, 백엔드는 인증
// (구독 OAuth or API 키) + 호출만 담당한다. 구독 토큰은 Rust(keychain/refresh)에만
// 있으므로 Claude 경로는 반드시 이 command 를 거친다. 반환은 변환된 텍스트(diff 는 프론트).
#[tauri::command]
pub async fn ai_generate_claude(
    system: Option<String>,
    prompt: String,
    claude_auth: crate::subscription_auth::ClaudeAuthMode,
    max_tokens: Option<u32>,
    model: Option<String>,
) -> Result<String, String> {
    use super::keychain::{get_key, Provider};
    use super::llm::anthropic::{self, ClaudeAuth, ClaudeOptions};
    use crate::subscription_auth::ClaudeAuthMode;

    let model_id = model.as_deref().unwrap_or(super::MODEL_NOTES_CLAUDE);
    let opts = ClaudeOptions {
        max_output_tokens: Some(max_tokens.unwrap_or(16000)),
        system,
    };

    let result = match claude_auth {
        ClaudeAuthMode::Subscription => {
            let token = crate::subscription_auth::claude_access_token().await?;
            anthropic::generate_text(ClaudeAuth::Subscription(&token), model_id, &prompt, Some(opts))
                .await
        }
        ClaudeAuthMode::ApiKey => {
            let key = get_key(Provider::Claude)
                .map_err(err_to_string)?
                .ok_or_else(|| {
                    "Claude API 키가 없습니다. Settings 에서 등록하거나 구독 로그인을 사용하세요."
                        .to_string()
                })?;
            anthropic::generate_text(ClaudeAuth::ApiKey(&key), model_id, &prompt, Some(opts)).await
        }
    };
    result.map(|r| r.text).map_err(err_to_string)
}

// ─── 범용 ChatGPT(Codex 구독) 텍스트 생성 (React AI 모드) ────────────────────
//
// 본인 Codex CLI 로그인 토큰을 재사용해 ChatGPT 구독으로 호출(비공개 Responses API).
// 미검증 경로 — API 키 fallback 은 호출부(프론트)에서 모델 전환으로 처리한다.
#[tauri::command]
pub async fn ai_generate_codex(
    system: Option<String>,
    prompt: String,
    model: Option<String>,
) -> Result<String, String> {
    use super::llm::openai_codex;
    let tokens = crate::subscription_auth::read_codex_tokens()?;
    let model_id = model.as_deref().unwrap_or(super::MODEL_CODEX);
    openai_codex::generate_text(
        &tokens.access_token,
        tokens.account_id.as_deref(),
        model_id,
        system.as_deref(),
        &prompt,
    )
    .await
    .map(|r| r.text)
    .map_err(err_to_string)
}

// ─── OpenAI API 키 텍스트 생성 (구독 codex 와 별개 경로) ─────────────────────
//
// 표준 chat completions(api.openai.com). React AI 모드가 OpenAI + API 키 선택 시 사용.
#[tauri::command]
pub async fn ai_generate_openai(
    system: Option<String>,
    prompt: String,
    model: String,
) -> Result<String, String> {
    use super::keychain::{get_key, Provider};
    use super::llm::openai_api;
    let key = get_key(Provider::Openai)
        .map_err(err_to_string)?
        .ok_or_else(|| "OpenAI API 키가 없습니다. Settings 에서 등록하세요.".to_string())?;
    openai_api::generate_text(&key, &model, system.as_deref(), &prompt)
        .await
        .map(|r| r.text)
        .map_err(err_to_string)
}

// ─── 화자 라벨 후처리 (STT 결과 정리용) ─────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    /// Codex P2 follow-up: ensure `extract_speakers` returns labels from a
    /// clean (no-timestamp) transcript when it's part of an STT pair —
    /// previously the per-file gate skipped the clean file, breaking
    /// rename/delete sync. The set-level gate must accept the whole set
    /// once any path looks like STT.
    #[test]
    fn extract_speakers_accepts_clean_paired_with_timestamped() {
        let dir = TempDir::new().unwrap();
        let ts_path = dir.path().join("ts.md");
        let cl_path = dir.path().join("clean.md");
        std::fs::write(&ts_path, "**[00:00:05] 화자A:** 안녕\n**[00:00:10] 화자B:** 반갑").unwrap();
        // clean has the same labels but no timestamps — exact shape of
        // remove_timestamps output
        std::fs::write(&cl_path, "**화자A:** 안녕\n**화자B:** 반갑").unwrap();
        let labels = extract_speakers(vec![
            ts_path.to_string_lossy().into_owned(),
            cl_path.to_string_lossy().into_owned(),
        ])
        .unwrap();
        assert_eq!(labels, vec!["화자A", "화자B"]);
    }

    /// Sister test — when the whole set is metadata-only (no STT), gate
    /// returns empty so the SpeakerEditor doesn't surface fake speakers.
    #[test]
    fn extract_speakers_skips_metadata_only_set() {
        let dir = TempDir::new().unwrap();
        let p = dir.path().join("notes.md");
        std::fs::write(&p, "**일시:** 2026년 5월 28일\n**참석자:** 승우, 재문").unwrap();
        let labels = extract_speakers(vec![p.to_string_lossy().into_owned()]).unwrap();
        assert!(labels.is_empty(), "metadata-only doc must not yield speakers");
    }

    /// rename_speakers must update BOTH timestamped and clean files when
    /// they're passed together — that was the original Codex regression.
    #[test]
    fn rename_speakers_updates_clean_in_pair() {
        let dir = TempDir::new().unwrap();
        let ts_path = dir.path().join("ts.md");
        let cl_path = dir.path().join("clean.md");
        std::fs::write(&ts_path, "**[00:00:05] 화자A:** 안녕\n").unwrap();
        std::fs::write(&cl_path, "**화자A:** 안녕\n").unwrap();
        rename_speakers(
            vec![
                ts_path.to_string_lossy().into_owned(),
                cl_path.to_string_lossy().into_owned(),
            ],
            vec![("화자A".into(), "김철수".into())],
        )
        .unwrap();
        let ts_after = std::fs::read_to_string(&ts_path).unwrap();
        let cl_after = std::fs::read_to_string(&cl_path).unwrap();
        assert!(ts_after.contains("김철수:**"), "ts file not renamed: {}", ts_after);
        assert!(cl_after.contains("김철수:**"), "clean file not renamed: {}", cl_after);
    }
}

/// Speaker-line patterns we accept, in priority order. LLM output isn't
/// 100% consistent — same prompt can return any of:
///   1. `**[00:00:12] 화자A:**`        ← canonical bold envelope
///   2. `**화자A:**`                   ← clean version (no timestamp)
///   3. `[00:00:12] **화자A**:`        ← bold around label only
///   4. `[00:00:12] 화자A:`            ← no bold at all
///
/// `extract_last_speaker_lines` already runs a strict+loose fallback for the
/// chunk-context use case. The extractor/renamer used to support only #1+#2
/// which silently dropped any document the model returned in formats #3-#4.
/// Symptom: "감지된 화자 라벨이 없습니다" on outputs that did contain
/// speakers.
///
/// **Why no `**LABEL**:` fallback (without timestamp)** — that shape collides
/// with common meeting-note metadata lines (`**일시**: ...`, `**참석자**: ...`,
/// `**결정사항**: ...`). Treating those as speakers makes the editor offer
/// nonsense rename targets and, worse, lets the user delete "참석자" — which
/// then strips every line up to the next *real* speaker header. So we
/// require **either** a timestamp anchor (patterns 3, 4 below) **or** the
/// canonical bold-envelope shape (1, 2). The clean STT output already
/// retains the bold envelope through `remove_timestamps`, so no recall
/// is lost in practice.
///
/// All patterns are line-anchored to avoid mid-paragraph "참고:" / "Title:"
/// false matches.
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
    ])
}

/// True iff the document contains at least one `[HH:MM:SS]` / `[MM:SS]`
/// timestamp anywhere. STT output ALWAYS contains them; meeting notes and
/// hand-authored markdown almost never do. Used as a structural gate
/// before running speaker extraction — without this, Tier 1's
/// `**LABEL:**` shape would happily collect metadata headers like
/// `**일시:**`, `**참석자:**`, `**결정사항:**` as fake speakers.
fn has_any_timestamp(text: &str) -> bool {
    static TS_RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re = TS_RE.get_or_init(|| {
        regex::Regex::new(r"\[\d{1,2}:\d{2}(?::\d{2})?\]").expect("regex compile")
    });
    re.is_match(text)
}

/// 마크다운 본문에서 화자 라벨 추출.
/// 4단계 fallback 패턴(see [[speaker_line_patterns]]) 으로 LLM 출력 변형을
/// 모두 흡수. 발견된 모든 고유 라벨을 등장 순서대로 반환.
///
/// **Set-level structural gate** — AudioTab 는 보통 (timestamped, clean)
/// 쌍을 전달하는데 clean 파일은 `save_audio_results::remove_timestamps`
/// 로 timestamp 가 의도적으로 제거된 상태다. 파일 *개별* 로 gate 를 걸면
/// clean 파일이 항상 skip 되어 rename/delete 가 timestamped 한쪽에만
/// 적용되고 두 파일 sync 가 깨진다. 따라서 paths set 중 *하나라도*
/// timestamp 를 가지면 전체 set 이 STT job 으로 간주되어 정상 처리되고,
/// 모든 path 가 timestamp 없으면 (= 회의록 / 손편집 마크다운으로 잘못
/// 호출된 케이스) 전체 set 을 건너뛴다.
#[tauri::command]
pub fn extract_speakers(paths: Vec<String>) -> Result<Vec<String>, String> {
    use std::collections::BTreeSet;
    let patterns = speaker_line_patterns().map_err(|e| e.to_string())?;

    // Read each file once, then make the gate decision on the union.
    let contents: Vec<(String, String)> = paths
        .iter()
        .filter_map(|p| std::fs::read_to_string(p).ok().map(|c| (p.clone(), c)))
        .collect();
    let any_has_ts = contents.iter().any(|(_, c)| has_any_timestamp(c));
    if !any_has_ts {
        return Ok(Vec::new());
    }

    let mut order: Vec<String> = Vec::new();
    let mut seen: BTreeSet<String> = BTreeSet::new();
    for (_path, content) in &contents {
        for re in &patterns {
            for cap in re.captures_iter(content) {
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
    // [[speaker_line_patterns]] — strictest first. Pattern 4
    // (`**LABEL**:` with no timestamp) is INTENTIONALLY OMITTED: it would
    // match common meeting-note metadata lines like `**일시**: ...` and
    // let `rename_speakers` strip real content when the user deletes one
    // of those false speakers. See speaker_line_patterns() comment.
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

    // Set-level gate — at least one path must look like STT output. The
    // clean transcript that pairs with a timestamped one has timestamps
    // intentionally stripped (see save_audio_results::remove_timestamps),
    // so a per-file gate would skip the clean file and leave the two
    // copies out of sync after rename. Read once, decide once.
    //
    // Read errors are PROPAGATED (not silently dropped). If one file in
    // the pair is locked / moved / permission-denied, the user gets a
    // clear error rather than a partial rename that silently leaves the
    // two transcripts out of sync.
    let originals: Vec<(String, String)> = paths
        .iter()
        .map(|p| {
            std::fs::read_to_string(p)
                .map(|c| (p.clone(), c))
                .map_err(|e| format!("{}: {}", p, e))
        })
        .collect::<Result<_, _>>()?;
    if !originals.iter().any(|(_, c)| has_any_timestamp(c)) {
        return Ok(());
    }

    for (path, original) in &originals {
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
