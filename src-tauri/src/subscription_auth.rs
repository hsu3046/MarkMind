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

use base64::Engine;
use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// Claude 호출 인증 소스 — UI 토글값. `#[serde(default)]` 로 기존 호출은 API 키 유지.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ClaudeAuthMode {
    #[default]
    ApiKey,
    Subscription,
}

/// AI 회사(company) — 전역 모델 설정. JS `aiModelConfig.AICompany` 와 값 일치.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AICompany {
    #[default]
    Gemini,
    Claude,
    Openai,
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
/// 만료 정보(expires_at)가 없을 때 토큰 캐시 유효시간 — keychain 재접근(인증창) 빈도 제한용.
const CLAUDE_CACHE_FALLBACK_MS: u64 = 50 * 60 * 1000;

/// Claude access token 세션 캐시. AI 호출마다 keychain `get_password`(Claude Code 가 만든
/// **다른 앱 항목**이라 매번 macOS ACL 인증창) 하지 않도록, 유효 토큰을 만료 전까지 메모리에
/// 보관 → 앱 실행당 1번만 읽는다("항상 허용"까지 누르면 사실상 0번). 만료/refresh 시에만 재읽기.
struct CachedClaudeToken {
    access_token: String,
    expires_at: u64, // epoch ms — REFRESH_SKEW 적용해 만료 전이면 재사용
}
static CLAUDE_TOKEN_CACHE: Mutex<Option<CachedClaudeToken>> = Mutex::new(None);

/// keychain JSON 의 `claudeAiOauth` 객체. 알려진 필드 외(scopes/subscriptionType 등)는
/// `extra` 로 캡처해 write-back 시 **그대로 보존**한다.
#[derive(Serialize, Deserialize, Clone)]
struct ClaudeOauth {
    #[serde(rename = "accessToken")]
    access_token: String,
    #[serde(
        rename = "refreshToken",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    refresh_token: Option<String>,
    /// unix epoch milliseconds.
    #[serde(rename = "expiresAt", default, skip_serializing_if = "Option::is_none")]
    expires_at: Option<u64>,
    /// 구독 종류 — "max" / "pro" 등 (플랜 표시용, write-back 보존).
    #[serde(
        rename = "subscriptionType",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    subscription_type: Option<String>,
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

/// Claude Code 로그인 "존재"만 확인 — `security find`(비밀번호 `-g` 없이)로 keychain 항목
/// 메타만 조회하므로 **인증창이 뜨지 않는다**. 실제 토큰은 `claude_access_token()` 이 호출
/// 시 1번 `get_password`(그때만 인증). 감지(detect)는 이 함수를 써서 앱 시작 인증창을 없앤다.
/// (keyring crate 의 get_password 는 항상 ACL 인증을 요구해, 다른 앱 항목인 Claude Code
///  토큰을 읽으면 새 빌드/인스톨마다 인증창이 떴다.)
fn claude_logged_in() -> bool {
    std::process::Command::new("security")
        .args([
            "find-generic-password",
            "-s",
            CLAUDE_KEYCHAIN_SERVICE,
            "-a",
            &current_user(),
        ])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn write_claude_creds(creds: &ClaudeCreds) -> Result<(), String> {
    let json = serde_json::to_string(creds).map_err(|e| e.to_string())?;
    claude_entry()?
        .set_password(&json)
        .map_err(|e| e.to_string())
}

/// 유효한 Claude 구독 access token 반환. 만료 임박이면 refresh 후 keychain write-back.
///
/// write-back 실패(권한 프롬프트 거부 등)는 치명적이지 않다 — 이번 호출용 토큰은 그대로 반환.
pub async fn claude_access_token() -> Result<String, String> {
    // 1) 세션 캐시 — 만료 전이면 keychain 접근 없이 반환(매 AI 호출 인증창 회피).
    if let Ok(cache) = CLAUDE_TOKEN_CACHE.lock() {
        if let Some(c) = cache.as_ref() {
            if now_ms().saturating_add(REFRESH_SKEW_MS) < c.expires_at {
                return Ok(c.access_token.clone());
            }
        }
    }

    // 2) 캐시 없음/만료 — 여기서만 get_password(인증창은 세션당 1회, "항상 허용" 시 0회).
    let mut creds = read_claude_creds().ok_or_else(|| {
        "Claude Code 로그인을 찾을 수 없습니다. 터미널에서 `claude` 로 로그인하세요.".to_string()
    })?;

    let needs_refresh = match creds.claude_ai_oauth.expires_at {
        Some(exp) => now_ms().saturating_add(REFRESH_SKEW_MS) >= exp,
        None => false, // 만료 정보가 없으면 일단 보유 토큰으로 시도
    };

    let token = if !needs_refresh {
        creds.claude_ai_oauth.access_token.clone()
    } else {
        let refresh_token = creds.claude_ai_oauth.refresh_token.clone().ok_or_else(|| {
            "refresh token 이 없습니다. 터미널에서 `claude` 재로그인하세요.".to_string()
        })?;
        let refreshed = refresh_claude_token(&refresh_token).await?;
        creds.claude_ai_oauth.access_token = refreshed.access_token.clone();
        if refreshed.refresh_token.is_some() {
            creds.claude_ai_oauth.refresh_token = refreshed.refresh_token;
        }
        if refreshed.expires_in > 0 {
            creds.claude_ai_oauth.expires_at = Some(now_ms() + refreshed.expires_in * 1000);
        }
        let _ = write_claude_creds(&creds); // best-effort
        refreshed.access_token
    };

    // 3) 세션 캐시에 저장 — 만료 정보가 없으면 fallback TTL 로(드문 경우).
    let cache_exp = match creds.claude_ai_oauth.expires_at {
        Some(e) if e > 0 => e,
        _ => now_ms() + CLAUDE_CACHE_FALLBACK_MS,
    };
    if let Ok(mut cache) = CLAUDE_TOKEN_CACHE.lock() {
        *cache = Some(CachedClaudeToken {
            access_token: token.clone(),
            expires_at: cache_exp,
        });
    }

    Ok(token)
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
    let raw = std::fs::read_to_string(&path).map_err(|_| {
        "Codex 로그인을 찾을 수 없습니다. 터미널에서 `codex` 로 로그인하세요.".to_string()
    })?;
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

// ─── Grok (xAI) — Grok Build CLI auth.json 토큰 재사용 ────────────────────────
//
// `grok login`(OAuth) 후 `~/.grok/auth.json` 에 OIDC access token 저장. 같은 토큰을
// Bearer 로 api.x.ai 에 쓰면 API 키 경로(grok.rs)와 동일하게 동작한다 — 단 **유료(SuperGrok)
// 구독 필요**. 무료/크레딧0 계정은 api.x.ai 가 403(personal-team-blocked:spending-limit).

fn grok_auth_path() -> Option<std::path::PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(std::path::Path::new(&home).join(".grok").join("auth.json"))
}

/// `~/.grok/auth.json` 에서 access token(첫 scope 의 `key`)을 읽는다.
/// 구조: `{ "<scope>": { "key": "<jwt>", "refresh_token": ..., "expires_at": ... } }`.
/// (만료 refresh 미구현 — 만료 시 401 → `grok login` 재로그인 안내. Codex 와 동일.)
pub fn read_grok_token() -> Result<String, String> {
    let path = grok_auth_path().ok_or_else(|| "HOME 환경변수를 찾을 수 없습니다.".to_string())?;
    let raw = std::fs::read_to_string(&path).map_err(|_| {
        "Grok 로그인을 찾을 수 없습니다. 터미널에서 `grok login` 으로 로그인하세요.".to_string()
    })?;
    let v: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("auth.json 파싱 실패: {e}"))?;
    let obj = v
        .as_object()
        .ok_or_else(|| "auth.json 형식이 올바르지 않습니다.".to_string())?;
    let token = obj
        .values()
        .find_map(|scope| scope.get("key").and_then(|k| k.as_str()))
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            "Grok access token 이 없습니다. `grok login` 재로그인이 필요합니다.".to_string()
        })?;
    Ok(token.to_string())
}

/// Grok 로그인 존재 여부 (`~/.grok/auth.json` 의 scope.key 유무).
pub fn grok_logged_in() -> bool {
    let Some(path) = grok_auth_path() else {
        return false;
    };
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return false;
    };
    serde_json::from_str::<serde_json::Value>(&raw)
        .ok()
        .and_then(|v| {
            v.as_object().map(|o| {
                o.values().any(|s| {
                    s.get("key")
                        .and_then(|k| k.as_str())
                        .map(|k| !k.is_empty())
                        .unwrap_or(false)
                })
            })
        })
        .unwrap_or(false)
}

// ─── Tauri command ──────────────────────────────────────────────────────────

/// 첫 글자만 대문자화 ("max" → "Max", "plus" → "Plus").
fn capitalize(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        Some(f) => f.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

/// JWT(헤더.페이로드.서명) 의 payload(base64url) 를 JSON 으로 디코드.
fn decode_jwt_payload(jwt: &str) -> Option<serde_json::Value> {
    let payload = jwt.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// Codex 플랜 라벨 — id_token JWT 의 chatgpt_plan_type ("plus" → "Plus"). 없으면 None.
fn codex_plan_label() -> Option<String> {
    let path = codex_auth_path()?;
    let raw = std::fs::read_to_string(&path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let id_token = v.get("tokens")?.get("id_token")?.as_str()?;
    let payload = decode_jwt_payload(id_token)?;
    let plan = payload
        .get("https://api.openai.com/auth")?
        .get("chatgpt_plan_type")?
        .as_str()?;
    if plan.is_empty() {
        None
    } else {
        Some(capitalize(plan))
    }
}

/// Gemini 구독 사용 가능 여부 — agy 바이너리 설치 + Antigravity 인증(Keychain) 추정.
/// agy 는 Antigravity IDE 와 Keychain 을 공유하므로 "Antigravity Safe Storage" 존재로
/// 인증을 추정한다(토큰 값은 안 읽고 존재 여부만). 실제 인증 확정은 호출 시 빈 응답으로 판별.
fn gemini_agy_available() -> bool {
    let installed = ["/opt/homebrew/bin/agy", "/usr/local/bin/agy"]
        .iter()
        .any(|p| std::path::Path::new(p).exists())
        || std::process::Command::new("which")
            .arg("agy")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
    if !installed {
        return false;
    }
    std::process::Command::new("security")
        .args(["find-generic-password", "-s", "Antigravity Safe Storage"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// 구독 로그인 감지 결과 (UI 배지용 — 토큰 값은 절대 포함하지 않음, 플랜명만).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionStatus {
    pub claude: bool,
    pub codex: bool,
    /// Gemini(Antigravity CLI) — agy 설치 + 인증(IDE Keychain 공유) 시 true.
    pub gemini: bool,
    /// Grok(xAI) — `grok login`(auth.json) 토큰 존재 시 true. 단 실제 API 가용은
    /// 유료(SuperGrok) 필요 — 무료/크레딧0 은 호출 시 403. 감지는 토큰 유무만.
    pub grok: bool,
    /// Claude 플랜명 ("Max" 등). 미연결/미상이면 None.
    pub claude_plan: Option<String>,
    /// ChatGPT 플랜명 ("Plus" 등). 미연결/미상이면 None.
    pub codex_plan: Option<String>,
    /// Gemini 플랜명. agy 는 플랜 정보를 안 주므로 "Antigravity" 고정 또는 None.
    pub gemini_plan: Option<String>,
    /// Grok 플랜명. auth.json 에 등급 정보 없어 None(로그인 표시만).
    pub grok_plan: Option<String>,
}

#[tauri::command]
pub fn detect_subscription_logins() -> SubscriptionStatus {
    // 감지 단계는 토큰을 읽지 않는다(앱 시작 keychain 인증창 회피). Claude 는 항목 "존재"만
    // security 로 확인, Codex/Grok 은 파일, Gemini 는 agy 바이너리 + security(메타). 실제 토큰
    // get_password 는 해당 구독으로 LLM 을 호출할 때 1번만 일어난다.
    let claude = claude_logged_in();
    let codex = codex_logged_in();
    let gemini = gemini_agy_available();
    let grok = grok_logged_in();
    SubscriptionStatus {
        claude,
        codex,
        gemini,
        grok,
        // Claude 플랜(Max 등)도 토큰 안에 있어 감지 단계에선 읽지 않는다(인증창 회피) → None.
        // Gemini/Grok 도 None(표시 통일). Codex 는 파일(id_token)이라 인증창 없이 plan 추출 가능.
        claude_plan: None,
        codex_plan: if codex { codex_plan_label() } else { None },
        // 표시 통일 — agy 가 실제 등급(AI Pro/Ultra)을 노출하지 않으므로, 방식명("Antigravity")
        // 대신 "연결됨"만 표시(Grok 과 동일). 실등급 추출 경로 생기면 그때 채운다.
        gemini_plan: None,
        grok_plan: None,
    }
}
