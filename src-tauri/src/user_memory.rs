//! 사용자 메모리(#15) — "내 정보" plaintext 를 appDataDir/memory.md 에 보관.
//!
//! 사용자가 Settings 에서 적는 자기 정보(예: "한국어 사용자, B2B SaaS, 존댓말 선호")를
//! AI 호출 시 system prompt 에 주입해 톤·용어·배경을 반영한다. 평문 파일이라 사용자가
//! 외부 에디터로 직접 열어 편집할 수도 있다.

use tauri::Manager;

/// appDataDir/memory.md 경로. (macOS: ~/Library/Application Support/<bundle>/memory.md)
fn memory_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("memory.md"))
}

/// memory.md 읽기. 파일이 없으면(첫 실행) 빈 문자열을 돌려준다.
#[tauri::command]
pub fn read_user_memory(app: tauri::AppHandle) -> Result<String, String> {
    let path = memory_path(&app)?;
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(e.to_string()),
    }
}

/// memory.md 쓰기. appDataDir 가 없으면 생성한다.
#[tauri::command]
pub fn write_user_memory(app: tauri::AppHandle, content: String) -> Result<(), String> {
    let path = memory_path(&app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, content).map_err(|e| e.to_string())
}
