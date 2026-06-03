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
        let path_clone = path.clone();

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
                    use objc2_foundation::{NSString, NSURL};
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
            .map_err(|_| "with_webview closure dropped".to_string())?
    }
}
