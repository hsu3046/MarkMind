//! 통합 Secret Vault — macOS Keychain 의 단일 entry 에 모든 비밀을 JSON 으로 저장.
//!
//! 기존엔 entry 7개 (gemini/claude/openai/gdrive-*) 분산 → ad-hoc 서명 + 빌드 hash 변경 시
//! 각 entry 마다 Keychain 다이얼로그. 통합 후 빌드당 다이얼로그 1번.
//!
//! - service: "space.knowai.markmind"
//! - account: "markmind-secrets"
//! - value:   JSON serialize of Vault struct
//!
//! 메모리 캐시 (process lifetime) — 첫 load 이후 set/get 은 캐시 hit.

use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

const SERVICE: &str = "space.knowai.markmind";
const ACCOUNT: &str = "markmind-secrets";

#[derive(Default, Debug, Serialize, Deserialize, Clone)]
pub struct Vault {
    #[serde(default)]
    pub gemini: Option<String>,
    #[serde(default)]
    pub claude: Option<String>,
    #[serde(default)]
    pub openai: Option<String>,
    #[serde(default)]
    pub grok: Option<String>,
    #[serde(default)]
    pub pyannoteai: Option<String>,
    /// 로컬 화자분리용 Python 인터프리터 경로 (pyannote.audio 설치됨). 설정 시 로컬 우선.
    #[serde(default)]
    pub diar_python: Option<String>,
    #[serde(default)]
    pub gdrive_client_id: Option<String>,
    #[serde(default)]
    pub gdrive_client_secret: Option<String>,
    #[serde(default)]
    pub gdrive_refresh_token: Option<String>,
    #[serde(default)]
    pub gdrive_user_email: Option<String>,
}

static CACHE: Mutex<Option<Vault>> = Mutex::new(None);

fn entry() -> keyring::Result<Entry> {
    Entry::new(SERVICE, ACCOUNT)
}

/// Keychain → Vault (캐시 hit 시 1회 read 회피).
pub fn load() -> Vault {
    if let Ok(g) = CACHE.lock() {
        if let Some(v) = g.as_ref() {
            return v.clone();
        }
    }
    let v = match entry().and_then(|e| e.get_password()) {
        Ok(s) => serde_json::from_str::<Vault>(&s).unwrap_or_default(),
        Err(_) => Vault::default(),
    };
    if let Ok(mut g) = CACHE.lock() {
        *g = Some(v.clone());
    }
    v
}

/// Vault → Keychain + 캐시 갱신.
pub fn save(vault: &Vault) -> Result<(), String> {
    let json = serde_json::to_string(vault).map_err(|e| e.to_string())?;
    entry()
        .and_then(|e| e.set_password(&json))
        .map_err(|e| format!("Keychain 저장 실패: {}", e))?;
    if let Ok(mut g) = CACHE.lock() {
        *g = Some(vault.clone());
    }
    Ok(())
}

/// load + 수정 클로저 + save 한 번에.
pub fn update<F: FnOnce(&mut Vault)>(f: F) -> Result<(), String> {
    let mut v = load();
    f(&mut v);
    save(&v)
}

/// UI 가 한 번에 수정하는 필드 — 1회 vault save 로 묶어 Keychain 다이얼로그 최소화.
///
/// 시멘틱 (JSON):
/// - 필드 누락 (key 없음) → 변경 없음 (기존 값 보존)
/// - `"value"`            → 설정
/// - `""` (빈 문자열)     → 삭제
///
/// refresh_token / user_email 은 OAuth flow 전용 — 이 batch 에 포함 안 됨.
#[derive(serde::Deserialize, Default, Debug)]
pub struct SecretsUserInputs {
    #[serde(default)]
    pub gemini: Option<String>,
    #[serde(default)]
    pub claude: Option<String>,
    #[serde(default)]
    pub openai: Option<String>,
    #[serde(default)]
    pub grok: Option<String>,
    #[serde(default)]
    pub pyannoteai: Option<String>,
    #[serde(default)]
    pub diar_python: Option<String>,
    #[serde(default)]
    pub gdrive_client_id: Option<String>,
    #[serde(default)]
    pub gdrive_client_secret: Option<String>,
}

fn apply_field(target: &mut Option<String>, incoming: Option<String>) {
    let Some(s) = incoming else { return }; // 키 누락 → 보존
    let trimmed = s.trim();
    *target = if trimmed.is_empty() {
        None // 빈 문자열 → 삭제
    } else {
        Some(trimmed.to_string()) // 값 → 설정
    };
}

/// 로컬 화자분리용 Python 경로 조회 (Settings UI 프리필용).
#[tauri::command]
pub fn get_diar_python() -> Option<String> {
    load().diar_python.filter(|s| !s.trim().is_empty())
}

#[tauri::command]
pub fn secrets_set_user_inputs(updates: SecretsUserInputs) -> Result<(), String> {
    update(|v| {
        apply_field(&mut v.gemini, updates.gemini);
        apply_field(&mut v.claude, updates.claude);
        apply_field(&mut v.openai, updates.openai);
        apply_field(&mut v.grok, updates.grok);
        apply_field(&mut v.pyannoteai, updates.pyannoteai);
        apply_field(&mut v.diar_python, updates.diar_python);
        apply_field(&mut v.gdrive_client_id, updates.gdrive_client_id);
        apply_field(&mut v.gdrive_client_secret, updates.gdrive_client_secret);
    })
}

/// 전체 vault 삭제 + 캐시 clear (사용 안 함 — 디버깅용).
#[allow(dead_code)]
pub fn reset() -> Result<(), String> {
    let _ = entry().and_then(|e| e.delete_credential());
    if let Ok(mut g) = CACHE.lock() {
        *g = None;
    }
    Ok(())
}

/// 기존 7개 entry → 통합 vault 로 마이그레이션. setup 시 1회 호출.
/// 이미 vault 에 데이터 있으면 skip.
pub fn migrate_legacy_once() {
    let current = load();
    let has_data = current.gemini.is_some()
        || current.claude.is_some()
        || current.openai.is_some()
        || current.gdrive_client_id.is_some()
        || current.gdrive_refresh_token.is_some()
        || current.gdrive_user_email.is_some();
    if has_data {
        return;
    }

    let legacy_accounts: [(&str, &str); 7] = [
        ("gemini-api-key", "gemini"),
        ("claude-api-key", "claude"),
        ("openai-api-key", "openai"),
        ("gdrive-client-id", "gdrive_client_id"),
        ("gdrive-client-secret", "gdrive_client_secret"),
        ("gdrive-refresh-token", "gdrive_refresh_token"),
        ("gdrive-user-email", "gdrive_user_email"),
    ];

    let mut vault = Vault::default();
    let mut found_any = false;
    for (account, field) in legacy_accounts {
        if let Ok(e) = Entry::new(SERVICE, account) {
            if let Ok(val) = e.get_password() {
                if !val.trim().is_empty() {
                    found_any = true;
                    match field {
                        "gemini" => vault.gemini = Some(val),
                        "claude" => vault.claude = Some(val),
                        "openai" => vault.openai = Some(val),
                        "gdrive_client_id" => vault.gdrive_client_id = Some(val),
                        "gdrive_client_secret" => vault.gdrive_client_secret = Some(val),
                        "gdrive_refresh_token" => vault.gdrive_refresh_token = Some(val),
                        "gdrive_user_email" => vault.gdrive_user_email = Some(val),
                        _ => {}
                    }
                    let _ = e.delete_credential();
                }
            }
        }
    }
    if found_any {
        let _ = save(&vault);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_set_get_clear() {
        if let Ok(mut g) = CACHE.lock() {
            *g = None;
        }
        let mut v = Vault::default();
        v.gemini = Some("test-key".to_string());
        v.gdrive_user_email = Some("test@example.com".to_string());
        if let Ok(mut g) = CACHE.lock() {
            *g = Some(v.clone());
        }
        let loaded = load();
        assert_eq!(loaded.gemini, Some("test-key".to_string()));
        assert_eq!(
            loaded.gdrive_user_email,
            Some("test@example.com".to_string())
        );
        if let Ok(mut g) = CACHE.lock() {
            *g = None;
        }
    }

    #[test]
    fn serialize_roundtrip() {
        let v = Vault {
            gemini: Some("g".into()),
            claude: None,
            openai: Some("o".into()),
            grok: Some("x".into()),
            pyannoteai: Some("p".into()),
            diar_python: None,
            gdrive_client_id: Some("id.apps.googleusercontent.com".into()),
            gdrive_client_secret: Some("GOCSPX-x".into()),
            gdrive_refresh_token: Some("1//x".into()),
            gdrive_user_email: Some("u@e.com".into()),
        };
        let json = serde_json::to_string(&v).unwrap();
        let back: Vault = serde_json::from_str(&json).unwrap();
        assert_eq!(back.gemini, v.gemini);
        assert_eq!(back.claude, v.claude);
        assert_eq!(back.gdrive_client_id, v.gdrive_client_id);
    }

    #[test]
    fn empty_vault_defaults_to_none() {
        let v = Vault::default();
        assert!(v.gemini.is_none());
        assert!(v.gdrive_refresh_token.is_none());
    }
}
