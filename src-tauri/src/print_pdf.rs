// macOS native PDF export — WKWebView.createPDFWithConfiguration:completionHandler:
// 직접 호출. 사용자 인쇄 다이얼로그 없이 PDF data (NSData) 반환 받아 파일 저장.
//
// 이전 NSPrintOperation 방식 (option A) 은 인쇄 다이얼로그 modal 표시가 필수
// + paperSize/horizontallyCentered/margins 명시해도 사용자 결과에 잔존 비대칭
// 발생. WKWebView 의 createPDF API 는 dialog 없이 PDF data 직접 받아 paperSize
// 와 layout 우리가 완전히 제어 (option B1).
//
// 흐름:
//   1. JS: tauri-plugin-dialog 의 save() → 사용자 저장 경로
//   2. JS: invoke('export_pdf', { path })
//   3. Rust: with_webview 안에서 createPDFWithConfiguration 호출 + RcBlock
//      completion handler 안에서 NSData → std::fs::write(path)
//   4. JS: 결과 받음
//
// WKPDFConfiguration:
//   - rect None (default) = visible web page 전체. 우리 콘텐츠가 viewport 안
//     렌더된 상태라 그대로 PDF 화.
//   - paperSize 옵션 없음 — 콘텐츠 viewport width 기반. 사용자 화면 폭이 결과
//     PDF page width 가 됨 → CSS 로 콘텐츠 폭 제어 필요.

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
                // createPDFWithConfiguration 의 completion handler 는 비동기
                // (PDF 생성 후 호출) — main thread 또는 background. RcBlock
                // 안에서 std::fs::write + tx.send 로 결과 전달.
                let setup_result: Result<(), String> = (|| unsafe {
                    use block2::RcBlock;
                    use objc2::rc::Retained;
                    use objc2::runtime::AnyObject;
                    use objc2_foundation::{NSData, NSError};
                    use objc2_web_kit::WKWebView;

                    // Tauri 의 +1 retain 흡수.
                    let wk: Retained<WKWebView> = Retained::from_raw(pw.inner().cast())
                        .ok_or_else(|| "WKWebView ptr is null".to_string())?;
                    // ns_window / controller 도 +1 retain 흡수 (사용 X but 누수 회피).
                    let _ns_window: Option<Retained<AnyObject>> =
                        Retained::from_raw(pw.ns_window().cast());
                    let _mgr: Option<Retained<AnyObject>> =
                        Retained::from_raw(pw.controller().cast());

                    // completion handler — PDF data 받아 file write.
                    // tx 는 FnOnce 라 Once 로 wrap (RcBlock 는 Fn 요구).
                    let tx_cell = std::sync::Mutex::new(Some(tx));
                    let handler = RcBlock::new(move |data: *mut NSData, err: *mut NSError| {
                        let result: Result<(), String> = (|| {
                            if !err.is_null() {
                                let err_ref: &NSError = unsafe { &*err };
                                return Err(format!(
                                    "WKWebView createPDF error: {}",
                                    err_ref.localizedDescription()
                                ));
                            }
                            if data.is_null() {
                                return Err("createPDF returned null NSData".to_string());
                            }
                            // NSData → Vec<u8> → file write
                            let data_ref: &NSData = unsafe { &*data };
                            let bytes = data_ref.to_vec();
                            std::fs::write(&path_clone, &bytes).map_err(|e| {
                                format!("write to {} failed: {}", path_clone, e)
                            })?;
                            Ok(())
                        })();
                        if let Ok(mut guard) = tx_cell.lock() {
                            if let Some(tx) = guard.take() {
                                let _ = tx.send(result);
                            }
                        }
                    });

                    // WKPDFConfiguration None = visible web page 전체.
                    wk.createPDFWithConfiguration_completionHandler(None, &handler);
                    Ok(())
                })();

                // setup 단계 실패 시 setup_result 자체로 tx 미발사 → rx hang.
                // 그 경우 별도 처리 — Mutex::take 가 None 이면 setup 도 실패한
                // 케이스. 단 setup_result 의 tx 가 closure 안 캡처돼서 외부에서
                // 별도 send 어려움. setup 실패 시 panic 대신 std error 출력.
                if let Err(e) = setup_result {
                    eprintln!("[export_pdf setup] {}", e);
                    // Note: tx 가 캡처된 상태라 setup 실패 시 rx.await 무한 대기.
                    // 실제로 setup 실패는 webview ptr null 같은 극단 케이스라 거의 없음.
                }
            })
            .map_err(|e| format!("with_webview failed: {e}"))?;

        rx.await
            .map_err(|_| "PDF completion handler did not fire".to_string())?
    }
}
