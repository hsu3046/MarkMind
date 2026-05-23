//! 회의록 파이프라인 — doc-converter src/services/meeting-notes-pipeline.ts 포팅.

use super::error::{ConverterError, ConverterResult};
use super::keychain::{get_key, Provider};
use super::llm::{anthropic, gemini};
use super::progress::ProgressEmitter;
use super::templates::{
    build_evidence_markdown, get_template, strip_frontmatter, EvidenceMeta,
};
use super::{
    conversions_dir, CostSummary, DetailLevel, EvidenceType, NotesProvider, MODEL_NOTES_CLAUDE,
    MODEL_NOTES_GEMINI,
};
use serde::{Deserialize, Serialize};

const MIN_TRANSCRIPT_CHARS: usize = 100;
const MAX_OUTPUT_TOKENS: u32 = 16384;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotesJobOptions {
    pub transcript: String,
    pub template: String,
    pub source: String,
    #[serde(default)]
    pub detail: DetailLevel,
    #[serde(default)]
    pub provider: NotesProvider,
    #[serde(rename = "outputDir", skip_serializing_if = "Option::is_none")]
    pub output_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotesJobResult {
    #[serde(rename = "markdownPath")]
    pub markdown_path: String,
    #[serde(rename = "templateName")]
    pub template_name: String,
    pub cost: CostSummary,
}

pub async fn run(
    emitter: &ProgressEmitter,
    opts: NotesJobOptions,
    app: &tauri::AppHandle,
) -> ConverterResult<NotesJobResult> {
    let body = strip_frontmatter(&opts.transcript);
    let body = body.trim();
    if body.chars().count() < MIN_TRANSCRIPT_CHARS {
        return Err(ConverterError::Validation(format!(
            "녹취록이 너무 짧습니다 ({}자). 최소 {}자 필요.",
            body.chars().count(),
            MIN_TRANSCRIPT_CHARS
        )));
    }

    emitter.emit("📑 템플릿 로딩 중...", Some(opts.template.clone()));
    let template = get_template(app, &opts.template)?;
    // doc-converter meeting-notes-pipeline.ts 라인 63 동일 포맷 (lowercase + 한국어 detail label)
    let source_label = if matches!(
        template.info.source,
        crate::converters::templates::TemplateSource::Builtin
    ) {
        "기본"
    } else {
        "사용자 정의"
    };
    emitter.emit(
        format!(
            "✅ 템플릿: {} · 상세도: {} · 모델: {}",
            template.info.name, opts.detail, opts.provider
        ),
        Some(source_label.to_string()),
    );

    let prompt = format!(
        "## 미팅 녹취록\n{body}\n\n## 작업 지시 (템플릿)\n{template_body}\n\n## 상세도 지시\n{detail}\n\n## 출력 규칙\n- 위 템플릿 구조의 마크다운 본문만 출력 (frontmatter, 코드블록 감싸기 금지)\n- 원본에 없는 내용은 만들지 마세요 (할루시네이션 금지)\n- 단, 다음은 적극 보존: 화자명, 인물/회사/제품/서비스 고유명사, 숫자, 날짜, 기간, 금액\n- 핵심 발언 인용은 transcript 원문에 가깝게 (의미 변경 X)\n- 한국어로 작성",
        body = body,
        template_body = template.body,
        detail = opts.detail.instruction(),
    );

    let (model, generate_result) = match opts.provider {
        NotesProvider::Claude => {
            let api_key = get_key(Provider::Claude)?
                .ok_or(ConverterError::MissingApiKey("Claude"))?;
            emitter.emit(
                "🧠 미팅 노트 생성 중...",
                Some(format!("{} · max {} tok", MODEL_NOTES_CLAUDE, MAX_OUTPUT_TOKENS)),
            );
            let start = std::time::Instant::now();
            let result = anthropic::generate_text(
                &api_key,
                MODEL_NOTES_CLAUDE,
                &prompt,
                Some(anthropic::ClaudeOptions {
                    max_output_tokens: Some(MAX_OUTPUT_TOKENS),
                    system: None,
                }),
            )
            .await?;
            emitter.emit(
                format!("✅ 노트 생성 완료 ({:.1}초)", start.elapsed().as_secs_f64()),
                Some(format!("{} 토큰 출력", format_num(result.usage.output_tokens as usize))),
            );
            (MODEL_NOTES_CLAUDE, result)
        }
        NotesProvider::Gemini => {
            let api_key = get_key(Provider::Gemini)?
                .ok_or(ConverterError::MissingApiKey("Gemini"))?;
            emitter.emit(
                "🧠 미팅 노트 생성 중...",
                Some(format!("{} · max {} tok", MODEL_NOTES_GEMINI, MAX_OUTPUT_TOKENS)),
            );
            let start = std::time::Instant::now();
            let result = gemini::generate_text(
                &api_key,
                MODEL_NOTES_GEMINI,
                &prompt,
                vec![],
                Some(gemini::GenerationConfig {
                    max_output_tokens: Some(MAX_OUTPUT_TOKENS),
                    temperature: None,
                }),
            )
            .await?;
            emitter.emit(
                format!("✅ 노트 생성 완료 ({:.1}초)", start.elapsed().as_secs_f64()),
                Some(format!("{} 토큰 출력", format_num(result.usage.output_tokens as usize))),
            );
            (MODEL_NOTES_GEMINI, result)
        }
    };

    if generate_result.text.trim().is_empty() {
        return Err(ConverterError::Validation(
            "LLM 응답이 비어있습니다. 다시 시도해주세요.".into(),
        ));
    }

    let meta = EvidenceMeta::new(EvidenceType::MeetingNote, opts.source.clone())
        .with_template(Some(template.info.name.clone()));
    let markdown = build_evidence_markdown(&meta, generate_result.text.trim());

    let target_dir = opts
        .output_dir
        .as_deref()
        .map(std::path::PathBuf::from)
        .unwrap_or_else(conversions_dir);
    std::fs::create_dir_all(&target_dir)?;
    let safe_name = sanitize_filename(&opts.source);
    let target_path = unique_path(&target_dir, &format!("회의록_{}", safe_name), "md");
    std::fs::write(&target_path, &markdown)?;
    // doc-converter 와 동일: 저장 step 은 표시 안 함 (결과 카드의 경로로 충분)

    let _ = model; // 단일 호출이라 cost는 generate_result.usage 그대로

    Ok(NotesJobResult {
        markdown_path: target_path.to_string_lossy().into_owned(),
        template_name: template.info.name,
        cost: CostSummary::from_usages(vec![generate_result.usage]),
    })
}

/// 1234567 → "1,234,567" (doc-converter `.toLocaleString()` 대응)
fn format_num(n: usize) -> String {
    let s = n.to_string();
    let bytes = s.as_bytes();
    let mut out = String::with_capacity(s.len() + s.len() / 3);
    let len = bytes.len();
    for (i, b) in bytes.iter().enumerate() {
        if i > 0 && (len - i) % 3 == 0 {
            out.push(',');
        }
        out.push(*b as char);
    }
    out
}

fn sanitize_filename(name: &str) -> String {
    let base = std::path::Path::new(name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(name);
    let cleaned: String = base
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '_' || c == '-' || c == ' ' || c == '.' {
                c
            } else {
                '_'
            }
        })
        .collect();
    cleaned.trim().to_string()
}

fn unique_path(dir: &std::path::Path, stem: &str, ext: &str) -> std::path::PathBuf {
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
