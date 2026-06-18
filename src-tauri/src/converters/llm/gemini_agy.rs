//! Gemini 구독 — Antigravity CLI(`agy`) headless 호출.
//!
//! `agy -p "<prompt>"` 는 **비TTY(pipe/subprocess) 에서 stdout 이 비는 버그**가 있다
//! (직접 호출 0바이트 실측). 그래서 PTY(portable-pty)로 감싸 출력을 캡처한다 — PTY 를
//! 주면 `b"2\r\n"` 처럼 정상 응답이 나온다(실측 2026-06-19).
//!
//! 인증은 agy 가 **macOS Keychain(Antigravity IDE 와 공유)** 에서 읽으므로 토큰을 직접
//! 다루지 않는다(Claude/Codex 의 토큰 재사용과 다른 방식). 모델명은 `agy models` 의
//! 표기("Gemini 3.1 Pro (High)" 등)를 `--model` 에 그대로 넘긴다.

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::Read;

/// 단일 프롬프트 응답(구독). model 은 agy 모델명. system 은 agy 가 별도 인자를 받지
/// 않으므로 프롬프트 앞에 붙인다. PTY 호출은 blocking 이라 spawn_blocking 에서 실행.
pub async fn generate_text(
    model: &str,
    system: Option<&str>,
    prompt: &str,
) -> Result<String, String> {
    let model = model.to_string();
    let full = match system {
        Some(s) if !s.trim().is_empty() => format!("{s}\n\n{prompt}"),
        _ => prompt.to_string(),
    };
    tokio::task::spawn_blocking(move || agy_call(&model, &full))
        .await
        .map_err(|e| format!("agy 태스크 조인 실패: {e}"))?
}

fn agy_call(model: &str, prompt: &str) -> Result<String, String> {
    let pty = native_pty_system();
    let pair = pty
        .openpty(PtySize {
            rows: 24,
            cols: 220, // 좁으면 agy 가 줄바꿈/제어문자를 더 끼워넣음 → 넉넉히
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("PTY 생성 실패: {e}"))?;

    let mut cmd = CommandBuilder::new(agy_bin());
    cmd.arg("-p");
    cmd.arg(prompt);
    cmd.arg("--model");
    cmd.arg(model);
    cmd.arg("--print-timeout");
    cmd.arg("180s");

    let mut child = pair.slave.spawn_command(cmd).map_err(|e| {
        format!("agy 실행 실패 — 설치/PATH 확인(brew install --cask antigravity-cli): {e}")
    })?;
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("PTY reader 생성 실패: {e}"))?;
    // slave 를 닫아야 자식 종료 시 reader 가 EOF 를 받는다(안 닫으면 read_to_end 가 행).
    drop(pair.slave);

    let mut raw = Vec::new();
    reader
        .read_to_end(&mut raw)
        .map_err(|e| format!("PTY 읽기 실패: {e}"))?;
    let _ = child.wait();

    let text = clean_output(&String::from_utf8_lossy(&raw));
    if text.is_empty() {
        return Err("agy 가 빈 응답을 반환했습니다 (인증 또는 모델명을 확인하세요).".into());
    }
    Ok(text)
}

/// agy 바이너리 경로 — Tauri GUI 앱은 PATH 가 제한적이라 brew 경로를 직접 탐색.
pub fn agy_bin() -> String {
    for p in ["/opt/homebrew/bin/agy", "/usr/local/bin/agy"] {
        if std::path::Path::new(p).exists() {
            return p.to_string();
        }
    }
    "agy".to_string() // PATH 폴백
}

/// agy PTY 출력에서 ANSI CSI escape(`ESC [ ... <letter>`)와 `\r` 을 제거하고 trim.
/// 짧은 응답은 깨끗하지만(`"2\r\n"`), 긴 응답엔 색상/커서 제어가 섞일 수 있어 제거한다.
fn clean_output(s: &str) -> String {
    let mut out = String::new();
    let mut it = s.chars().peekable();
    while let Some(c) = it.next() {
        if c == '\u{1B}' {
            // ESC: CSI(`[`) 시퀀스면 final letter 까지 스킵
            if it.peek() == Some(&'[') {
                it.next();
                while let Some(&nc) = it.peek() {
                    it.next();
                    if nc.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
            // ESC 단독/기타는 그냥 버림
        } else if c != '\r' {
            out.push(c);
        }
    }
    out.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::clean_output;

    #[test]
    fn clean_strips_cr_and_trims() {
        assert_eq!(clean_output("2\r\n"), "2");
        assert_eq!(clean_output("  line  \r\n"), "line");
    }

    #[test]
    fn clean_strips_ansi_color() {
        assert_eq!(clean_output("\u{1B}[32mhi\u{1B}[0m\r\n"), "hi");
        assert_eq!(clean_output("a\u{1B}[1;31mb\u{1B}[0mc"), "abc");
    }

    #[test]
    fn clean_keeps_multiline_body() {
        // 본문 줄바꿈(\n)은 보존, \r 만 제거
        assert_eq!(clean_output("line1\r\nline2\r\n"), "line1\nline2");
    }
}
