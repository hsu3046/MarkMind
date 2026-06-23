use std::collections::BTreeSet;
use std::process::Command;

fn parse_atsutil_font_families(stdout: &str) -> Vec<String> {
    let mut in_families = false;
    let mut families = BTreeSet::new();

    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.ends_with("Fonts:") {
            in_families = false;
            continue;
        }
        if trimmed.ends_with("Families:") {
            in_families = true;
            continue;
        }
        if !in_families || trimmed.starts_with('.') {
            continue;
        }
        families.insert(trimmed.to_string());
    }

    families.into_iter().collect()
}

#[tauri::command]
pub async fn list_installed_font_families() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let output = Command::new("atsutil")
            .args(["fonts", "-list"])
            .output()
            .map_err(|e| format!("폰트 목록을 가져오지 못했습니다: {}", e))?;
        if !output.status.success() {
            return Err(format!(
                "폰트 목록 명령 실패: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        Ok(parse_atsutil_font_families(&String::from_utf8_lossy(
            &output.stdout,
        )))
    })
    .await
    .map_err(|e| format!("폰트 목록 작업 실패: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::parse_atsutil_font_families;

    #[test]
    fn parses_family_section_only() {
        let raw = r#"
System Fonts:
    ArialMT
    Helvetica
System Families:
    Arial
    .SF Compact
    Helvetica Neue
    Apple SD Gothic Neo
"#;
        assert_eq!(
            parse_atsutil_font_families(raw),
            vec!["Apple SD Gothic Neo", "Arial", "Helvetica Neue"]
        );
    }
}
