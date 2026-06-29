// macOS native PDF export — NSPrintOperation + jobDisposition.save + dialog 숨김.
//
// 옵션 비교 (PR #26 검증 사고):
//   - 옵션 A: NSPrintOperation modal dialog — @media print CSS 자동 적용. 단
//     인쇄 dialog 표시 + paperSize 명시해도 좌측 비대칭 잔존 가능
//   - 옵션 B1: WKWebView.createPDFWithConfiguration — dialog 없음. 단 @media
//     print CSS 미적용 → 단순 viewport snapshot (toolbar/sidebar 그대로 capture)
//   - **최종 옵션 (이 코드)**: NSPrintOperation + jobDisposition.save +
//     showsPrintPanel=false. paginated print pipeline 그대로 사용해 @media print
//     CSS 자동 적용 + dialog 없이 우리 path 로 PDF 자동 저장
//
// 핵심 (workflow w0p1bkwxy 검증):
//   - NSPrintInfo.dictionary[NSPrintJobDisposition] = NSPrintSaveJob
//   - NSPrintInfo.dictionary[NSPrintJobSavingURL] = file:///path/to.pdf (NSURL)
//   - NSPrintOperation.showsPrintPanel = false / showsProgressPanel = false
//   - runOperationModalForWindow(_, None delegate, None selector, null) — delegate
//     None 이면 fire-and-forget (UI 없이 비동기). runOperation() 은 Big Sur
//     이후 빈 PDF 버그 (Apple FB8918124) 라 사용 X

use tauri::{command, WebviewWindow};
use tokio::sync::oneshot;

#[cfg(target_os = "macos")]
use std::{
    path::PathBuf,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

#[cfg(target_os = "macos")]
const MM_TO_PT: f64 = 72.0 / 25.4;
#[cfg(target_os = "macos")]
const PDF_MARGIN_X_MM: f64 = 8.0;
#[cfg(target_os = "macos")]
const PDF_MARGIN_TOP_MM: f64 = 12.0;
#[cfg(target_os = "macos")]
const PDF_MARGIN_BOTTOM_MM: f64 = 16.0;
#[cfg(target_os = "macos")]
const PDF_PAGE_NUMBER_BOTTOM_MM: f32 = 5.0;
#[cfg(target_os = "macos")]
const PDF_PAGE_NUMBER_FONT_PT: f32 = 8.5;

#[command]
pub async fn export_pdf(window: WebviewWindow, path: String) -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, path);
        return Err("export_pdf is macOS-only".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        let (tx, rx) = oneshot::channel::<Result<(), String>>();
        let raw_pdf_path = export_tmp_path(&path);
        let raw_pdf_path = raw_pdf_path
            .to_str()
            .ok_or_else(|| "임시 PDF 경로가 UTF-8 이 아닙니다.".to_string())?
            .to_string();
        let _ = tokio::fs::remove_file(&raw_pdf_path).await;
        let path_clone = raw_pdf_path.clone();

        window
            .with_webview(move |pw| {
                // with_webview 클로저 = macOS 메인 스레드 보장.
                let res: Result<(), String> = (|| unsafe {
                    use objc2::rc::Retained;
                    use objc2::runtime::{AnyObject, ProtocolObject};
                    use objc2::MainThreadMarker;
                    use objc2_app_kit::{
                        NSPrintInfo, NSPrintJobSavingURL, NSPrintSaveJob, NSWindow,
                    };
                    use objc2_foundation::{NSSize, NSString, NSURL};
                    use objc2_web_kit::WKWebView;

                    let _mtm = MainThreadMarker::new_unchecked();

                    // Tauri 의 +1 retain 흡수.
                    let wk: Retained<WKWebView> = Retained::from_raw(pw.inner().cast())
                        .ok_or_else(|| "WKWebView ptr is null".to_string())?;
                    let ns_window: Retained<NSWindow> =
                        Retained::from_raw(pw.ns_window().cast())
                            .ok_or_else(|| "NSWindow ptr is null".to_string())?;
                    let _mgr: Option<Retained<AnyObject>> =
                        Retained::from_raw(pw.controller().cast());

                    // NSPrintInfo 새 인스턴스 (sharedPrintInfo 잔여 상태 회피).
                    let info = NSPrintInfo::new();

                    // 용지와 native margin hint 는 NSPrintInfo 에 맞추고, 실제 콘텐츠
                    // 반복 여백은 print CSS 의 @page margin 과 같은 값으로 둔다.
                    // body padding 은 multi-page 에서 첫/끝 페이지에만 치우칠 수 있다.
                    info.setPaperSize(NSSize::new(595.2755905511812, 841.8897637795277));
                    info.setTopMargin(PDF_MARGIN_TOP_MM * MM_TO_PT);
                    info.setRightMargin(PDF_MARGIN_X_MM * MM_TO_PT);
                    info.setBottomMargin(PDF_MARGIN_BOTTOM_MM * MM_TO_PT);
                    info.setLeftMargin(PDF_MARGIN_X_MM * MM_TO_PT);
                    info.setHorizontallyCentered(false);
                    info.setVerticallyCentered(false);

                    // jobDisposition = save → PDF 저장 모드
                    info.setJobDisposition(NSPrintSaveJob);

                    // 저장 경로 (NSURL) 를 dictionary 에 set.
                    // NSPrintJobSavingURL key 는 NSString → ProtocolObject<NSCopying> 으로 캐스팅.
                    let ns_path = NSString::from_str(&path_clone);
                    let file_url = NSURL::fileURLWithPath(&ns_path);
                    let dict = info.dictionary();
                    let key = ProtocolObject::from_ref(NSPrintJobSavingURL);
                    dict.setObject_forKey(&file_url, key);

                    // WKWebView 의 paginated print operation 생성 — @media print
                    // CSS 자동 적용. WKPDFConfiguration 의 viewport snapshot 과
                    // 다른 경로.
                    let op = wk.printOperationWithPrintInfo(&info);

                    // Dialog 숨김 — PDF 자동 저장
                    op.setShowsPrintPanel(false);
                    op.setShowsProgressPanel(false);

                    // delegate=None / selector=None / contextInfo=null —
                    // fire-and-forget. UI 없이 비동기 실행. runOperation() 은
                    // Big Sur 이후 빈 PDF 버그 (FB8918124) 라 사용 X.
                    op.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
                        &ns_window,
                        None,
                        None,
                        std::ptr::null_mut(),
                    );

                    Ok(())
                })();
                let _ = tx.send(res);
            })
            .map_err(|e| format!("with_webview failed: {e}"))?;

        rx.await
            .map_err(|_| "with_webview closure dropped".to_string())??;

        wait_for_pdf_write_to_finish(&raw_pdf_path).await?;

        // WebKit 의 CSS page margin box(`@bottom-center`)는 앱 내 native print 에서
        // 안정적으로 출력되지 않는다. WebKit 출력은 임시 파일로 받은 뒤 PDFium 으로
        // 실제 text object 를 덧붙이고, 마지막에 최종 경로로 교체한다. PDFium 을
        // 사용할 수 없으면 CoreGraphics fallback 으로 페이지 번호 표시를 우선한다.
        let numbering_path = raw_pdf_path.clone();
        match tokio::task::spawn_blocking(move || add_page_numbers_to_pdf(&numbering_path)).await {
            Ok(Ok(())) => {}
            Ok(Err(err)) => log::warn!("PDF page number post-process skipped: {err}"),
            Err(err) => log::warn!("PDF page number post-process task failed: {err}"),
        }

        tokio::fs::rename(&raw_pdf_path, &path)
            .await
            .map_err(|err| format!("PDF 최종 저장 실패: {err}"))?;

        Ok(())
    }
}

#[cfg(target_os = "macos")]
async fn wait_for_pdf_write_to_finish(path: &str) -> Result<(), String> {
    let mut last_size = 0;
    let mut stable_ticks = 0;

    for _ in 0..300 {
        if let Ok(meta) = tokio::fs::metadata(path).await {
            let size = meta.len();
            if size > 0 && size == last_size {
                stable_ticks += 1;
                if stable_ticks >= 5 {
                    return Ok(());
                }
            } else {
                stable_ticks = 0;
                last_size = size;
            }
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    Err("PDF 저장 완료를 확인하지 못했습니다.".to_string())
}

#[cfg(target_os = "macos")]
fn add_page_numbers_to_pdf(path: &str) -> Result<(), String> {
    match add_page_numbers_to_pdf_with_pdfium(path) {
        Ok(()) => Ok(()),
        Err(pdfium_err) => {
            log::warn!(
                "PDFium page number post-process failed; falling back to CoreGraphics: {pdfium_err}"
            );
            add_page_numbers_to_pdf_with_core_graphics(path).map_err(|core_graphics_err| {
                format!("PDFium 실패: {pdfium_err}; CoreGraphics fallback 실패: {core_graphics_err}")
            })
        }
    }
}

#[cfg(target_os = "macos")]
fn add_page_numbers_to_pdf_with_pdfium(path: &str) -> Result<(), String> {
    use pdfium_render::prelude::*;

    let pdfium = Pdfium::new(
        Pdfium::bind_to_system_library()
            .or_else(|_| {
                Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path("./"))
            })
            .map_err(|err| format!("pdfium 로드 실패: {err}"))?,
    );
    let mut document = pdfium
        .load_pdf_from_file(path, None)
        .map_err(|err| format!("PDF 로드 실패: {err}"))?;
    let font = document.fonts_mut().helvetica();
    let font_size = PdfPoints::new(PDF_PAGE_NUMBER_FONT_PT);
    let y = PdfPoints::new(PDF_PAGE_NUMBER_BOTTOM_MM * MM_TO_PT as f32);

    document
        .pages()
        .watermark(|group, index, width, _height| {
            let mut page_number =
                PdfPageTextObject::new(&document, format!("{}", index + 1), font, font_size)?;
            page_number.set_fill_color(PdfColor::GREY_40)?;
            page_number.translate((width - page_number.width()?) / 2.0, y)?;
            group.push(&mut page_number.into())
        })
        .map_err(|err| format!("페이지 번호 삽입 실패: {err}"))?;

    let tmp_path = numbered_tmp_path(path);
    let _ = std::fs::remove_file(&tmp_path);
    document
        .save_to_file(&tmp_path)
        .map_err(|err| format!("번호 삽입 PDF 저장 실패: {err}"))?;
    std::fs::rename(&tmp_path, path).map_err(|err| format!("번호 삽입 PDF 교체 실패: {err}"))?;

    Ok(())
}

#[cfg(target_os = "macos")]
fn add_page_numbers_to_pdf_with_core_graphics(path: &str) -> Result<(), String> {
    use objc2_core_graphics::{
        CGContext, CGPDFBox, CGPDFContextClose, CGPDFContextCreateWithURL, CGPDFDocument,
    };

    let source_url = cf_url_from_path(path, false)?;
    let document = CGPDFDocument::with_url(Some(&source_url))
        .ok_or_else(|| "CoreGraphics PDF 로드 실패".to_string())?;
    let page_count = CGPDFDocument::number_of_pages(Some(&document));
    if page_count == 0 {
        return Err("CoreGraphics PDF 페이지가 없습니다.".to_string());
    }

    let tmp_path = numbered_tmp_path(path);
    let _ = std::fs::remove_file(&tmp_path);
    let tmp_path_string = tmp_path
        .to_str()
        .ok_or_else(|| "CoreGraphics 임시 PDF 경로가 UTF-8 이 아닙니다.".to_string())?
        .to_string();
    let output_url = cf_url_from_path(&tmp_path_string, false)?;
    let context = unsafe {
        CGPDFContextCreateWithURL(Some(&output_url), std::ptr::null(), None)
            .ok_or_else(|| "CoreGraphics PDF context 생성 실패".to_string())?
    };

    for index in 1..=page_count {
        let page = CGPDFDocument::page(Some(&document), index)
            .ok_or_else(|| format!("CoreGraphics PDF 페이지 {index} 로드 실패"))?;
        let media_box =
            objc2_core_graphics::CGPDFPage::box_rect(Some(&page), CGPDFBox::MediaBox);

        unsafe {
            CGContext::begin_page(Some(&context), &media_box);
        }

        CGContext::save_g_state(Some(&context));
        let rotation_angle = objc2_core_graphics::CGPDFPage::rotation_angle(Some(&page));
        let transform = objc2_core_graphics::CGPDFPage::drawing_transform(
            Some(&page),
            CGPDFBox::MediaBox,
            media_box,
            rotation_angle,
            true,
        );
        CGContext::concat_ctm(Some(&context), transform);
        CGContext::draw_pdf_page(Some(&context), Some(&page));
        CGContext::restore_g_state(Some(&context));

        draw_page_number_with_core_graphics(&context, &media_box, index);
        CGContext::end_page(Some(&context));
    }

    CGPDFContextClose(Some(&context));
    std::fs::rename(&tmp_path, path)
        .map_err(|err| format!("CoreGraphics 번호 삽입 PDF 교체 실패: {err}"))?;

    Ok(())
}

#[cfg(target_os = "macos")]
#[allow(deprecated)]
fn draw_page_number_with_core_graphics(
    context: &objc2_core_graphics::CGContext,
    media_box: &objc2_core_foundation::CGRect,
    page_number: usize,
) {
    use objc2_core_foundation::CGAffineTransform;
    use objc2_core_graphics::{CGContext, CGTextDrawingMode, CGTextEncoding};
    use std::os::raw::c_char;

    const HELVETICA: &[u8] = b"Helvetica\0";

    let label = page_number.to_string();
    let text_width = label.len() as f64 * PDF_PAGE_NUMBER_FONT_PT as f64 * 0.55;
    let x = media_box.origin.x + (media_box.size.width - text_width) / 2.0;
    let y = media_box.origin.y + PDF_PAGE_NUMBER_BOTTOM_MM as f64 * MM_TO_PT;

    CGContext::save_g_state(Some(context));
    CGContext::set_rgb_fill_color(Some(context), 0.4, 0.4, 0.4, 1.0);
    CGContext::set_text_matrix(
        Some(context),
        CGAffineTransform {
            a: 1.0,
            b: 0.0,
            c: 0.0,
            d: 1.0,
            tx: 0.0,
            ty: 0.0,
        },
    );
    CGContext::set_text_drawing_mode(Some(context), CGTextDrawingMode::Fill);
    unsafe {
        CGContext::select_font(
            Some(context),
            HELVETICA.as_ptr().cast::<c_char>(),
            PDF_PAGE_NUMBER_FONT_PT as f64,
            CGTextEncoding::EncodingMacRoman,
        );
        CGContext::show_text_at_point(
            Some(context),
            x,
            y,
            label.as_bytes().as_ptr().cast::<c_char>(),
            label.len(),
        );
    }
    CGContext::restore_g_state(Some(context));
}

#[cfg(target_os = "macos")]
fn cf_url_from_path(
    path: &str,
    is_directory: bool,
) -> Result<objc2_core_foundation::CFRetained<objc2_core_foundation::CFURL>, String> {
    unsafe {
        objc2_core_foundation::CFURL::from_file_system_representation(
            None,
            path.as_bytes().as_ptr(),
            path.len() as isize,
            is_directory,
        )
    }
    .ok_or_else(|| format!("파일 URL 생성 실패: {path}"))
}

#[cfg(target_os = "macos")]
fn export_tmp_path(path: &str) -> PathBuf {
    let mut tmp = PathBuf::from(path);
    let file_name = tmp
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("markmind-export.pdf");
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    tmp.set_file_name(format!(
        "{file_name}.markmind-export-{}-{nonce}.tmp.pdf",
        std::process::id()
    ));
    tmp
}

#[cfg(target_os = "macos")]
fn numbered_tmp_path(path: &str) -> PathBuf {
    let mut tmp = PathBuf::from(path);
    let file_name = tmp
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| format!("{name}.markmind-numbered.tmp"))
        .unwrap_or_else(|| "markmind-numbered.tmp.pdf".to_string());
    tmp.set_file_name(file_name);
    tmp
}
