//! Google Drive 자격증명 — 통합 vault (crate::secrets) 위임.
//!
//! 기존 entry 4개 (client-id, client-secret, refresh-token, user-email) 가 통합 vault
//! 의 필드로 이동. access_token 은 메모리 캐시 (1h TTL) 만 유지.
//!
//! 시그니처는 그대로 유지해 auth/api 모듈 호출 영향 없음.

use super::error::{GDriveError, GDriveResult};
use std::sync::Mutex;

/// access_token + 만료 시각 (UNIX epoch sec) 메모리 캐시
#[derive(Debug, Clone)]
pub struct AccessTokenCache {
    pub token: String,
    pub expires_at: u64,
}

static ACCESS_CACHE: Mutex<Option<AccessTokenCache>> = Mutex::new(None);

pub fn get_cached_access() -> Option<AccessTokenCache> {
    ACCESS_CACHE.lock().ok().and_then(|g| g.clone())
}

pub fn set_cached_access(cache: AccessTokenCache) {
    if let Ok(mut g) = ACCESS_CACHE.lock() {
        *g = Some(cache);
    }
}

pub fn clear_cached_access() {
    if let Ok(mut g) = ACCESS_CACHE.lock() {
        *g = None;
    }
}

fn to_gderr(s: String) -> GDriveError {
    GDriveError::Keychain(s)
}

// ─── OAuth client credentials ───

pub fn save_client_credentials(client_id: &str, client_secret: &str) -> GDriveResult<()> {
    let id = client_id.to_string();
    let secret = client_secret.to_string();
    crate::secrets::update(|v| {
        v.gdrive_client_id = Some(id);
        v.gdrive_client_secret = Some(secret);
    })
    .map_err(to_gderr)
}

pub fn get_client_credentials() -> GDriveResult<Option<(String, String)>> {
    let v = crate::secrets::load();
    match (v.gdrive_client_id, v.gdrive_client_secret) {
        (Some(id), Some(secret)) if !id.trim().is_empty() && !secret.trim().is_empty() => {
            Ok(Some((id, secret)))
        }
        _ => Ok(None),
    }
}

pub fn get_client_id() -> GDriveResult<Option<String>> {
    let v = crate::secrets::load();
    Ok(v.gdrive_client_id.filter(|s| !s.trim().is_empty()))
}

#[allow(dead_code)] // 대칭 CRUD 헬퍼 — 현재 reset_all() 통합 경로 사용, 개별 관리용 보존
pub fn delete_client_credentials() -> GDriveResult<()> {
    crate::secrets::update(|v| {
        v.gdrive_client_id = None;
        v.gdrive_client_secret = None;
    })
    .map_err(to_gderr)
}

// ─── refresh_token / user_email ───

#[allow(dead_code)] // 대칭 CRUD 헬퍼 — 현재 save_oauth_result() 통합 경로 사용, 개별 관리용 보존
pub fn save_refresh_token(token: &str) -> GDriveResult<()> {
    let val = token.to_string();
    crate::secrets::update(|v| v.gdrive_refresh_token = Some(val)).map_err(to_gderr)
}

pub fn get_refresh_token() -> GDriveResult<Option<String>> {
    let v = crate::secrets::load();
    Ok(v.gdrive_refresh_token.filter(|s| !s.trim().is_empty()))
}

#[allow(dead_code)] // 대칭 CRUD 헬퍼 — 현재 disconnect()/reset_all() 통합 경로 사용, 개별 관리용 보존
pub fn delete_refresh_token() -> GDriveResult<()> {
    crate::secrets::update(|v| v.gdrive_refresh_token = None).map_err(to_gderr)
}

#[allow(dead_code)] // 대칭 CRUD 헬퍼 — 현재 save_oauth_result() 통합 경로 사용, 개별 관리용 보존
pub fn save_user_email(email: &str) -> GDriveResult<()> {
    let val = email.to_string();
    crate::secrets::update(|v| v.gdrive_user_email = Some(val)).map_err(to_gderr)
}

/// OAuth flow 완료 시 refresh_token + user_email 한 번에 저장 (Keychain 다이얼로그 1회).
pub fn save_oauth_result(refresh_token: &str, user_email: &str) -> GDriveResult<()> {
    let r = refresh_token.to_string();
    let e = user_email.to_string();
    crate::secrets::update(|v| {
        v.gdrive_refresh_token = Some(r);
        v.gdrive_user_email = Some(e);
    })
    .map_err(to_gderr)
}

pub fn get_user_email() -> GDriveResult<Option<String>> {
    let v = crate::secrets::load();
    Ok(v.gdrive_user_email.filter(|s| !s.trim().is_empty()))
}

#[allow(dead_code)] // 대칭 CRUD 헬퍼 — 현재 disconnect()/reset_all() 통합 경로 사용, 개별 관리용 보존
pub fn delete_user_email() -> GDriveResult<()> {
    crate::secrets::update(|v| v.gdrive_user_email = None).map_err(to_gderr)
}

/// 연결 해제 — refresh_token + email + access_token 삭제. client_id/secret 유지.
pub fn disconnect() -> GDriveResult<()> {
    crate::secrets::update(|v| {
        v.gdrive_refresh_token = None;
        v.gdrive_user_email = None;
    })
    .map_err(to_gderr)?;
    clear_cached_access();
    Ok(())
}

/// 완전 초기화 — client credentials 까지 삭제.
pub fn reset_all() -> GDriveResult<()> {
    crate::secrets::update(|v| {
        v.gdrive_refresh_token = None;
        v.gdrive_user_email = None;
        v.gdrive_client_id = None;
        v.gdrive_client_secret = None;
    })
    .map_err(to_gderr)?;
    clear_cached_access();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn access_cache_set_get_clear() {
        clear_cached_access();
        assert!(get_cached_access().is_none());

        set_cached_access(AccessTokenCache {
            token: "ya29.test_token".into(),
            expires_at: 9_999_999_999,
        });
        let got = get_cached_access().expect("cache should be set");
        assert_eq!(got.token, "ya29.test_token");
        assert_eq!(got.expires_at, 9_999_999_999);

        clear_cached_access();
        assert!(get_cached_access().is_none());
    }

    #[test]
    fn access_cache_overwrite() {
        set_cached_access(AccessTokenCache {
            token: "first".into(),
            expires_at: 100,
        });
        set_cached_access(AccessTokenCache {
            token: "second".into(),
            expires_at: 200,
        });
        let got = get_cached_access().unwrap();
        assert_eq!(got.token, "second");
        assert_eq!(got.expires_at, 200);
        clear_cached_access();
    }
}
