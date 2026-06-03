// macOS native PDF export — NSPrintInfo 명시 설정 후 WKWebView.printOperationWithPrintInfo 호출.
//
// 배경 (PR #26 검증 사고):
//   wry 0.54 의 `window.print()` 는 `NSPrintInfo.sharedPrintInfo` (전역 싱글톤)
//   에 margins 만 set + paperSize/horizontallyCentered/orientation 미명시.
//   시스템 default 또는 직전 호출 잔존값 사용 → 사용자 환경에 따라 US Letter
//   default + 좌측 정렬 → 좌측 여백 비대칭 발생. CSS @page 룰도 WKWebView 가
//   무시 (wry issue #713).
//
//   해결: NSPrintInfo::new() 로 새 인스턴스 init + paperSize(A4) +
//   horizontallyCentered(true) + margins(20mm 4면) + orientation(Portrait) +
//   pagination(Automatic) 모두 명시. WKWebView.printOperationWithPrintInfo
//   를 직접 호출해 우리 NSPrintInfo 사용 강제. 검증된 패턴 (wry 0.54.2 의
//   print_with_options 동형).
//
// Tauri 2.10 ↔ wry 0.54 ↔ objc2-app-kit 0.3 / objc2-web-kit 0.3 dependency pin
// 필요 (Cargo.toml 의 target.macos.dependencies 섹션).

use tauri::{command, WebviewWindow};
use tokio::sync::oneshot;

#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PrintOptions {
    /// macOS 인쇄 다이얼로그의 job title (PDF 저장 시 default 파일명에 사용)
    pub job_title: Option<String>,
}

#[command]
pub async fn export_pdf(
    window: WebviewWindow,
    options: Option<PrintOptions>,
) -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, options);
        return Err("export_pdf is macOS-only".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        let (tx, rx) = oneshot::channel::<Result<(), String>>();
        let job_title = options.and_then(|o| o.job_title);

        window
            .with_webview(move |pw| {
                // with_webview 클로저 = macOS 메인 스레드 보장
                // (tauri-runtime-wry 가 tao event loop 의 main thread arm 에서 dispatch).
                // 안 unsafe block 에서 `?` 사용을 위해 IIFE 로 wrap (closure return 은 ()).
                let res: Result<(), String> = (|| unsafe {
                    use objc2::rc::Retained;
                    use objc2::runtime::AnyObject;
                    use objc2::MainThreadMarker;
                    use objc2_app_kit::{
                        NSPaperOrientation, NSPrintInfo, NSPrintingPaginationMode, NSWindow,
                    };
                    use objc2_foundation::{NSSize, NSString};
                    use objc2_web_kit::WKWebView;

                    let _mtm = MainThreadMarker::new_unchecked();

                    // Tauri 가 Retained::into_raw (+1 retain) 로 포인터 넘김.
                    // Retained::from_raw 로 소유권 흡수 → 클로저 종료 시 자동 release.
                    let wk: Retained<WKWebView> = Retained::from_raw(pw.inner().cast())
                        .ok_or_else(|| "WKWebView ptr is null".to_string())?;
                    let ns_window: Retained<NSWindow> =
                        Retained::from_raw(pw.ns_window().cast())
                            .ok_or_else(|| "NSWindow ptr is null".to_string())?;
                    // WKUserContentController 는 사용 안 하지만 +1 retain 흡수해 누수 회피
                    let _mgr_drop = Retained::<AnyObject>::from_raw(pw.controller().cast());

                    // NSPrintInfo 새 인스턴스 — sharedPrintInfo 의 잔여 상태 회피.
                    let info = NSPrintInfo::new();

                    // A4 = 210mm × 297mm = 595.28pt × 841.89pt (1pt = 1/72 inch).
                    info.setPaperSize(NSSize {
                        width: 595.28,
                        height: 841.89,
                    });
                    info.setOrientation(NSPaperOrientation::Portrait);

                    // 20mm = 56.69pt 마진 4면 (좌우 동일 보장).
                    info.setLeftMargin(56.69);
                    info.setRightMargin(56.69);
                    info.setTopMargin(56.69);
                    info.setBottomMargin(56.69);

                    // 좌우 가운데 정렬 — 콘텐츠 폭이 페이지 폭보다 작아도 비대칭 X.
                    info.setHorizontallyCentered(true);
                    info.setVerticallyCentered(false);

                    // 자동 페이지 분할 + 가로 자동 fit.
                    info.setHorizontalPagination(NSPrintingPaginationMode::Automatic);
                    info.setVerticalPagination(NSPrintingPaginationMode::Automatic);

                    // WKWebView 의 printOperation 생성 + 실행.
                    let op = wk.printOperationWithPrintInfo(&info);
                    op.setCanSpawnSeparateThread(true);
                    op.setShowsPrintPanel(true);
                    op.setShowsProgressPanel(true);

                    if let Some(title) = job_title.as_deref() {
                        let ns_title = NSString::from_str(title);
                        op.setJobTitle(Some(&ns_title));
                    }

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
            .map_err(|_| "with_webview closure dropped".to_string())?
    }
}
