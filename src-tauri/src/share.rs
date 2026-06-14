//! macOS AirDrop 공유 — LAN 접속 URL 을 `NSSharingService` 로 AirDrop 전송.
//!
//! 설정창의 공유 버튼이 호출. 시스템 AirDrop 수신자 선택 창이 떠 아이폰을 고르면
//! URL 이 전달되고, 아이폰은 "Safari 로 열기" 로 토큰 포함 주소에 바로 접속한다.
//! print_pdf.rs 와 동일하게 `with_webview`(macOS 메인 스레드 보장) 안에서 AppKit 호출.

use tauri::{command, WebviewWindow};
use tokio::sync::oneshot;

#[command]
pub async fn share_url_airdrop(window: WebviewWindow, url: String) -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, url);
        return Err("AirDrop 공유는 macOS 전용입니다".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        let (tx, rx) = oneshot::channel::<Result<(), String>>();

        window
            .with_webview(move |_pw| {
                // with_webview 클로저 = macOS 메인 스레드 보장(AppKit UI 요건).
                let res: Result<(), String> = (|| unsafe {
                    use objc2::runtime::AnyObject;
                    use objc2_app_kit::{NSSharingService, NSSharingServiceNameSendViaAirDrop};
                    use objc2_foundation::{NSArray, NSString, NSURL};

                    let ns_url = NSString::from_str(&url);
                    let url_obj = NSURL::URLWithString(&ns_url)
                        .ok_or_else(|| "URL 생성 실패".to_string())?;
                    // 공유 항목 배열 — performWithItems 는 NSArray<AnyObject> 를 받으므로
                    // NSURL 을 AnyObject 로 업캐스트(deref: NSURL→NSObject→AnyObject).
                    let item: &AnyObject = &url_obj;
                    let items = NSArray::from_slice(&[item]);

                    let service =
                        NSSharingService::sharingServiceNamed(NSSharingServiceNameSendViaAirDrop)
                            .ok_or_else(|| "AirDrop 서비스를 사용할 수 없습니다".to_string())?;

                    // AirDrop 수신자 선택 창 표시(메인 스레드 비동기).
                    service.performWithItems(&items);
                    Ok(())
                })();
                let _ = tx.send(res);
            })
            .map_err(|e| format!("with_webview 실패: {e}"))?;

        rx.await
            .map_err(|_| "with_webview 클로저 종료".to_string())?
    }
}
