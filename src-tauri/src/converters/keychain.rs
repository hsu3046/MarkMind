//! API 키 — 통합 vault (crate::secrets) 위임.
//!
//! 기존엔 provider 별 Keychain entry 가 분산돼 있었지만, ad-hoc 서명 + 빌드 hash
//! 변경 시 다이얼로그 폭격 → 단일 vault entry 로 통합. 시그니처는 그대로 유지해
//! 기존 호출자 (Tauri commands) 영향 없음.

use super::error::ConverterError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Gemini,
    Claude,
    Openai,
}

fn read_field(v: &crate::secrets::Vault, p: Provider) -> Option<String> {
    match p {
        Provider::Gemini => v.gemini.clone(),
        Provider::Claude => v.claude.clone(),
        Provider::Openai => v.openai.clone(),
    }
}

/// pipeline 내부용 — vault 에서 provider 키 조회. trim 후 빈 문자열은 None.
pub fn get_key(provider: Provider) -> super::error::ConverterResult<Option<String>> {
    let v = crate::secrets::load();
    Ok(read_field(&v, provider).filter(|s| !s.trim().is_empty()))
}

fn write_field(v: &mut crate::secrets::Vault, p: Provider, val: Option<String>) {
    match p {
        Provider::Gemini => v.gemini = val,
        Provider::Claude => v.claude = val,
        Provider::Openai => v.openai = val,
    }
}

// ─── Tauri commands ───

#[tauri::command]
pub fn get_api_key(provider: Provider) -> Result<Option<String>, String> {
    let v = crate::secrets::load();
    Ok(read_field(&v, provider))
}

#[tauri::command]
pub fn set_api_key(provider: Provider, key: String) -> Result<(), String> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err(ConverterError::Validation("API 키가 비어있습니다.".into()).into());
    }
    let value = trimmed.to_string();
    crate::secrets::update(|v| write_field(v, provider, Some(value)))
}

#[tauri::command]
pub fn delete_api_key(provider: Provider) -> Result<(), String> {
    crate::secrets::update(|v| write_field(v, provider, None))
}

#[tauri::command]
pub fn has_api_key(provider: Provider) -> Result<bool, String> {
    let v = crate::secrets::load();
    Ok(read_field(&v, provider)
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false))
}
