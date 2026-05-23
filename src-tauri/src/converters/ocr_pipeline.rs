//! OCR 파이프라인 — doc-converter src/services/ocr-pipeline.ts 포팅.
//!
//! - Pass 1: gemini-3.1-flash-image-preview 로 원본 추출 ([?] 마킹)
//! - Pass 2: gemini-3-pro-image-preview 로 정제 + Markdown 구조화
//! - PDF: File API 우선, INVALID_ARGUMENT 시 pdfium-render 폴백 후 inline base64

use super::error::{ConverterError, ConverterResult};
use super::keychain::{get_key, Provider};
use super::llm::gemini;
use super::pdf_extractor::{cleanup_extracted_images, extract_pdf_to_images};
use super::progress::ProgressEmitter;
use super::templates::{build_evidence_markdown, EvidenceMeta};
use super::{
    conversions_dir, CostSummary, EvidenceType, UsageInfo, MODEL_OCR_ENHANCE, MODEL_OCR_FAST,
};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcrJobOptions {
    pub file_path: String,
    #[serde(rename = "originalName", skip_serializing_if = "Option::is_none")]
    pub original_name: Option<String>,
    #[serde(default)]
    pub quick: bool,
    #[serde(rename = "outputDir", skip_serializing_if = "Option::is_none")]
    pub output_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcrJobResult {
    #[serde(rename = "markdownPath")]
    pub markdown_path: String,
    pub cost: CostSummary,
}

pub async fn run(emitter: &ProgressEmitter, opts: OcrJobOptions) -> ConverterResult<OcrJobResult> {
    let api_key = get_key(Provider::Gemini)?
        .ok_or(ConverterError::MissingApiKey("Gemini"))?;
    let file_path = Path::new(&opts.file_path).to_path_buf();
    let file_name = opts
        .original_name
        .clone()
        .unwrap_or_else(|| file_path.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string());
    let is_pdf = file_path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.eq_ignore_ascii_case("pdf"))
        .unwrap_or(false);
    let file_type = if is_pdf { "PDF" } else { "이미지" };
    let total_passes = if opts.quick { 1 } else { 2 };
    emitter.emit(
        format!("📤 파일 수신 완료 — {}", file_name),
        Some(format!("형식: {} | {}-Pass 모드", file_type, total_passes)),
    );

    let mut usages: Vec<UsageInfo> = Vec::new();
    let pass1_prompt = if is_pdf {
        PASS1_PROMPT_PDF
    } else {
        PASS1_PROMPT_IMAGE
    };

    // ─── Pass 1 ─── (doc-converter 와 동일: PDF/이미지 메시지 분리)
    let pass1_label = if is_pdf {
        format!("🔍 Pass 1/{} — 전체 페이지 텍스트 추출 중...", total_passes)
    } else {
        format!("🔍 Pass 1/{} — 텍스트 추출 중...", total_passes)
    };
    emitter.emit(pass1_label.clone(), Some(MODEL_OCR_FAST.into()));
    let start1 = std::time::Instant::now();
    let raw_text = if is_pdf {
        run_pdf_pass(&api_key, MODEL_OCR_FAST, pass1_prompt, &file_path, emitter, &mut usages).await?
    } else {
        run_image_pass(&api_key, MODEL_OCR_FAST, pass1_prompt, &file_path, &mut usages).await?
    };
    let last_in = usages.last().map(|u| u.input_tokens).unwrap_or(0);
    emitter.emit(
        format!("✅ Pass 1 완료 ({:.1}초)", start1.elapsed().as_secs_f64()),
        Some(format!("{} 토큰 입력", format_number(last_in as usize))),
    );
    if is_pdf {
        log_page_count(&raw_text, "Pass 1", emitter);
    }

    // ─── Pass 2 ───
    let body = if opts.quick {
        raw_text
    } else {
        let pass2_prompt = if is_pdf {
            format!(
                "{header}\n\n## 1차 추출 텍스트:\n{raw}\n\n{body}",
                header = PASS2_PROMPT_PDF_HEADER,
                raw = raw_text,
                body = PASS2_PROMPT_PDF_BODY,
            )
        } else {
            format!(
                "{header}\n\n## 1차 추출 텍스트:\n{raw}\n\n{body}",
                header = PASS2_PROMPT_IMAGE_HEADER,
                raw = raw_text,
                body = PASS2_PROMPT_IMAGE_BODY,
            )
        };
        emitter.emit(
            format!("🧠 Pass 2/{} — 문맥 보강 + Markdown 구조화 중...", total_passes),
            Some(MODEL_OCR_ENHANCE.into()),
        );
        let start2 = std::time::Instant::now();
        let result = if is_pdf {
            run_pdf_pass(&api_key, MODEL_OCR_ENHANCE, &pass2_prompt, &file_path, emitter, &mut usages).await?
        } else {
            run_image_pass(&api_key, MODEL_OCR_ENHANCE, &pass2_prompt, &file_path, &mut usages).await?
        };
        let last_in = usages.last().map(|u| u.input_tokens).unwrap_or(0);
        emitter.emit(
            format!("✅ Pass 2 완료 ({:.1}초)", start2.elapsed().as_secs_f64()),
            Some(format!("{} 토큰 입력", format_number(last_in as usize))),
        );
        if is_pdf {
            log_page_count(&result, "Pass 2", emitter);
        }
        result
    };

    emitter.emit("💾 Markdown 저장 중...", None);

    let meta = EvidenceMeta::new(EvidenceType::Ocr, file_name.clone());
    let markdown = build_evidence_markdown(&meta, body.trim());

    let target_dir = opts
        .output_dir
        .as_deref()
        .map(std::path::PathBuf::from)
        .unwrap_or_else(conversions_dir);
    std::fs::create_dir_all(&target_dir)?;
    let stem = std::path::Path::new(&file_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("ocr")
        .to_string();
    let target_path = unique_path(&target_dir, &format!("OCR_{}", sanitize(&stem)), "md");
    std::fs::write(&target_path, &markdown)?;
    // doc-converter 와 동일: 저장 완료 step 은 표시하지 않음

    Ok(OcrJobResult {
        markdown_path: target_path.to_string_lossy().into_owned(),
        cost: CostSummary::from_usages(usages),
    })
}

/// 인라인 OCR — 단일 이미지, quick 모드, .md 저장 안 함. 결과 문자열만 반환.
pub async fn run_inline(
    emitter: &ProgressEmitter,
    image_path: &str,
) -> ConverterResult<String> {
    let api_key = get_key(Provider::Gemini)?
        .ok_or(ConverterError::MissingApiKey("Gemini"))?;
    let path = std::path::Path::new(image_path).to_path_buf();
    emitter.emit("🔍 이미지 텍스트 추출 중...", Some(MODEL_OCR_FAST.into()));
    let mut usages = Vec::new();
    let text = run_image_pass(&api_key, MODEL_OCR_FAST, PASS1_PROMPT_IMAGE, &path, &mut usages).await?;
    emitter.emit("✅ 완료", None);
    Ok(text.trim().to_string())
}

// ─── 내부: 이미지 / PDF 단일 패스 실행 ───

async fn run_image_pass(
    api_key: &str,
    model: &str,
    prompt: &str,
    path: &std::path::Path,
    usages: &mut Vec<UsageInfo>,
) -> ConverterResult<String> {
    let buffer = tokio::fs::read(path).await?;
    let mime = guess_mime(path);
    let base64 = base64::engine::general_purpose::STANDARD.encode(&buffer);
    let result = gemini::generate_text(
        api_key,
        model,
        prompt,
        vec![gemini::InlineData {
            mime_type: mime.to_string(),
            data_base64: base64,
        }],
        None,
    )
    .await?;
    usages.push(result.usage);
    Ok(result.text)
}

async fn run_pdf_pass(
    api_key: &str,
    model: &str,
    prompt: &str,
    pdf_path: &std::path::Path,
    emitter: &ProgressEmitter,
    usages: &mut Vec<UsageInfo>,
) -> ConverterResult<String> {
    // 1차 시도: File API
    let emitter_clone_step = format!("📡 Gemini 처리: {}", model);
    let progress_cb_step = emitter_clone_step.clone();
    let job_id = emitter.job_id().to_string();
    let app_handle: Option<tauri::AppHandle> = None;
    let _ = (app_handle, job_id, progress_cb_step);

    // on_progress closure — 내부 메시지를 변환 윈도우에 추가 step 으로 보냄
    // (closure 가 Sync 일 필요가 있어 emitter 의 emit 만 캡처)
    let emitter_for_cb = emitter;
    let cb = |msg: &str| emitter_for_cb.emit(msg.to_string(), None);

    match gemini::generate_text_with_file_api(
        api_key,
        model,
        prompt,
        pdf_path,
        "application/pdf",
        Some(&cb),
    )
    .await
    {
        Ok(result) => {
            usages.push(result.usage);
            Ok(result.text)
        }
        Err(ConverterError::InvalidArgument) => {
            // 폴백: 로컬 pdfium 으로 PNG 추출 → inline base64
            // doc-converter ocr-pipeline.ts 라인 123 동일 메시지
            emitter.emit(
                "⚠️ Gemini 기본 처리 한계 초과. 로컬 분할 변환(Fallback)으로 재시도 중...",
                Some(model.into()),
            );
            let images = extract_pdf_to_images(pdf_path).await?;
            emitter.emit(
                format!("✅ 로컬 변환 완료 ({}장). 텍스트 추출 시작...", images.len()),
                Some(model.into()),
            );
            let mut inline_data = Vec::with_capacity(images.len());
            for img in &images {
                let buf = tokio::fs::read(img).await?;
                inline_data.push(gemini::InlineData {
                    mime_type: "image/png".into(),
                    data_base64: base64::engine::general_purpose::STANDARD.encode(&buf),
                });
            }
            let result = gemini::generate_text(api_key, model, prompt, inline_data, None).await;
            cleanup_extracted_images(&images).await;
            let result = result?;
            usages.push(result.usage);
            Ok(result.text)
        }
        Err(e) => Err(e),
    }
}

/// doc-converter ocr-pipeline.ts logPageCount 포팅:
/// OCR 결과의 '---' 구분자 수로 페이지 수를 추정해 경고/정보 step 으로 표시.
fn log_page_count(text: &str, pass_label: &str, emitter: &ProgressEmitter) {
    let separator_count = text.lines().filter(|l| l.trim() == "---").count();
    let char_count = text.chars().count();
    if separator_count == 0 {
        emitter.emit(
            format!("⚠️  {}: 페이지 구분자(---) 없음", pass_label),
            Some("1페이지만 처리됐을 수 있습니다. 원본 PDF 페이지 수를 확인해주세요.".into()),
        );
    } else {
        let estimated_pages = separator_count + 1;
        emitter.emit(
            format!(
                "📊 {}: {}페이지 감지 (구분자 {}개)",
                pass_label, estimated_pages, separator_count
            ),
            Some(format!("총 {}자", format_number(char_count))),
        );
    }
}

/// 1234567 → "1,234,567"
fn format_number(n: usize) -> String {
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

fn guess_mime(path: &std::path::Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "heic" => "image/heic",
        "heif" => "image/heif",
        "gif" => "image/gif",
        _ => "application/octet-stream",
    }
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

// ─── 프롬프트 (doc-converter 원본 그대로) ───

const PASS1_PROMPT_PDF: &str = "이 PDF의 모든 페이지에서 손글씨 텍스트를 추출해주세요.

## 규칙:
- 모든 페이지를 순서대로 처리해주세요.
- 페이지 구분은 \"---\" (수평선)으로 표시해주세요.
- 손글씨 한글을 최대한 정확히 인식해주세요.
- 인식이 불확실한 글자는 [?]로 표시해주세요.
- **단락 사이에 빈 줄(\\n\\n)** 을 반드시 넣어주세요.
- 한 문장/줄이 끝나면 새 줄에서 시작해주세요.
- 텍스트만 출력하세요. 추가 설명은 포함하지 마세요.";

const PASS1_PROMPT_IMAGE: &str = "이 이미지에서 손글씨 텍스트를 추출해주세요.

## 규칙:
- 손글씨 한글을 최대한 정확히 인식해주세요.
- 인식이 불확실한 글자는 [?]로 표시해주세요.
- 반드시 **단락 사이에 빈 줄(\\n\\n)** 을 넣어주세요.
- 한 문장/줄이 끝나면 새 줄에서 시작해주세요.
- 텍스트만 출력하세요. 설명, 제목, 코드 블록은 포함하지 마세요.";

const PASS2_PROMPT_PDF_HEADER: &str = "아래는 PDF에서 1차 OCR로 추출된 텍스트입니다.\n원본 PDF를 직접 보고 다음을 수행해주세요:";

const PASS2_PROMPT_PDF_BODY: &str = "## 작업:
1. 한글 맞춤법/문법 교정
2. [?] 부분을 문맥으로 추론하여 복원
3. 전체 내용을 Markdown으로 구조화
4. 페이지 구분(\"---\")은 유지
5. 원본 의미 변경 금지

## 출력 형식 규칙:
- 단락 사이에 반드시 빈 줄(\\n\\n)을 삽입
- 목록 항목은 각각 새 줄로 작성
- 코드 블록(백틱)으로 감싸지 말 것
- Markdown 본문만 출력";

const PASS2_PROMPT_IMAGE_HEADER: &str = "아래는 손글씨 이미지에서 1차 OCR로 추출된 텍스트입니다.\n원본 이미지를 직접 보고 다음을 수행해주세요:";

const PASS2_PROMPT_IMAGE_BODY: &str = "## 작업:
1. 한글 맞춤법/문법 교정
2. [?] 부분을 문맥으로 추론하여 복원
3. Markdown으로 구조화 (제목, 본문, 목록 등 적절히 사용)
4. 원본 의미 변경 금지

## 출력 형식 규칙:
- 단락 사이에 반드시 빈 줄(\\n\\n)을 삽입
- 목록 항목은 각각 새 줄에 작성
- 코드 블록(백틱)으로 감싸지 말 것
- Markdown 본문만 출력";
