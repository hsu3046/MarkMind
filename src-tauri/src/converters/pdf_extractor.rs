//! PDF → PNG 폴백 추출 (pdfium-render 사용).
//!
//! doc-converter src/utils/pdf-extractor.ts 포팅 (poppler 대신 pdfium-render).
//! Gemini File API 가 INVALID_ARGUMENT 를 던지는 PDF (구조 문제, 페이지 수 등) 에 사용.

use crate::converters::error::{ConverterError, ConverterResult};
use pdfium_render::prelude::*;
use std::path::PathBuf;

const RENDER_WIDTH_PX: u16 = 1240; // ≈ A4 150 DPI 너비
const RENDER_DPI: f32 = 150.0;

/// PDF 의 모든 페이지를 PNG 로 추출.
/// 반환: PNG 파일 경로 배열 (페이지 순서)
pub async fn extract_pdf_to_images(pdf_path: &std::path::Path) -> ConverterResult<Vec<PathBuf>> {
    let pdf_path = pdf_path.to_path_buf();
    // pdfium 호출은 blocking — tokio task::spawn_blocking 으로 격리
    tokio::task::spawn_blocking(move || extract_blocking(&pdf_path))
        .await
        .map_err(|e| ConverterError::Pdf(format!("spawn_blocking 실패: {}", e)))?
}

fn extract_blocking(pdf_path: &std::path::Path) -> ConverterResult<Vec<PathBuf>> {
    let pdfium = Pdfium::new(
        Pdfium::bind_to_system_library()
            .or_else(|_| Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path("./")))
            .map_err(|e| {
                ConverterError::Pdf(format!(
                    "pdfium 라이브러리 로드 실패 — libpdfium 이 설치/동봉되어 있는지 확인: {}",
                    e
                ))
            })?,
    );

    let document = pdfium
        .load_pdf_from_file(pdf_path, None)
        .map_err(|e| ConverterError::Pdf(format!("PDF 로드 실패: {}", e)))?;

    let out_dir = std::env::temp_dir().join(format!(
        "markmind_pdf_fallback_{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&out_dir)?;

    let render_config = PdfRenderConfig::new()
        .set_target_width(RENDER_WIDTH_PX as i32)
        .render_form_data(false);

    let mut paths = Vec::new();
    for (page_idx, page) in document.pages().iter().enumerate() {
        let bitmap = page
            .render_with_config(&render_config)
            .map_err(|e| ConverterError::Pdf(format!("페이지 {} 렌더링 실패: {}", page_idx + 1, e)))?;
        let image = bitmap.as_image();
        let target = out_dir.join(format!("page-{:04}.png", page_idx + 1));
        image
            .save(&target)
            .map_err(|e| ConverterError::Pdf(format!("PNG 저장 실패: {}", e)))?;
        paths.push(target);
    }

    let _ = RENDER_DPI; // 이름만 유지 — 실제 사이즈는 width 기반
    Ok(paths)
}

pub async fn cleanup_extracted_images(images: &[PathBuf]) {
    if let Some(first) = images.first() {
        if let Some(dir) = first.parent() {
            let _ = std::fs::remove_dir_all(dir);
        }
    }
}
