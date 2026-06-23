//! Tauri command 모음 — frontend 에서 invoke() 로 호출.
//!
//! 각 명령은 비동기로 파이프라인 실행 + ProgressEmitter 로 진행상황 stream.

use super::audio_pipeline::{self, AudioJobOptions, AudioJobResult};
use super::error::ConverterError;
use super::notes_pipeline::{self, NotesJobOptions, NotesJobResult};
use super::ocr_pipeline::{self, OcrJobOptions, OcrJobResult};
use super::progress::{ProgressEmitter, ProgressModelInfo};
use serde::Deserialize;
use tauri::AppHandle;

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
// 반환은 프론트가 파싱하는 슬라이드 JSON 문자열:
//   { "master"?: { deck-wide chrome }, "slides": [ { "title", "layout", "bullets"/"blocks"/"columns", "notes"? } ] }

// 최종 슬라이드 JSON 출력 상한. 장수 추정으로 흔들지 않고 단순 고정값을 쓴다.
const SLIDES_MAX_TOKENS: u32 = 16000;
const SLIDES_MAX_COUNT: usize = 32;
const SLIDES_PLAN_MAX_TOKENS: u32 = 12000;
const SLIDES_TWO_PASS_SECTION_THRESHOLD: usize = 28;
const SLIDES_TWO_PASS_SLIDE_THRESHOLD: usize = 24;
const SLIDE_MARKDOWN_DRAFT_MAX_TOKENS: u32 = 30000;

const SLIDES_PLAN_SYSTEM: &str = concat!(
    "You are a deck planning agent. Build a grounded presentation plan from a Markdown source map. ",
    "Output STRICT minified JSON only (no prose, no code fences, no markdown) of the form: {\"slides\":[...]}. ",
    "Each planned slide must include id, role, message, sourceIds, layoutHint, layoutRationale, fitNotes, speakerIntent, and sectionPath. ",
    "Do not write final slide bullets yet. Do not copy the document outline one-to-one. ",
    "Create a narrative that may reorder sections when it improves audience understanding, but every planned claim must be grounded in sourceIds. ",
    "Prefer one message per slide, merge weak adjacent sections, split dense sections, and include section divider slides only when they improve flow. ",
    "Treat layouts as schemas, not decoration: choose the layout whose rhetorical shape fits the message. ",
    "Use title/opening, section, and ending roles deliberately; avoid a chain of generic title-plus-bullets slides. ",
    "Plan for native editable PowerPoint output: keep each slide to about six visible content elements, leave whitespace, and keep text near 60 percent of the available visual capacity. ",
    "Use the requested slide count as a target, not a reason to pad weak slides. Never output more than 32 slides. Never invent facts."
);

const SLIDES_SYSTEM: &str = concat!(
    "You are a slide manuscript agent, not a visual renderer. Convert a grounded source map or deck plan into final slide JSON. ",
    "Output STRICT minified JSON only (no prose, no code fences, no markdown) of the form: {\"master\":{...},\"slides\":[...]}. The top-level master object is optional. ",
    "Allowed layout values: \"title\", \"content\", \"section\", \"two-column\", \"image-focus\", \"quote\", \"stat\", \"comparison\", \"timeline\". ",
    "A slide may include: title:string, layout:string, importance:number(0-100), importanceReason:string, sourceIds:string[], bullets:string[], blocks:[{kind:\"text\"|\"bullet\"|\"subhead\",text:string,level?:number}], columns:[[string|{kind,text,level?}]], quote:{text,attribution?}, stat:{value,label?,context?}, image:{prompt?,query?,entity?,role?,kind?,alt?,aspect?,style?,sourcePreference?,licenseStrictness?}, source:{headingLevel?:number,sectionPath?:string[]}, notes:string. ",
    "Never output more than 32 slides. Use the slide count target as a soft target inside that hard limit. ",
    "Optional master may include only deck-wide chrome policies for slideNumber, footer, or date, using enabled, includeOn(title/content/section), position(bottom-left/bottom-center/bottom-right), style(minimal/muted/accent/inverse), and short footer/date text. ",
    "Follow the deck plan when provided; otherwise plan internally from the source map. Do not flatten the document into a list. Each slide must express one clear message and cite its source through source.headingLevel and source.sectionPath. ",
    "Use slide titles rewritten for presentation impact when useful, but keep them faithful to the source. ",
    "Use \"section\" for major dividers, \"two-column\"/\"comparison\" for parallel ideas, \"stat\" for one important number, \"quote\" for a strong cited sentence, and \"image-focus\" only when an image asset would materially help. ",
    "For each slide, assign importance based on deck role: cover, conclusion, executive recommendation, core claim, and key evidence should be high; ordinary supporting details should be lower. ",
    "For image needs, output image intent only; do not embed URLs or base64. Use query/entity for stock or logo retrieval. Use prompt for generated images, and make it a real image-generation prompt, not a search query: describe subject, composition, mood, style, and constraints. role must be among cover/hero/support/logo/icon/background, aspect such as 16:9 or 4:3, sourcePreference among auto/stock/logo/generated/none, and licenseStrictness among presentation/open/internal-only. ",
    "When the image policy asks to actively add visuals, do not reserve images only for cover or section slides. Also add ambient or supporting visual intent to spacious body slides, sparse quote/stat slides, and concept slides where an image would improve atmosphere or comprehension. ",
    "For slides with multiple local topics, use blocks with explicit {kind:\"subhead\"} group labels followed by their related bullet/text blocks; never run separate subtopics together as one bullet list. Prefer splitting slides with more than three subhead groups. ",
    "Layout capacity rules: title slides need title plus at most two short support lines; content slides need at most seven short bullets; two-column/comparison slides need two balanced columns; stat slides need exactly one headline number; quote slides need one concise quotation; tables and code require short summaries when they would dominate the page. ",
    "Before finalizing each slide, perform a fit check: if text would overflow a slot, rewrite shorter or split into another slide instead of relying on tiny fonts. ",
    "Speaker notes are optional; include them only when useful, at most 1-2 natural sentences. ",
    "Honor design options for layout direction, image policy, image source mode, visual density, font preference, and margin preference. Use them to choose layout values and control how much text each slide carries. ",
    "Keep bullets short, avoid copying full source paragraphs, preserve the document language unless the user requests a target language, and never invent facts. ",
    "Do not output colors, coordinates, font sizes, font names, PptxGenJS options, OpenXML, placeholders, or raw CSS."
);

const SLIDE_MARKDOWN_DRAFT_SYSTEM: &str = concat!(
    "You are a slide manuscript agent for a Markdown-first editor. ",
    "Create a reviewable slide draft, not a PowerPoint file and not JSON. ",
    "Output Markdown only, with no surrounding prose and no code fence around the whole answer. ",
    "Use a horizontal rule line `---` between slides because the app uses it as a slide separator. ",
    "Start each slide with a Markdown heading. Use heading depth to express source hierarchy where useful. ",
    "Each slide should have one clear message, not a copied outline dump. ",
    "Split dense source sections, merge weak adjacent sections, and reorder only when it improves the narrative. ",
    "Use presentation-agent style planning: opening, section, content, evidence, comparison, key-stat, quote, and closing slides should each have a clear functional role. ",
    "Use template-schema discipline even in Markdown: keep titles short, bullets compact, tables small, and two-column ideas balanced. ",
    "Use native PowerPoint slot-fit discipline: if a slide would need tiny text or crowded elements, split it rather than forcing everything onto one page. ",
    "Preserve source facts exactly. Never invent numbers, claims, citations, dates, or outcomes. ",
    "Source IDs such as S1, S2, and S3 are internal grounding markers only. Never print them as visible source or citation text in the Markdown draft. ",
    "Follow the draft comments option: when comments are enabled, add frequent visible blockquotes beginning with `> 코멘트:`, `> 검토 필요:`, or `> 추가 정보 필요:` for gaps, assumptions, open questions, and editorial choices; when comments are disabled, do not add reviewer comments and instead omit unsupported claims. ",
    "Do not include colors, coordinates, font sizes, PptxGenJS options, CSS, or visual design directions."
);

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlideGenerationOptions {
    audience: Option<String>,
    tone: Option<String>,
    language: Option<String>,
    slide_count_hint: Option<String>,
    draft_purpose: Option<String>,
    draft_structure: Option<String>,
    draft_depth: Option<String>,
    draft_revision_mode: Option<String>,
    draft_review_mode: Option<String>,
    design_layout: Option<String>,
    visual_density: Option<String>,
    image_policy: Option<String>,
    image_source_mode: Option<String>,
    font_preference: Option<String>,
    font_family: Option<String>,
    margin_preference: Option<String>,
    extra_instructions: Option<String>,
    design_rules: Option<String>,
    theme_name: Option<String>,
    #[serde(default)]
    theme_rules: Vec<String>,
}

fn push_option_line(lines: &mut Vec<String>, label: &str, value: &Option<String>) {
    if let Some(v) = value.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
        lines.push(format!("- {}: {}", label, v));
    }
}

fn short_text(value: &str, max_chars: usize) -> String {
    let trimmed = value.trim();
    let mut out = String::new();
    for (idx, ch) in trimmed.chars().enumerate() {
        if idx >= max_chars {
            out.push('…');
            break;
        }
        out.push(ch);
    }
    out
}

fn first_usize(value: &str) -> Option<usize> {
    let mut buf = String::new();
    for ch in value.chars() {
        if ch.is_ascii_digit() {
            buf.push(ch);
        } else if !buf.is_empty() {
            break;
        }
    }
    buf.parse().ok()
}

fn slide_count_hint_label(value: &Option<String>) -> Option<String> {
    let raw = value.as_deref().map(str::trim).filter(|v| !v.is_empty())?;
    let Some(requested) = first_usize(raw) else {
        return Some(raw.to_string());
    };
    let capped = requested.min(SLIDES_MAX_COUNT);
    if requested > SLIDES_MAX_COUNT {
        Some(format!(
            "{} slides requested, capped at hard limit {}",
            requested, SLIDES_MAX_COUNT
        ))
    } else {
        Some(format!("{} slides target", capped))
    }
}

fn should_use_two_pass_slide_generation(
    options: Option<&SlideGenerationOptions>,
    source_section_count: usize,
) -> bool {
    let slide_count_hint = options
        .and_then(|o| o.slide_count_hint.as_deref())
        .and_then(first_usize)
        .map(|n| n.min(SLIDES_MAX_COUNT))
        .unwrap_or(0);
    source_section_count >= SLIDES_TWO_PASS_SECTION_THRESHOLD
        || slide_count_hint >= SLIDES_TWO_PASS_SLIDE_THRESHOLD
}

#[derive(Debug, Clone)]
struct MarkdownSourceSection {
    id: String,
    level: usize,
    title: String,
    section_path: Vec<String>,
    line_start: usize,
    line_end: usize,
    content: String,
}

fn push_section(
    sections: &mut Vec<MarkdownSourceSection>,
    id_num: usize,
    level: usize,
    title: String,
    section_path: Vec<String>,
    line_start: usize,
    line_end: usize,
    content: Vec<String>,
) {
    let content = content.join("\n").trim().to_string();
    if title.trim().is_empty() && content.is_empty() {
        return;
    }
    sections.push(MarkdownSourceSection {
        id: format!("S{}", id_num),
        level,
        title: title.trim().to_string(),
        section_path,
        line_start,
        line_end,
        content,
    });
}

fn markdown_heading_level(line: &str) -> Option<(usize, String)> {
    let left = line.trim_start();
    let level = left.chars().take_while(|ch| *ch == '#').count();
    if level == 0 || level > 6 || left.as_bytes().get(level) != Some(&b' ') {
        return None;
    }
    let title = left[level..].trim();
    if title.is_empty() {
        return None;
    }
    Some((level, title.to_string()))
}

fn markdown_source_sections(markdown: &str) -> Vec<MarkdownSourceSection> {
    let lines: Vec<&str> = markdown.lines().collect();
    let mut sections = Vec::new();
    let mut heading_stack: Vec<String> = Vec::new();
    let mut in_frontmatter = false;
    let mut in_fence = false;
    let mut fence_marker = "";
    let mut prelude: Vec<String> = Vec::new();
    let mut current: Option<(usize, String, Vec<String>, usize, Vec<String>)> = None;
    let mut next_id = 1;

    for (idx, line) in lines.iter().enumerate() {
        let line_no = idx + 1;
        let trimmed = line.trim();
        if idx == 0 && trimmed == "---" {
            in_frontmatter = true;
            continue;
        }
        if in_frontmatter {
            if trimmed == "---" {
                in_frontmatter = false;
            }
            continue;
        }

        let left = line.trim_start();
        let fence = if left.starts_with("```") {
            Some("```")
        } else if left.starts_with("~~~") {
            Some("~~~")
        } else {
            None
        };
        if let Some(marker) = fence {
            if !in_fence {
                in_fence = true;
                fence_marker = marker;
            } else if left.starts_with(fence_marker) {
                in_fence = false;
            }
            if let Some((_, _, _, _, content)) = current.as_mut() {
                content.push((*line).to_string());
            } else {
                prelude.push((*line).to_string());
            }
            continue;
        }

        if !in_fence {
            if let Some((level, title)) = markdown_heading_level(line) {
                if let Some((cur_level, cur_title, cur_path, cur_start, cur_content)) =
                    current.take()
                {
                    push_section(
                        &mut sections,
                        next_id,
                        cur_level,
                        cur_title,
                        cur_path,
                        cur_start,
                        line_no.saturating_sub(1),
                        cur_content,
                    );
                    next_id += 1;
                } else if !prelude.iter().all(|l| l.trim().is_empty()) {
                    push_section(
                        &mut sections,
                        next_id,
                        1,
                        "Document opening".to_string(),
                        Vec::new(),
                        1,
                        line_no.saturating_sub(1),
                        std::mem::take(&mut prelude),
                    );
                    next_id += 1;
                }

                let section_path = heading_stack
                    .iter()
                    .take(level.saturating_sub(1))
                    .filter(|s| !s.trim().is_empty())
                    .cloned()
                    .collect::<Vec<_>>();
                if heading_stack.len() < level {
                    heading_stack.resize(level, String::new());
                }
                heading_stack[level - 1] = title.clone();
                heading_stack.truncate(level);
                current = Some((level, title, section_path, line_no, Vec::new()));
                continue;
            }
        }

        if let Some((_, _, _, _, content)) = current.as_mut() {
            content.push((*line).to_string());
        } else {
            prelude.push((*line).to_string());
        }
    }

    if let Some((cur_level, cur_title, cur_path, cur_start, cur_content)) = current.take() {
        push_section(
            &mut sections,
            next_id,
            cur_level,
            cur_title,
            cur_path,
            cur_start,
            lines.len().max(cur_start),
            cur_content,
        );
    } else if !prelude.iter().all(|l| l.trim().is_empty()) {
        push_section(
            &mut sections,
            next_id,
            1,
            "Document".to_string(),
            Vec::new(),
            1,
            lines.len().max(1),
            prelude,
        );
    }

    sections
}

fn source_signals(content: &str) -> String {
    let has_table = content
        .lines()
        .any(|line| line.trim_start().starts_with('|'));
    let image_count = content.matches("![").count();
    let has_quote = content
        .lines()
        .any(|line| line.trim_start().starts_with('>'));
    let has_code = content.contains("```") || content.contains("~~~");
    let has_stat = content.split_whitespace().any(|word| {
        word.chars().any(|c| c.is_ascii_digit())
            && (word.contains('%')
                || word.contains('$')
                || word.contains('x')
                || word.contains('X'))
    });

    let mut signals = Vec::new();
    if has_table {
        signals.push("table");
    }
    if image_count > 0 {
        signals.push("image");
    }
    if has_quote {
        signals.push("quote");
    }
    if has_code {
        signals.push("code");
    }
    if has_stat {
        signals.push("stat");
    }
    if signals.is_empty() {
        "text".to_string()
    } else {
        signals.join(",")
    }
}

fn source_map_prompt(sections: &[MarkdownSourceSection]) -> String {
    if sections.is_empty() {
        return String::new();
    }
    let mut out = vec![
        "<source_sections>".to_string(),
        "Use these source IDs for planning and final slides. Every non-cover slide should cite one or more source IDs in the plan.".to_string(),
    ];
    let mut budget = 18000usize;
    for section in sections.iter().take(90) {
        if budget == 0 {
            break;
        }
        let mut excerpt = section.content.trim().to_string();
        if excerpt.is_empty() {
            excerpt = section.title.clone();
        }
        excerpt = short_text(&excerpt, 1100);
        let path = if section.section_path.is_empty() {
            "(root)".to_string()
        } else {
            section.section_path.join(" / ")
        };
        let entry = format!(
            "\n[{}]\nheading: H{} {}\npath: {}\nlines: {}-{}\nsignals: {}\nexcerpt:\n{}\n",
            section.id,
            section.level,
            section.title,
            path,
            section.line_start,
            section.line_end,
            source_signals(&section.content),
            excerpt
        );
        if entry.len() > budget {
            break;
        }
        budget -= entry.len();
        out.push(entry);
    }
    if sections.len() > 90 {
        out.push(format!(
            "\n... {} additional source sections omitted",
            sections.len() - 90
        ));
    }
    out.push("</source_sections>".to_string());
    out.join("\n")
}

fn markdown_outline_prompt(markdown: &str) -> String {
    let mut outline = Vec::new();
    let mut in_frontmatter = false;
    let mut in_fence = false;
    let mut fence_marker = "";

    for (line_idx, line) in markdown.lines().enumerate() {
        let trimmed = line.trim();
        if line_idx == 0 && trimmed == "---" {
            in_frontmatter = true;
            continue;
        }
        if in_frontmatter {
            if trimmed == "---" {
                in_frontmatter = false;
            }
            continue;
        }

        let left = line.trim_start();
        if left.starts_with("```") || left.starts_with("~~~") {
            let marker = if left.starts_with("```") {
                "```"
            } else {
                "~~~"
            };
            if !in_fence {
                in_fence = true;
                fence_marker = marker;
            } else if left.starts_with(fence_marker) {
                in_fence = false;
            }
            continue;
        }
        if in_fence {
            continue;
        }

        let level = left.chars().take_while(|ch| *ch == '#').count();
        if level == 0 || level > 6 || left.as_bytes().get(level) != Some(&b' ') {
            continue;
        }
        let text = short_text(&left[level..], 120);
        if !text.is_empty() {
            outline.push(format!("- H{} line {}: {}", level, line_idx + 1, text));
        }
    }

    if outline.is_empty() {
        return String::new();
    }

    let mut out = vec![
        "<markdown_outline>".to_string(),
        "Use this heading hierarchy as the source structure. Preserve it through source.headingLevel and source.sectionPath when planning slides.".to_string(),
    ];
    let total = outline.len();
    out.extend(outline.into_iter().take(120));
    if total > 120 {
        out.push(format!("- ... {} additional headings omitted", total - 120));
    }
    out.push("</markdown_outline>".to_string());
    out.join("\n")
}

fn slide_options_prompt(options: Option<&SlideGenerationOptions>) -> String {
    let Some(options) = options else {
        return String::new();
    };
    let mut lines = vec!["<export_options>".to_string()];
    push_option_line(&mut lines, "Audience", &options.audience);
    push_option_line(&mut lines, "Tone", &options.tone);
    push_option_line(&mut lines, "Target language", &options.language);
    if let Some(slide_count) = slide_count_hint_label(&options.slide_count_hint) {
        lines.push(format!("- Slide count target: {}", slide_count));
    }
    lines.push(format!(
        "- Hard slide limit: output no more than {} slides",
        SLIDES_MAX_COUNT
    ));
    push_option_line(&mut lines, "Draft purpose", &options.draft_purpose);
    push_option_line(&mut lines, "Draft structure", &options.draft_structure);
    push_option_line(&mut lines, "Draft detail level", &options.draft_depth);
    push_option_line(
        &mut lines,
        "Draft revision mode",
        &options.draft_revision_mode,
    );
    push_option_line(&mut lines, "Draft comments", &options.draft_review_mode);
    push_option_line(&mut lines, "Layout direction", &options.design_layout);
    push_option_line(&mut lines, "Visual density", &options.visual_density);
    push_option_line(&mut lines, "Image policy", &options.image_policy);
    push_option_line(&mut lines, "Image source mode", &options.image_source_mode);
    push_option_line(&mut lines, "Font preference", &options.font_preference);
    push_option_line(&mut lines, "Installed font family", &options.font_family);
    push_option_line(&mut lines, "Margin preference", &options.margin_preference);
    push_option_line(
        &mut lines,
        "Extra instructions",
        &options.extra_instructions,
    );
    if let Some(theme) = options
        .theme_name
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        lines.push(format!("- Selected theme: {}", theme));
    }
    if !options.theme_rules.is_empty() {
        lines.push("- Theme rules:".to_string());
        for rule in &options.theme_rules {
            let rule = rule.trim();
            if !rule.is_empty() {
                lines.push(format!("  - {}", rule));
            }
        }
    }
    push_option_line(&mut lines, "Additional design rules", &options.design_rules);
    lines.push("</export_options>".to_string());
    lines.join("\n")
}

fn extract_json_object(raw: &str) -> String {
    let Some(start) = raw.find('{') else {
        return raw.trim().to_string();
    };
    let Some(end) = raw.rfind('}') else {
        return raw.trim().to_string();
    };
    if end <= start {
        return raw.trim().to_string();
    }
    raw[start..=end].trim().to_string()
}

fn strip_outer_markdown_fence(raw: &str) -> String {
    let trimmed = raw.trim();
    let first = trimmed.lines().next().unwrap_or("").trim_start();
    let marker = if first.starts_with("```") {
        "```"
    } else if first.starts_with("~~~") {
        "~~~"
    } else {
        return trimmed.to_string();
    };
    let mut lines: Vec<&str> = trimmed.lines().collect();
    if lines.len() >= 2
        && lines
            .last()
            .map(|line| line.trim_start().starts_with(marker))
            .unwrap_or(false)
    {
        lines.remove(0);
        lines.pop();
        return lines.join("\n").trim().to_string();
    }
    trimmed.to_string()
}

fn strip_internal_source_labels(raw: &str) -> String {
    static SOURCE_LINE_RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    static SOURCE_INLINE_RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let source_line_re = SOURCE_LINE_RE.get_or_init(|| {
        regex::Regex::new(
            r"(?i)^\s*(?:>\s*)?(?:[-*+]\s*)?(?:\*\*)?(?:출처|source|sources|source ids?)(?:\*\*)?\s*:\s*(?:\*\*)?\[?\(?\s*S\d+(?:\s*(?:[,;/&+]|\band\b|및)\s*S\d+|\s+S\d+)*\s*\)?\]?\s*\.?\s*$",
        )
        .expect("source line regex")
    });
    let source_inline_re = SOURCE_INLINE_RE.get_or_init(|| {
        regex::Regex::new(
            r"(?i)\s*\((?:출처|source|sources|source ids?)\s*:\s*S\d+(?:\s*(?:[,;/&+]|\band\b|및)\s*S\d+|\s+S\d+)*\s*\)",
        )
        .expect("source inline regex")
    });

    raw.lines()
        .filter(|line| !source_line_re.is_match(line))
        .map(|line| {
            source_inline_re
                .replace_all(line, "")
                .trim_end()
                .to_string()
        })
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

fn has_slide_draft_marker(markdown: &str) -> bool {
    markdown.lines().any(|line| {
        let t = line.trim();
        (t.starts_with("<!--") || t.starts_with("&lt;!--")) && t.contains("markmind:slide-draft")
    })
}

fn strip_slide_draft_marker(markdown: &str) -> String {
    markdown
        .lines()
        .filter(|line| {
            let t = line.trim();
            !((t.starts_with("<!--") || t.starts_with("&lt;!--"))
                && t.contains("markmind:slide-draft"))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

async fn call_slides_llm(
    company: crate::subscription_auth::AICompany,
    auth: crate::subscription_auth::ClaudeAuthMode,
    model: Option<&str>,
    system: &str,
    prompt: &str,
    max_tokens: u32,
) -> Result<String, String> {
    use super::keychain::{get_key, Provider};
    use super::llm;
    use crate::subscription_auth::{AICompany, ClaudeAuthMode};

    match company {
        AICompany::Gemini => {
            let key = get_key(Provider::Gemini)
                .map_err(err_to_string)?
                .ok_or_else(|| "Gemini API 키가 없습니다. Settings 에서 등록하세요.".to_string())?;
            let model_id = model.unwrap_or(super::MODEL_NOTES_GEMINI);
            let full = format!("{}\n\n{}", system, prompt);
            let cfg = llm::gemini::GenerationConfig {
                max_output_tokens: Some(max_tokens),
                temperature: Some(0.25),
            };
            Ok(
                llm::gemini::generate_text(&key, model_id, &full, Vec::new(), Some(cfg))
                    .await
                    .map_err(err_to_string)?
                    .text,
            )
        }
        AICompany::Claude => {
            let model_id = model.unwrap_or(super::MODEL_NOTES_CLAUDE);
            let opts = llm::anthropic::ClaudeOptions {
                max_output_tokens: Some(max_tokens),
                system: Some(system.to_string()),
            };
            let result = match auth {
                ClaudeAuthMode::Subscription => {
                    let token = crate::subscription_auth::claude_access_token().await?;
                    llm::anthropic::generate_text(
                        llm::anthropic::ClaudeAuth::Subscription(&token),
                        model_id,
                        prompt,
                        Some(opts),
                    )
                    .await
                }
                ClaudeAuthMode::ApiKey => {
                    let key = get_key(Provider::Claude)
                        .map_err(err_to_string)?
                        .ok_or_else(|| {
                            "Claude API 키가 없습니다. Settings 에서 등록하거나 구독 로그인을 사용하세요."
                                .to_string()
                        })?;
                    llm::anthropic::generate_text(
                        llm::anthropic::ClaudeAuth::ApiKey(&key),
                        model_id,
                        prompt,
                        Some(opts),
                    )
                    .await
                }
            };
            Ok(result.map_err(err_to_string)?.text)
        }
        AICompany::Openai => {
            let model_id = model.unwrap_or(super::MODEL_CODEX);
            let result = match auth {
                ClaudeAuthMode::Subscription => {
                    let tokens = crate::subscription_auth::read_codex_tokens()?;
                    llm::openai_codex::generate_text(
                        &tokens.access_token,
                        tokens.account_id.as_deref(),
                        model_id,
                        Some(system),
                        prompt,
                        Some(max_tokens),
                    )
                    .await
                }
                ClaudeAuthMode::ApiKey => {
                    let key = get_key(Provider::Openai)
                        .map_err(err_to_string)?
                        .ok_or_else(|| {
                            "OpenAI API 키가 없습니다. Settings 에서 등록하세요.".to_string()
                        })?;
                    llm::openai_api::generate_text(
                        &key,
                        model_id,
                        Some(system),
                        prompt,
                        Some(max_tokens),
                    )
                    .await
                }
            };
            Ok(result.map_err(err_to_string)?.text)
        }
    }
}

fn slide_default_model(company: crate::subscription_auth::AICompany) -> &'static str {
    use crate::subscription_auth::AICompany;
    match company {
        AICompany::Gemini => super::MODEL_NOTES_GEMINI,
        AICompany::Claude => super::MODEL_NOTES_CLAUDE,
        AICompany::Openai => super::MODEL_CODEX,
    }
}

fn slide_model_info(
    company: crate::subscription_auth::AICompany,
    auth: crate::subscription_auth::ClaudeAuthMode,
    model: Option<&str>,
) -> ProgressModelInfo {
    use crate::subscription_auth::{AICompany, ClaudeAuthMode};
    let company_id = match company {
        AICompany::Gemini => "gemini",
        AICompany::Claude => "claude",
        AICompany::Openai => "openai",
    };
    let auth_id = match auth {
        ClaudeAuthMode::ApiKey => "api_key",
        ClaudeAuthMode::Subscription => "subscription",
    };
    let model_id = model
        .map(str::trim)
        .filter(|m| !m.is_empty())
        .unwrap_or_else(|| slide_default_model(company));
    ProgressModelInfo {
        company: company_id.to_string(),
        auth: auth_id.to_string(),
        model: model_id.to_string(),
    }
}

async fn call_slides_llm_with_progress(
    emitter: &ProgressEmitter,
    step_id: &str,
    waiting_step: &str,
    done_step: &str,
    company: crate::subscription_auth::AICompany,
    auth: crate::subscription_auth::ClaudeAuthMode,
    model: Option<&str>,
    system: &str,
    prompt: &str,
    detail: Option<String>,
    max_tokens: u32,
) -> Result<String, String> {
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };
    use std::time::{Duration, Instant};

    let model_info = Some(slide_model_info(company, auth, model));
    emitter.emit_update_with_model(
        step_id,
        waiting_step,
        detail.clone(),
        None,
        model_info.clone(),
    );

    let started = Instant::now();
    let stop = Arc::new(AtomicBool::new(false));
    let heartbeat_stop = stop.clone();
    let heartbeat_emitter = emitter.clone();
    let heartbeat_step_id = step_id.to_string();
    let heartbeat_step = waiting_step.to_string();
    let heartbeat_model = model_info.clone();
    let heartbeat_detail = detail.clone();
    let heartbeat = tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(5)).await;
            if heartbeat_stop.load(Ordering::Relaxed) {
                break;
            }
            let elapsed = started.elapsed().as_secs();
            heartbeat_emitter.emit_update_with_model(
                heartbeat_step_id.clone(),
                format!("{heartbeat_step} {elapsed}초"),
                heartbeat_detail.clone(),
                None,
                heartbeat_model.clone(),
            );
        }
    });

    let result = call_slides_llm(company, auth, model, system, prompt, max_tokens).await;
    stop.store(true, Ordering::Relaxed);
    heartbeat.abort();

    if result.is_ok() {
        emitter.emit_update_with_model(step_id, done_step, detail, Some(1.0), model_info);
    }
    result
}

//
// 모든 AI 작업은 전역 회사(company)→인증(auth)→모델(model) 선택(aiModelConfig)을
// 따른다 — 슬라이드 생성도 회의록 파이프라인과 동일하게 3사·구독/API 키를 지원한다.
#[tauri::command]
pub async fn generate_slides_llm(
    app: AppHandle,
    markdown: String,
    company: crate::subscription_auth::AICompany,
    auth: crate::subscription_auth::ClaudeAuthMode,
    model: Option<String>,
    options: Option<SlideGenerationOptions>,
    job_id: Option<String>,
) -> Result<String, String> {
    let emitter = new_emitter(app, job_id);
    let opt_block = slide_options_prompt(options.as_ref());
    let outline_block = markdown_outline_prompt(&markdown);
    let source_sections = markdown_source_sections(&markdown);
    let source_map = source_map_prompt(&source_sections);
    emitter.emit(
        "✅ 문서 구조 분석 완료",
        Some(format!("소스 섹션 {}개", source_sections.len())),
    );
    let use_two_pass =
        should_use_two_pass_slide_generation(options.as_ref(), source_sections.len());

    let draft_prompt = if use_two_pass {
        let plan_prompt = format!(
            "Plan a slide deck from this Markdown-derived source map. Respect export options, source hierarchy, and source IDs.\n\n{}\n\n{}\n\n{}",
            opt_block,
            outline_block,
            source_map
        );
        emitter.emit("✅ 슬라이드 계획 요청 완료", None);
        let plan_raw = call_slides_llm_with_progress(
            &emitter,
            "pptx-plan-llm",
            "⏳ AI가 슬라이드 구조를 계획하는 중…",
            "✅ 슬라이드 구조 계획 완료",
            company,
            auth,
            model.as_deref(),
            SLIDES_PLAN_SYSTEM,
            &plan_prompt,
            None,
            SLIDES_PLAN_MAX_TOKENS,
        )
        .await?;
        let deck_plan = extract_json_object(&plan_raw);
        emitter.emit("✅ 슬라이드 구조 계획 응답 수신", None);

        format!(
            "Generate final slides JSON from the approved deck plan. Use only grounded source content. If the plan has an unsupported or weak slide, repair it locally instead of rewriting the whole deck.\n\n{}\n\n<deck_plan>\n{}\n</deck_plan>\n\n{}",
            opt_block,
            deck_plan,
            source_map
        )
    } else {
        format!(
            "Generate final slides JSON directly from this Markdown-derived source map. Plan internally, but output only the final JSON. Respect export options, source hierarchy, and source IDs.\n\n{}\n\n{}\n\n{}",
            opt_block,
            outline_block,
            source_map
        )
    };
    emitter.emit("✅ 슬라이드 JSON 요청 준비 완료", None);

    // 슬라이드 JSON이 잘리면 프론트 파싱 실패로 이어지므로 상한은 단순 고정값을 쓴다.
    let slides_raw = call_slides_llm_with_progress(
        &emitter,
        "pptx-slides-llm",
        "⏳ AI가 최종 슬라이드를 작성하는 중…",
        "✅ 최종 슬라이드 작성 완료",
        company,
        auth,
        model.as_deref(),
        SLIDES_SYSTEM,
        &draft_prompt,
        None,
        SLIDES_MAX_TOKENS,
    )
    .await?;

    let cleaned = extract_json_object(&slides_raw);
    emitter.emit("✅ 슬라이드 JSON 정리 완료", None);
    emitter.emit("✅ AI 슬라이드 생성 완료", None);
    Ok(cleaned)
}

#[tauri::command]
pub async fn generate_slide_markdown_draft(
    app: AppHandle,
    markdown: String,
    company: crate::subscription_auth::AICompany,
    auth: crate::subscription_auth::ClaudeAuthMode,
    model: Option<String>,
    options: Option<SlideGenerationOptions>,
    job_id: Option<String>,
) -> Result<String, String> {
    let emitter = new_emitter(app, job_id);
    let is_existing_draft = has_slide_draft_marker(&markdown);
    let markdown_body = strip_slide_draft_marker(&markdown);
    let opt_block = slide_options_prompt(options.as_ref());
    let outline_block = markdown_outline_prompt(&markdown_body);
    let source_sections = markdown_source_sections(&markdown_body);
    let source_map = source_map_prompt(&source_sections);

    emitter.emit(
        "✅ 문서 구조 분석 완료",
        Some(format!("소스 섹션 {}개", source_sections.len())),
    );

    let prompt = if is_existing_draft {
        format!(
            "Revise an existing MarkMind Markdown slide draft. The hidden `markmind:slide-draft` marker was detected, so this is a revision pass, not a new draft pass.\n\nPrimary source for this run:\n- Treat `<existing_slide_draft>` as the current deck manuscript.\n- Apply Draft revision mode and Extra instructions before considering broad regeneration.\n- Preserve useful user edits already present in the draft.\n\nRequired output contract:\n- Markdown only.\n- Return the full revised deck, not a patch and not a summary.\n- Preserve the existing slide separator convention: separate slides with a line containing only `---`.\n- Preserve slide order, slide count, headings, images, tables, code fences, and comments unless Draft revision mode, slide count hint, or Extra instructions clearly asks to change them.\n- Apply the user's detailed instruction strongly, especially emphasis, rewrite, tone, expansion, trimming, reordering, or comment requests.\n- If Draft revision mode says to preserve structure, make localized edits instead of rewriting the whole deck.\n- If Draft revision mode says to restructure, improve flow while keeping source facts and existing useful slide material.\n- Do not output slide JSON, speaker layout JSON, design tokens, implementation notes, or the hidden `markmind:slide-draft` marker.\n- Keep each slide focused on one message. Prefer short bullets over copied paragraphs.\n- When a slide has multiple local topics, use Markdown subheadings (`###`) for each topic and separate groups with blank lines: subheading, related bullets/text, blank line, next subheading. Do not put different subtopics in one continuous bullet list.\n- Follow the Draft comments option. If comments are enabled, proactively add useful `> 코멘트:` / `> 검토 필요:` / `> 추가 정보 필요:` blockquotes for questions, assumptions, missing evidence, and suggested refinements. If comments are disabled, keep the draft clean and omit unsupported details instead of adding comments.\n\n{}\n\n<existing_slide_draft>\n{}\n</existing_slide_draft>",
            opt_block,
            markdown_body
        )
    } else {
        format!(
            "Create a Markdown slide draft for MarkMind slideshow review mode. The user will review and edit this Markdown before exporting to PPTX.\n\nRequired output contract:\n- Markdown only.\n- Separate slides with a line containing only `---`.\n- Use standard Markdown blocks supported by the editor: headings, short paragraphs, bullet lists, tables, blockquotes, code fences, and images already present in the source.\n- Do not output slide JSON, speaker layout JSON, design tokens, implementation notes, or the hidden `markmind:slide-draft` marker.\n- Treat source IDs like S1, S2, and S3 as internal grounding IDs only. Do not print them and do not add visible `출처: S2` / `Source: S2` lines.\n- Convert the source into slide pages with a presentation narrative. Avoid one slide per source heading unless that is genuinely the best structure.\n- Keep each slide focused on one message. Prefer short bullets over copied paragraphs.\n- When a slide has multiple local topics, use Markdown subheadings (`###`) for each topic and separate groups with blank lines: subheading, related bullets/text, blank line, next subheading. Do not put different subtopics in one continuous bullet list.\n- Follow the Draft comments option. If comments are enabled, proactively add useful `> 코멘트:` / `> 검토 필요:` / `> 추가 정보 필요:` blockquotes for questions, assumptions, missing evidence, and suggested refinements. If comments are disabled, keep the draft clean and omit unsupported details instead of adding comments.\n\n{}\n\n{}\n\n{}",
            opt_block,
            outline_block,
            source_map
        )
    };
    emitter.emit(
        if is_existing_draft {
            "✅ 슬라이드 초안 수정 요청 준비 완료"
        } else {
            "✅ 슬라이드 초안 작성 요청 준비 완료"
        },
        Some(format!("소스 섹션 {}개", source_sections.len())),
    );

    let draft_raw = call_slides_llm_with_progress(
        &emitter,
        "slide-draft-llm",
        if is_existing_draft {
            "⏳ AI가 슬라이드 초안을 수정하는 중…"
        } else {
            "⏳ AI가 슬라이드 초안을 작성하는 중…"
        },
        if is_existing_draft {
            "✅ 슬라이드 초안 수정 완료"
        } else {
            "✅ 슬라이드 초안 작성 완료"
        },
        company,
        auth,
        model.as_deref(),
        SLIDE_MARKDOWN_DRAFT_SYSTEM,
        &prompt,
        None,
        SLIDE_MARKDOWN_DRAFT_MAX_TOKENS,
    )
    .await?;

    emitter.emit("🔍 응답 정리 중...", None);
    let cleaned = strip_internal_source_labels(&strip_outer_markdown_fence(&draft_raw));
    emitter.emit("✅ 슬라이드 초안 준비 완료", None);
    Ok(cleaned)
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
            anthropic::generate_text(
                ClaudeAuth::Subscription(&token),
                model_id,
                &prompt,
                Some(opts),
            )
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
        None,
    )
    .await
    .map(|r| r.text)
    .map_err(err_to_string)
}

// ─── Gemini 구독(Antigravity CLI) 텍스트 생성 ───────────────────────────────
//
// `agy` CLI 를 PTY 로 호출한다(비TTY 출력 버그 회피). 인증은 agy 가 macOS Keychain
// (Antigravity IDE 공유)에서 읽으므로 토큰을 직접 다루지 않는다. model 은 agy 모델명.
#[tauri::command]
pub async fn ai_generate_gemini_agy(
    system: Option<String>,
    prompt: String,
    model: String,
) -> Result<String, String> {
    use super::llm::gemini_agy;
    gemini_agy::generate_text(&model, system.as_deref(), &prompt).await
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
    openai_api::generate_text(&key, &model, system.as_deref(), &prompt, None)
        .await
        .map(|r| r.text)
        .map_err(err_to_string)
}

// ─── Grok(xAI) API 키 텍스트 생성 ──────────────────────────────────────────
//
// OpenAI 호환 chat completions(api.x.ai). React AI 모드가 Grok + API 키 선택 시 사용.
// 구독(Grok Build CLI 토큰) 경로와 별개. grok 모듈은 String 에러를 직접 반환.
#[tauri::command]
pub async fn ai_generate_grok(
    system: Option<String>,
    prompt: String,
    model: String,
    grok_auth: String,
) -> Result<String, String> {
    let key = grok_bearer(&grok_auth)?;
    super::llm::grok::generate_text(&key, &model, system.as_deref(), &prompt).await
}

/// Grok 호출에 쓸 Bearer 토큰 — 구독(auth.json OAuth) 또는 API 키(Keychain).
fn grok_bearer(grok_auth: &str) -> Result<String, String> {
    use super::keychain::{get_key, Provider};
    if grok_auth == "subscription" {
        crate::subscription_auth::read_grok_token()
    } else {
        get_key(Provider::Grok)
            .map_err(err_to_string)?
            .ok_or_else(|| "Grok API 키가 없습니다. Settings 에서 등록하세요.".to_string())
    }
}

// ─── 이미지 생성 (Gemini 3.1 Flash Image / OpenAI gpt-image-1) ──────────────
//
// React AI "이미지 생성" 모드. 키는 기존 Settings(Keychain)의 gemini/openai 를 재사용한다
// (새 키 입력 UI 없음). 참조 이미지는 data URL 배열로 전달하고, 반환은 base64 data URL
// 배열(개수 1)로 정규화 — 프론트의 삽입/저장 코드가 공급사와 무관하게 공통 동작한다.
// WKWebView 의 fetch CORS 제약을 피하려 네이티브 HTTP(reqwest) 경유한다.
#[tauri::command]
pub async fn generate_image_gemini(
    model: String,
    prompt: String,
    aspect_ratio: String,
    resolution: String,
    reference_images: Vec<String>,
) -> Result<Vec<String>, String> {
    use super::keychain::{get_key, Provider};
    use super::llm::image_gen;
    let key = get_key(Provider::Gemini)
        .map_err(err_to_string)?
        .ok_or_else(|| "Gemini API 키가 없습니다. Settings 에서 등록하세요.".to_string())?;
    image_gen::generate_gemini(
        &key,
        &model,
        &prompt,
        &aspect_ratio,
        &resolution,
        &reference_images,
    )
    .await
}

#[tauri::command]
pub async fn generate_image_openai(
    model: String,
    prompt: String,
    aspect_ratio: String,
    resolution: String,
    quality: String,
    reference_images: Vec<String>,
) -> Result<Vec<String>, String> {
    use super::keychain::{get_key, Provider};
    use super::llm::image_gen;
    let key = get_key(Provider::Openai)
        .map_err(err_to_string)?
        .ok_or_else(|| "OpenAI API 키가 없습니다. Settings 에서 등록하세요.".to_string())?;
    image_gen::generate_openai(
        &key,
        &model,
        &prompt,
        &aspect_ratio,
        &resolution,
        &quality,
        &reference_images,
    )
    .await
}

// ─── ChatGPT(Codex 구독) 이미지 생성 ────────────────────────────────────────
//
// 본인 Codex CLI 로그인 토큰으로 구독 이미지 생성(Responses API + image_generation 툴).
// codex backend 는 size/quality 를 무시(항상 1254x1254/low, 실측 2026-06-19)하므로 보내지
// 않는다. 비율은 프론트가 프롬프트로 후처리("image ratio of 16:9"), 품질 UI 는 숨긴다.
// 참조 이미지도 codex 경로 미지원. 반환 형식은 API 키 경로와 동일(data URL).
#[tauri::command]
pub async fn generate_image_codex(model: String, prompt: String) -> Result<Vec<String>, String> {
    use super::llm::openai_codex;
    let tokens = crate::subscription_auth::read_codex_tokens()?;
    openai_codex::generate_image(
        &tokens.access_token,
        tokens.account_id.as_deref(),
        &model,
        &prompt,
    )
    .await
}

// ─── Grok(xAI) 이미지 생성 ──────────────────────────────────────────────────
//
// grok-imagine-*(api.x.ai/v1/images/generations). 비율·해상도(1k/2k)를 직접 받아
// gpt-image 처럼 size 환산이 필요 없다. 참조 이미지는 grok-imagine 미지원이라 받지 않는다.
#[tauri::command]
pub async fn generate_image_grok(
    model: String,
    prompt: String,
    aspect_ratio: String,
    resolution: String,
    grok_auth: String,
) -> Result<Vec<String>, String> {
    let key = grok_bearer(&grok_auth)?;
    super::llm::grok::generate_image(&key, &model, &prompt, &aspect_ratio, &resolution).await
}

// ─── 화자 라벨 후처리 (STT 결과 정리용) ─────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn markdown_source_sections_preserve_heading_paths() {
        let md = [
            "---",
            "title: Demo",
            "---",
            "# Strategy",
            "opening",
            "```",
            "## not a heading",
            "```",
            "## Problem",
            "market is fragmented",
            "### Evidence",
            "- duplicate work",
            "## Solution",
            "shared deck pipeline",
        ]
        .join("\n");
        let sections = markdown_source_sections(&md);
        let titles = sections
            .iter()
            .map(|s| s.title.as_str())
            .collect::<Vec<_>>();

        assert_eq!(titles, vec!["Strategy", "Problem", "Evidence", "Solution"]);
        assert_eq!(sections[1].level, 2);
        assert_eq!(sections[1].section_path, vec!["Strategy"]);
        assert_eq!(sections[2].section_path, vec!["Strategy", "Problem"]);
        assert!(sections[0].content.contains("## not a heading"));
    }

    #[test]
    fn source_map_prompt_exposes_ids_paths_and_content_signals() {
        let md = [
            "# Report",
            "## Metrics",
            "| A | B |",
            "| - | - |",
            "| 73% | win |",
            "![chart](chart.png)",
            "> cited signal",
        ]
        .join("\n");
        let sections = markdown_source_sections(&md);
        let prompt = source_map_prompt(&sections);

        assert!(prompt.contains("[S2]"));
        assert!(prompt.contains("path: Report"));
        assert!(prompt.contains("signals: table,image,quote,stat"));
        assert!(prompt.contains("73%"));
    }

    #[test]
    fn strip_outer_markdown_fence_removes_wrapping_fence_only() {
        let wrapped = "```markdown\n# Title\n\n---\n\n## Body\n```";
        assert_eq!(
            strip_outer_markdown_fence(wrapped),
            "# Title\n\n---\n\n## Body"
        );

        let plain = "# Title\n\n```ts\nconst x = 1;\n```";
        assert_eq!(strip_outer_markdown_fence(plain), plain);
    }

    #[test]
    fn strip_internal_source_labels_removes_only_source_ids() {
        let md = [
            "# Slide",
            "- 핵심 메시지 (출처: S2)",
            "- 실제 출처: 회사 보고서",
            "출처: S2, S3",
            "> Source: S4",
            "---",
            "## Next",
            "**출처:** S5",
        ]
        .join("\n");

        let cleaned = strip_internal_source_labels(&md);
        assert!(cleaned.contains("- 핵심 메시지"));
        assert!(cleaned.contains("- 실제 출처: 회사 보고서"));
        assert!(!cleaned.contains("출처: S2"));
        assert!(!cleaned.contains("Source: S4"));
        assert!(!cleaned.contains("S5"));
    }

    #[test]
    fn slide_draft_marker_detection_and_strip() {
        let md = "<!-- markmind:slide-draft v1 -->\n# Slide\nbody";
        assert!(has_slide_draft_marker(md));
        assert_eq!(strip_slide_draft_marker(md), "# Slide\nbody");

        let escaped = "&lt;!-- markmind:slide-draft v1 --&gt;\n# Slide";
        assert!(has_slide_draft_marker(escaped));
        assert_eq!(strip_slide_draft_marker(escaped), "# Slide");
    }

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
        std::fs::write(
            &ts_path,
            "**[00:00:05] 화자A:** 안녕\n**[00:00:10] 화자B:** 반갑",
        )
        .unwrap();
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
        assert!(
            labels.is_empty(),
            "metadata-only doc must not yield speakers"
        );
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
        assert!(
            ts_after.contains("김철수:**"),
            "ts file not renamed: {}",
            ts_after
        );
        assert!(
            cl_after.contains("김철수:**"),
            "clean file not renamed: {}",
            cl_after
        );
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
        regex::Regex::new(r"(?m)^\*\*(?:\[\d{1,2}:\d{2}(?::\d{2})?\]\s+)?([^\*\n:]{1,40}?):\*\*")?,
        // 2: [time] **LABEL**:   (timestamp + label-only bold, colon outside)
        regex::Regex::new(r"(?m)^\[\d{1,2}:\d{2}(?::\d{2})?\]\s+\*\*([^\*\n:]{1,40}?)\*\*\s*:\s")?,
        // 3: [time] LABEL:       (timestamp anchored, no bold)
        regex::Regex::new(r"(?m)^\[\d{1,2}:\d{2}(?::\d{2})?\]\s+([^\*\n:]{1,40}?):\s+\S")?,
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
    let re = TS_RE
        .get_or_init(|| regex::Regex::new(r"\[\d{1,2}:\d{2}(?::\d{2})?\]").expect("regex compile"));
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
        let label = labels
            .get(idx)
            .cloned()
            .unwrap_or_else(|| format!("파일 {}", idx + 1));
        combined.push_str(&format!("## 파일 {} — {}\n\n", idx + 1, label));
        combined.push_str(body.trim());
        combined.push_str("\n\n");
    }

    let safe_base = output_basename
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '_' || c == '-' || c == ' ' {
                c
            } else {
                '_'
            }
        })
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
pub fn rename_speakers(paths: Vec<String>, mappings: Vec<(String, String)>) -> Result<(), String> {
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
    let any_header_matches = |s: &str| -> bool { header_patterns.iter().any(|p| p.is_match(s)) };

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
                    matched_label = caps.name("label").map(|m| m.as_str().trim().to_string());
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
