//! 회의록 템플릿 로더 + frontmatter 빌더.
//!
//! doc-converter src/services/template-loader.ts + src/templates/evidence.ts 통합 포팅.
//!
//! 빌트인 템플릿은 Tauri resources/meeting-templates/*.md 로 동봉.
//! 사용자 정의 템플릿은 ~/.markmind/meeting-templates/*.md.

use super::error::{ConverterError, ConverterResult};
use super::{converter_version, EvidenceType};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[allow(dead_code)]
const MAX_TEMPLATE_BYTES: u64 = 100 * 1024;
const USER_TEMPLATE_SUBDIR: &str = ".markmind/meeting-templates";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TemplateSource {
    Builtin,
    User,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub source: TemplateSource,
    pub path: PathBuf,
}

#[derive(Debug, Clone)]
pub struct LoadedTemplate {
    pub info: TemplateInfo,
    pub body: String,
}

/// 단순 frontmatter 파서 — yaml 라이브러리 회피, key: value 한 줄당 1개.
pub fn parse_frontmatter(raw: &str) -> Option<(HashMap<String, String>, String)> {
    let raw = raw.trim_start_matches('\u{FEFF}'); // BOM 제거
    if !raw.starts_with("---") {
        return None;
    }
    // "---\n" 다음부터 "\n---" 까지
    let after_open = &raw[3..];
    let end_idx = after_open.find("\n---")?;
    let fm_raw = after_open[..end_idx].trim();
    let body_start = end_idx + 4; // \n--- 까지
    let body = after_open[body_start..]
        .trim_start_matches('\r')
        .trim_start_matches('\n')
        .to_string();

    let mut fm = HashMap::new();
    for line in fm_raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let Some(colon_idx) = trimmed.find(':') else {
            continue;
        };
        let key = trimmed[..colon_idx].trim().to_string();
        let mut value = trimmed[colon_idx + 1..].trim().to_string();
        // 따옴표 제거
        if (value.starts_with('"') && value.ends_with('"'))
            || (value.starts_with('\'') && value.ends_with('\''))
        {
            value = value[1..value.len() - 1].to_string();
        }
        fm.insert(key, value);
    }
    Some((fm, body))
}

fn read_template(path: &Path, source: TemplateSource) -> ConverterResult<Option<LoadedTemplate>> {
    let raw = std::fs::read_to_string(path)?;
    let Some((fm, body)) = parse_frontmatter(&raw) else {
        return Ok(None);
    };
    let Some(name) = fm.get("name").map(|s| s.trim().to_string()) else {
        return Ok(None);
    };
    if name.is_empty() {
        return Ok(None);
    }
    let id = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    Ok(Some(LoadedTemplate {
        info: TemplateInfo {
            id,
            name,
            description: fm
                .get("description")
                .map(|s| s.trim().to_string())
                .unwrap_or_default(),
            source,
            path: path.to_path_buf(),
        },
        body: body.trim().to_string(),
    }))
}

fn builtin_dir(app: &AppHandle) -> ConverterResult<PathBuf> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| ConverterError::Template(format!("리소스 디렉토리 해석 실패: {}", e)))?;
    Ok(resource_dir.join("resources").join("meeting-templates"))
}

fn user_dir() -> ConverterResult<PathBuf> {
    let home = dirs::home_dir()
        .ok_or_else(|| ConverterError::Template("홈 디렉토리를 찾을 수 없습니다.".into()))?;
    let dir = home.join(USER_TEMPLATE_SUBDIR);
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn list_from_dir(dir: &Path, source: TemplateSource) -> Vec<LoadedTemplate> {
    let Ok(read) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in read.flatten() {
        let path = entry.path();
        if path
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| s.to_lowercase())
            != Some("md".into())
        {
            continue;
        }
        if let Ok(Some(t)) = read_template(&path, source) {
            out.push(t);
        }
    }
    out
}

pub fn list_templates(app: &AppHandle) -> ConverterResult<Vec<TemplateInfo>> {
    let builtin = list_from_dir(&builtin_dir(app)?, TemplateSource::Builtin);
    let user = list_from_dir(&user_dir()?, TemplateSource::User);

    // 같은 id 면 user 우선
    let mut map: HashMap<String, TemplateInfo> = HashMap::new();
    for t in builtin {
        map.insert(t.info.id.clone(), t.info);
    }
    for t in user {
        map.insert(t.info.id.clone(), t.info);
    }
    let mut list: Vec<TemplateInfo> = map.into_values().collect();
    list.sort_by(|a, b| match (a.source, b.source) {
        (TemplateSource::Builtin, TemplateSource::User) => std::cmp::Ordering::Less,
        (TemplateSource::User, TemplateSource::Builtin) => std::cmp::Ordering::Greater,
        _ => a.name.cmp(&b.name),
    });
    Ok(list)
}

/// 템플릿 id 또는 절대경로로 로드. 같은 id 면 user > builtin.
pub fn get_template(app: &AppHandle, id_or_path: &str) -> ConverterResult<LoadedTemplate> {
    // 절대/상대 경로
    if id_or_path.contains('/') || id_or_path.contains('\\') {
        let path = PathBuf::from(id_or_path);
        let t = read_template(&path, TemplateSource::User)?.ok_or_else(|| {
            ConverterError::Template(format!("템플릿을 읽을 수 없습니다: {}", id_or_path))
        })?;
        return Ok(t);
    }

    // user 우선
    let user_path = user_dir()?.join(format!("{}.md", id_or_path));
    if user_path.exists() {
        if let Some(t) = read_template(&user_path, TemplateSource::User)? {
            return Ok(t);
        }
    }
    let builtin_path = builtin_dir(app)?.join(format!("{}.md", id_or_path));
    if builtin_path.exists() {
        if let Some(t) = read_template(&builtin_path, TemplateSource::Builtin)? {
            return Ok(t);
        }
    }
    Err(ConverterError::Template(format!(
        "템플릿을 찾을 수 없습니다: {}",
        id_or_path
    )))
}

#[allow(dead_code)]
pub fn save_user_template(filename: &str, content: &str) -> ConverterResult<TemplateInfo> {
    if content.len() as u64 > MAX_TEMPLATE_BYTES {
        return Err(ConverterError::Template(format!(
            "템플릿 파일이 {}KB 를 초과합니다.",
            MAX_TEMPLATE_BYTES / 1024
        )));
    }
    let base = Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    let valid = !base.is_empty()
        && base
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if !valid {
        return Err(ConverterError::Template(format!(
            "템플릿 파일명은 영문/숫자/하이픈/언더스코어만 사용 가능합니다 (입력: {})",
            base
        )));
    }
    let parsed = parse_frontmatter(content)
        .ok_or_else(|| ConverterError::Template("템플릿에 frontmatter 가 없습니다.".into()))?;
    if parsed
        .0
        .get("name")
        .map(|s| s.trim())
        .unwrap_or("")
        .is_empty()
    {
        return Err(ConverterError::Template(
            "frontmatter 에 name 필드가 필요합니다.".into(),
        ));
    }

    let target = user_dir()?.join(format!("{}.md", base));
    std::fs::write(&target, content)?;
    let t = read_template(&target, TemplateSource::User)?
        .ok_or_else(|| ConverterError::Template("템플릿 저장 후 재로딩 실패".into()))?;
    Ok(t.info)
}

// ─── Tauri commands ───

#[tauri::command]
pub fn list_meeting_templates(app: AppHandle) -> Result<Vec<TemplateInfo>, String> {
    list_templates(&app).map_err(Into::into)
}

/// 사용자 정의 회의록 템플릿 폴더를 OS 파일 매니저로 엶.
/// 폴더가 없으면 생성, README.md 가 없으면 안내 파일 자동 생성.
/// tauri-plugin-opener 사용 — zombie process 회피 + cross-platform.
#[tauri::command]
pub fn open_user_templates_folder(app: AppHandle) -> Result<String, String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = user_dir().map_err(|e| e.to_string())?;
    let readme = dir.join("README.md");
    if !readme.exists() {
        let sample = "# 회의록 템플릿 사용법\n\n\
이 폴더에 `.md` 파일을 두면 회의록 작성 모드의 템플릿 목록에 자동으로 추가됩니다.\n\n\
## 형식\n\n\
```\n\
---\n\
name: 내 회의록 템플릿\n\
description: 설명 (선택)\n\
---\n\n\
당신은 미팅 transcript 를 보고 아래 구조로 한국어 마크다운 회의록을 작성합니다.\n\n\
## 요약\n\
3~5줄로 요약...\n\n\
## 결정 사항\n\
- ...\n\n\
## 액션 아이템\n\
- [ ] @담당자 — 할 일 — 기한\n\
```\n\n\
파일명 규칙: 영문/숫자/하이픈/언더스코어만 (예: `my-template.md`).\n";
        let _ = std::fs::write(&readme, sample);
    }
    let path_str = dir.to_string_lossy().to_string();
    app.opener()
        .open_path(path_str.clone(), None::<&str>)
        .map_err(|e| format!("폴더 열기 실패: {}", e))?;
    Ok(path_str)
}

// ─── Frontmatter / Evidence Markdown 빌더 ───

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvidenceMeta {
    pub r#type: EvidenceType,
    pub source: String,
    /// "YYYY-MM-DD HH:mm" KST
    pub processed: String,
    pub converter: String,
    #[serde(rename = "recordedAt", skip_serializing_if = "Option::is_none")]
    pub recorded_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub template: Option<String>,
}

impl EvidenceMeta {
    pub fn new(r#type: EvidenceType, source: impl Into<String>) -> Self {
        Self {
            r#type,
            source: source.into(),
            processed: super::now_kst_minute(),
            converter: converter_version(),
            recorded_at: None,
            template: None,
        }
    }

    pub fn with_recorded_at(mut self, recorded_at: Option<String>) -> Self {
        self.recorded_at = recorded_at;
        self
    }

    pub fn with_template(mut self, template: Option<String>) -> Self {
        self.template = template;
        self
    }
}

/// 한국어 라벨 frontmatter (사용자 표시 우선) + 본문.
pub fn build_evidence_markdown(meta: &EvidenceMeta, body: &str) -> String {
    let mut lines: Vec<String> = vec!["---".into(), format!("원본 파일: {}", meta.source)];
    if let Some(r) = &meta.recorded_at {
        lines.push(format!("원본 날짜: {}", r));
    }
    if let Some(t) = &meta.template {
        lines.push(format!("템플릿: {}", t));
    }
    lines.push(format!("변환 날짜: {}", meta.processed));
    lines.push("---".into());
    let frontmatter = lines.join("\n");
    format!("{}\n\n{}\n", frontmatter, body)
}

/// transcript 마크다운에서 frontmatter 제거 — 회의록 생성 LLM 입력용
pub fn strip_frontmatter(text: &str) -> String {
    if !text.starts_with("---") {
        return text.to_string();
    }
    let after_open = &text[3..];
    let Some(end_idx) = after_open.find("\n---") else {
        return text.to_string();
    };
    after_open[end_idx + 4..]
        .trim_start_matches('\r')
        .trim_start_matches('\n')
        .to_string()
}
