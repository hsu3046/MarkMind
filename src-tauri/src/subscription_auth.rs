//! 구독 OAuth 토큰 재사용 — 사용자가 로컬에 로그인해 둔 Claude Code / Codex CLI 의
//! OAuth 토큰을 읽어 **본인 구독**으로 LLM 을 호출하기 위한 모듈.
//!
//! ## 전제 / 범위
//! - **본인 머신·본인 구독 한정.** Claude Code / Codex CLI 를 직접 실행하는 것과 같은 범주
//!   (앱이 타인에게 claude.ai/ChatGPT 로그인을 *제공*하는 것은 약관 위반 — 그건 하지 않는다).
//! - 호출 경로(헤더/엔드포인트)는 공식 문서화된 것이 아니라 CLI 동작을 따른 것이라
//!   공급사가 임의로 바꾸면 깨질 수 있다. 따라서 호출부는 **API 키 fallback 을 항상 함께** 둔다.
//!
//! ## 보안
//! - 토큰 값은 메모리에서만 다루고 **로그·파일·IPC 응답에 절대 노출하지 않는다**
//!   (`detect_*` 는 로그인 여부 bool 만 반환).
//!
//! 현재 구현(Phase 1+2):
//! - Claude: keychain 토큰 읽기 + 만료 시 refresh + 유효 access token 반환 (호출에 사용).
//! - Codex: 로그인 여부 감지만 (실제 호출은 후속 Phase).

use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

/// Claude 호출 인증 소스 — UI 토글값. `#[serde(default)]` 로 기존 호출은 API 키 유지.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ClaudeAuthMode {
    #[default]
    ApiKey,
    Subscription,
}

// ─── Claude Code (Anthropic) ────────────────────────────────────────────────

/// Claude Code 가 OAuth 토큰을 저장하는 macOS Keychain service 이름.
/// account 는 현재 사용자명($USER).
const CLAUDE_KEYCHAIN_SERVICE: &str = "Claude Code-credentials";
/// Claude Code CLI 의 공개 OAuth client_id (refresh grant 에 필요).
const CLAUDE_OAUTH_CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const CLAUDE_TOKEN_URL: &str = "https://console.anthropic.com/v1/oauth/token";
/// access token 만료 임박 시 미리 refresh 하는 버퍼 (5분, ms).
const REFRESH_SKEW_MS: u64 = 5 * 60 * 1000;

/// keychain JSON 의 `claudeAiOauth` 객체. 알려진 필드 외(scopes/subscriptionType 등)는
/// `extra` 로 캡처해 write-back 시 **그대로 보존**한다.
#[derive(Serialize, Deserialize, Clone)]
struct ClaudeOauth {
    #[serde(rename = "accessToken")]
    access_token: String,
    #[serde(rename = "refreshToken", default, skip_serializing_if = "Option::is_none")]
    refresh_token: Option<String>,
    /// unix epoch milliseconds.
    #[serde(rename = "expiresAt", default, skip_serializing_if = "Option::is_none")]
    expires_at: Option<u64>,
    #[serde(flatten)]
    extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Serialize, Deserialize)]
struct ClaudeCreds {
    #[serde(rename = "claudeAiOauth")]
    claude_ai_oauth: ClaudeOauth,
    #[serde(flatten)]
    extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Deserialize)]
struct RefreshResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    /// seconds until expiry.
    #[serde(default)]
    expires_in: u64,
}

fn current_user() -> String {
    std::env::var("USER").unwrap_or_default()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn claude_entry() -> Result<Entry, String> {
    Entry::new(CLAUDE_KEYCHAIN_SERVICE, &current_user()).map_err(|e| e.to_string())
}

fn read_claude_creds() -> Option<ClaudeCreds> {
    let raw = claude_entry().ok()?.get_password().ok()?;
    serde_json::from_str::<ClaudeCreds>(&raw).ok()
}

fn write_claude_creds(creds: &ClaudeCreds) -> Result<(), String> {
    let json = serde_json::to_string(creds).map_err(|e| e.to_string())?;
    claude_entry()?.set_password(&json).map_err(|e| e.to_string())
}

/// Claude Code 로그인 존재 여부 (토큰 값은 노출하지 않음).
pub fn claude_logged_in() -> bool {
    read_claude_creds()
        .map(|c| !c.claude_ai_oauth.access_token.is_empty())
        .unwrap_or(false)
}

/// 유효한 Claude 구독 access token 반환. 만료 임박이면 refresh 후 keychain write-back.
///
/// write-back 실패(권한 프롬프트 거부 등)는 치명적이지 않다 — 이번 호출용 토큰은 그대로 반환.
pub async fn claude_access_token() -> Result<String, String> {
    let mut creds = read_claude_creds().ok_or_else(|| {
        "Claude Code 로그인을 찾을 수 없습니다. 터미널에서 `claude` 로 로그인하세요.".to_string()
    })?;

    let needs_refresh = match creds.claude_ai_oauth.expires_at {
        Some(exp) => now_ms().saturating_add(REFRESH_SKEW_MS) >= exp,
        None => false, // 만료 정보가 없으면 일단 보유 토큰으로 시도
    };
    if !needs_refresh {
        return Ok(creds.claude_ai_oauth.access_token.clone());
    }

    let refresh_token = creds
        .claude_ai_oauth
        .refresh_token
        .clone()
        .ok_or_else(|| "refresh token 이 없습니다. 터미널에서 `claude` 재로그인하세요.".to_string())?;

    let refreshed = refresh_claude_token(&refresh_token).await?;

    creds.claude_ai_oauth.access_token = refreshed.access_token.clone();
    if refreshed.refresh_token.is_some() {
        creds.claude_ai_oauth.refresh_token = refreshed.refresh_token;
    }
    if refreshed.expires_in > 0 {
        creds.claude_ai_oauth.expires_at = Some(now_ms() + refreshed.expires_in * 1000);
    }
    let _ = write_claude_creds(&creds); // best-effort

    Ok(refreshed.access_token)
}

async fn refresh_claude_token(refresh_token: &str) -> Result<RefreshResponse, String> {
    let body = serde_json::json!({
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": CLAUDE_OAUTH_CLIENT_ID,
    });
    let resp = reqwest::Client::new()
        .post(CLAUDE_TOKEN_URL)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Claude 토큰 갱신 요청 실패: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!(
            "Claude 토큰 갱신 실패 (HTTP {}). `claude` 재로그인이 필요할 수 있습니다.",
            resp.status().as_u16()
        ));
    }
    resp.json::<RefreshResponse>()
        .await
        .map_err(|e| format!("Claude 토큰 갱신 응답 파싱 실패: {e}"))
}

// ─── Codex (ChatGPT) — 현재는 감지만 ─────────────────────────────────────────

fn codex_auth_path() -> Option<std::path::PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(std::path::Path::new(&home).join(".codex").join("auth.json"))
}

/// Codex 호출에 필요한 토큰 (값은 메모리에서만).
pub struct CodexTokens {
    pub access_token: String,
    pub account_id: Option<String>,
}

/// `~/.codex/auth.json` 에서 access_token + account_id 를 읽는다.
/// (만료 refresh 는 미구현 — 만료 시 `codex` 재로그인 안내. 후속 Phase 에서 추가.)
pub fn read_codex_tokens() -> Result<CodexTokens, String> {
    let path = codex_auth_path().ok_or_else(|| "HOME 환경변수를 찾을 수 없습니다.".to_string())?;
    let raw = std::fs::read_to_string(&path)
        .map_err(|_| "Codex 로그인을 찾을 수 없습니다. 터미널에서 `codex` 로 로그인하세요.".to_string())?;
    let v: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("auth.json 파싱 실패: {e}"))?;
    let tokens = v
        .get("tokens")
        .ok_or_else(|| "auth.json 에 tokens 가 없습니다.".to_string())?;
    let access_token = tokens
        .get("access_token")
        .and_then(|a| a.as_str())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "access_token 이 없습니다. `codex` 재로그인이 필요합니다.".to_string())?
        .to_string();
    let account_id = tokens
        .get("account_id")
        .and_then(|a| a.as_str())
        .map(String::from);
    Ok(CodexTokens {
        access_token,
        account_id,
    })
}

/// Codex 로그인 존재 여부 (`~/.codex/auth.json` 의 `tokens.access_token` 유무).
pub fn codex_logged_in() -> bool {
    let Some(path) = codex_auth_path() else {
        return false;
    };
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return false;
    };
    serde_json::from_str::<serde_json::Value>(&raw)
        .ok()
        .and_then(|v| {
            v.get("tokens")
                .and_then(|t| t.get("access_token"))
                .and_then(|a| a.as_str())
                .map(|s| !s.is_empty())
        })
        .unwrap_or(false)
}

// ─── Tauri command ──────────────────────────────────────────────────────────

/// 구독 로그인 감지 결과 (UI 배지용 — 토큰 값은 절대 포함하지 않음).
#[derive(Serialize)]
pub struct SubscriptionStatus {
    pub claude: bool,
    pub codex: bool,
}

#[tauri::command]
pub fn detect_subscription_logins() -> SubscriptionStatus {
    SubscriptionStatus {
        claude: claude_logged_in(),
        codex: codex_logged_in(),
    }
}
