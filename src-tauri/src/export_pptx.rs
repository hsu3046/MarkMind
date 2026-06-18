// PPTX 내보내기 — 이슈 #6
//
// 프론트(PptxGenJS, WKWebView)에서 만든 .pptx ArrayBuffer 를 받아 사용자가 고른
// 경로에 저장한다. WKWebView 의 blob:// 다운로드 버그(WebKit #216918) 우회 —
// 저장 다이얼로그는 프론트 tauri-plugin-dialog 의 save() 가 처리하고, 여기선
// bytes 를 fs::write 만 한다(print_pdf::export_pdf 와 동일한 역할 분담).

use tauri::command;

#[command]
pub async fn save_pptx(path: String, data: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, &data).map_err(|e| format!("PPTX 저장 실패: {e}"))
}
