//! Google OAuth 2.0 PKCE flow + token refresh.
//!
//! 흐름:
//! 1. tiny_http 로 127.0.0.1:<random> loopback server 시작
//! 2. PKCE challenge 생성
//! 3. Google OAuth URL 을 기본 브라우저로 open
//! 4. 사용자가 동의하면 Google → http://127.0.0.1:<port>/?code=... 로 redirect
//! 5. code 를 받아 token endpoint 에 POST → refresh_token + access_token
//! 6. refresh_token 은 Keychain, access_token 은 메모리 캐시
//! 7. user email 도 함께 가져와 저장
//!
//! Refresh: access_token 만료 시 refresh_token 으로 갱신.

use super::error::{GDriveError, GDriveResult};
use super::storage::{self, AccessTokenCache};
use super::SCOPE;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use std::time::{Duration, SystemTime, UNIX_EPOCH}; // SystemTime/UNIX_EPOCH: now_secs() 내부
use tiny_http::{Response, Server};

const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
// Drive API /about?fields=user — drive.file scope 만으로 user.emailAddress 조회 가능.
// 별도 userinfo.email scope 추가 불필요.

/// 콜백 대기 타임아웃 (5분)
const CALLBACK_TIMEOUT_SECS: u64 = 300;

/// 현재 UNIX epoch 초. SystemTime 실패 시 0 fallback (clock skew 보호).
fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// PKCE code_verifier — 43~128자 URL-safe.
fn gen_code_verifier() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(&bytes)
}

/// PKCE code_challenge = base64url(sha256(verifier))
fn gen_code_challenge(verifier: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(hasher.finalize())
}

/// CSRF state — random 32 bytes URL-safe.
fn gen_state() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(&bytes)
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: u64,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    #[allow(dead_code)] // OAuth 응답 스키마 보존 — 값은 현재 미사용
    scope: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ConnectResult {
    pub email: String,
}

/// OAuth flow 시작 → refresh_token + access_token 획득 후 저장.
/// 반환값: 연결된 사용자 email.
pub async fn connect() -> GDriveResult<ConnectResult> {
    let (client_id, client_secret) = storage::get_client_credentials()?
        .ok_or(GDriveError::NotConfigured)?;

    // 1. loopback server 시작 (random port)
    let server = Server::http("127.0.0.1:0")
        .map_err(|e| GDriveError::OAuth(format!("loopback server 시작 실패: {}", e)))?;
    let port = server
        .server_addr()
        .to_ip()
        .ok_or_else(|| GDriveError::OAuth("loopback addr 없음".into()))?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{}", port);

    // 2. PKCE + state 생성
    let code_verifier = gen_code_verifier();
    let code_challenge = gen_code_challenge(&code_verifier);
    let state = gen_state();

    // 3. Google OAuth URL 빌드
    let auth_url = format!(
        "{}?client_id={}&redirect_uri={}&response_type=code&scope={}&code_challenge={}&code_challenge_method=S256&access_type=offline&prompt=consent&state={}",
        AUTH_URL,
        urlencoding::encode(&client_id),
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(SCOPE),
        urlencoding::encode(&code_challenge),
        urlencoding::encode(&state),
    );

    // 4. 브라우저 open — std 의 std::process::Command 로 macOS open 호출
    //    tauri-plugin-opener 는 AppHandle 필요해서 여기선 직접 호출
    open_url(&auth_url)?;

    // 5. 콜백 대기 (blocking — tokio::spawn_blocking 권장)
    let (code, returned_state) = tokio::task::spawn_blocking(move || wait_for_callback(server))
        .await
        .map_err(|e| GDriveError::OAuth(format!("콜백 task join 실패: {}", e)))??;

    // 6. CSRF state 검증
    if returned_state != state {
        return Err(GDriveError::OAuth("state mismatch (CSRF 의심)".into()));
    }

    // 7. code → token 교환
    let token = exchange_code(&code, &code_verifier, &redirect_uri, &client_id, &client_secret).await?;

    // 8. refresh_token 확보 (없으면 에러 — access_type=offline + prompt=consent 이면 항상 옴)
    let refresh = token
        .refresh_token
        .ok_or_else(|| GDriveError::OAuth("refresh_token 없음 (이미 동의한 적 있는 계정?)".into()))?;

    // 9. access_token 메모리 캐시 (Keychain 무관)
    let now = now_secs();
    storage::set_cached_access(AccessTokenCache {
        token: token.access_token.clone(),
        expires_at: now + token.expires_in.saturating_sub(60), // 60s 버퍼
    });

    // 10. user email 조회. 실패 시 cache 만 정리 후 에러 (refresh_token 아직 저장 전).
    let email = match fetch_user_email(&token.access_token).await {
        Ok(e) => e,
        Err(err) => {
            storage::clear_cached_access();
            return Err(err);
        }
    };

    // 11. refresh_token + email 을 한 번의 Keychain write 로 저장 (다이얼로그 1회)
    storage::save_oauth_result(&refresh, &email)?;

    Ok(ConnectResult { email })
}

/// 캐시된 access_token 이 유효하면 반환. 만료/없으면 refresh_token 으로 갱신.
pub async fn get_or_refresh_access_token() -> GDriveResult<String> {
    let (client_id, client_secret) = storage::get_client_credentials()?
        .ok_or(GDriveError::NotConfigured)?;

    let now = now_secs();

    // 1. 캐시 hit
    if let Some(cached) = storage::get_cached_access() {
        if cached.expires_at > now {
            return Ok(cached.token);
        }
    }

    // 2. refresh_token 으로 갱신
    let refresh = storage::get_refresh_token()?
        .ok_or(GDriveError::NotAuthenticated)?;
    let token = refresh_access_token(&refresh, &client_id, &client_secret).await?;

    storage::set_cached_access(AccessTokenCache {
        token: token.access_token.clone(),
        expires_at: now + token.expires_in.saturating_sub(60),
    });

    Ok(token.access_token)
}

/// code + code_verifier → token endpoint POST
async fn exchange_code(
    code: &str,
    verifier: &str,
    redirect_uri: &str,
    client_id: &str,
    client_secret: &str,
) -> GDriveResult<TokenResponse> {
    let params = [
        ("code", code),
        ("client_id", client_id),
        ("client_secret", client_secret),
        ("redirect_uri", redirect_uri),
        ("grant_type", "authorization_code"),
        ("code_verifier", verifier),
    ];

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()?;
    let res = client.post(TOKEN_URL).form(&params).send().await?;
    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(GDriveError::OAuth(format!(
            "token exchange 실패 ({}): {}",
            status, body
        )));
    }
    let token: TokenResponse = res.json().await?;
    Ok(token)
}

/// refresh_token 으로 access_token 갱신
async fn refresh_access_token(
    refresh_token: &str,
    client_id: &str,
    client_secret: &str,
) -> GDriveResult<TokenResponse> {
    let params = [
        ("client_id", client_id),
        ("client_secret", client_secret),
        ("refresh_token", refresh_token),
        ("grant_type", "refresh_token"),
    ];

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()?;
    let res = client.post(TOKEN_URL).form(&params).send().await?;
    let status = res.status();
    if !status.is_success() {
        // 400/401 + body 의 error 가 "invalid_grant" 일 때만 진짜 revoked → disconnect.
        // 일시적 네트워크 / rate limit 으로 인한 400 으로 세션 강제 종료 방지.
        if status.as_u16() == 400 || status.as_u16() == 401 {
            let body = res.text().await.unwrap_or_default();
            if body.contains("invalid_grant") {
                let _ = storage::disconnect();
            }
        }
        return Err(GDriveError::TokenRefreshFailed);
    }
    let token: TokenResponse = res.json().await?;
    Ok(token)
}

/// Drive API /about?fields=user 로 사용자 emailAddress 조회.
/// drive.file scope 만으로 동작 — 별도 userinfo.email scope 불필요.
async fn fetch_user_email(access_token: &str) -> GDriveResult<String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()?;
    let url = format!("{}/about?fields=user", super::DRIVE_API_BASE);
    let res = client.get(&url).bearer_auth(access_token).send().await?;
    if !res.status().is_success() {
        return Err(GDriveError::OAuth(format!(
            "user 정보 조회 실패: {}",
            res.status()
        )));
    }
    let data: serde_json::Value = res.json().await?;
    let email = data
        .get("user")
        .and_then(|u| u.get("emailAddress"))
        .and_then(|e| e.as_str())
        .ok_or_else(|| GDriveError::OAuth("emailAddress 필드 없음".into()))?;
    Ok(email.to_string())
}

/// loopback callback — Google 이 redirect 한 URL 에서 code + state 추출.
/// 사용자 브라우저에 성공/실패 페이지를 응답으로 보냄.
fn wait_for_callback(server: Server) -> GDriveResult<(String, String)> {
    let deadline = std::time::Instant::now() + Duration::from_secs(CALLBACK_TIMEOUT_SECS);

    loop {
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() {
            return Err(GDriveError::OAuth("OAuth 콜백 타임아웃 (5분)".into()));
        }

        let request = match server.recv_timeout(remaining) {
            Ok(Some(req)) => req,
            Ok(None) => continue, // timeout this iter
            Err(e) => return Err(GDriveError::OAuth(format!("server recv 오류: {}", e))),
        };

        let url = request.url().to_string();
        // 예: "/?code=xxx&state=yyy" 또는 "/?error=access_denied"
        let parsed = url::Url::parse(&format!("http://localhost{}", url))
            .map_err(|e| GDriveError::OAuth(format!("URL 파싱 실패: {}", e)))?;

        let mut code: Option<String> = None;
        let mut state: Option<String> = None;
        let mut err: Option<String> = None;
        for (k, v) in parsed.query_pairs() {
            match k.as_ref() {
                "code" => code = Some(v.into_owned()),
                "state" => state = Some(v.into_owned()),
                "error" => err = Some(v.into_owned()),
                _ => {}
            }
        }

        if let Some(e) = err {
            let _ = respond_html(request, &error_page(&format!("인증 거부됨: {}", e)));
            return Err(GDriveError::OAuth(format!("Google 인증 거부: {}", e)));
        }

        match (code, state) {
            (Some(c), Some(s)) => {
                let _ = respond_html(request, &success_page());
                return Ok((c, s));
            }
            _ => {
                // 다른 path (예: favicon.ico) 는 무시하고 다음 요청 대기
                let _ = respond_html(request, "<h1>Waiting…</h1>");
                continue;
            }
        }
    }
}

fn respond_html(request: tiny_http::Request, html: &str) -> std::io::Result<()> {
    let body = html.as_bytes();
    let response = Response::new(
        tiny_http::StatusCode(200),
        vec![tiny_http::Header::from_bytes(
            &b"Content-Type"[..],
            &b"text/html; charset=utf-8"[..],
        )
        .unwrap()],
        Cursor::new(body.to_vec()),
        Some(body.len()),
        None,
    );
    request.respond(response)
}

const BASE_STYLE: &str = r#"
:root { color-scheme: light dark; --bg: #fafaf6; --fg: #1a1d27; --muted: #6b7080; --err: #d04545; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #0f1117; --fg: #e8eaf0; --muted: #7b82a0; --err: #ff6b6b; }
}
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
       background: var(--bg); color: var(--fg);
       display: flex; align-items: center; justify-content: center;
       height: 100vh; margin: 0; }
.box { text-align: center; padding: 2rem; max-width: 480px; }
h1 { font-size: 1.5rem; margin: 0 0 0.5rem; font-weight: 600; }
.err h1 { color: var(--err); }
p { color: var(--muted); line-height: 1.5; }
"#;

fn success_page() -> String {
    format!(
        r#"<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"><title>MarkMind — 연결 완료</title>
<style>{}</style></head>
<body><div class="box">
  <h1>✓ Google Drive 연결 완료</h1>
  <p>이 창은 닫아도 됩니다. MarkMind 로 돌아가세요.</p>
</div></body></html>"#,
        BASE_STYLE
    )
}

fn error_page(msg: &str) -> String {
    // HTML escape — 사용자 입력이 아닌 Google error 코드이지만 안전 위해
    let escaped = msg
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");
    format!(
        r#"<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"><title>MarkMind — 연결 실패</title>
<style>{}</style></head>
<body><div class="box err">
  <h1>✗ 연결 실패</h1>
  <p>{}</p>
</div></body></html>"#,
        BASE_STYLE, escaped
    )
}

/// 기본 브라우저로 URL open (macOS: open, Windows: start, Linux: xdg-open)
fn open_url(url: &str) -> GDriveResult<()> {
    #[cfg(target_os = "macos")]
    let cmd = std::process::Command::new("open").arg(url).spawn();
    #[cfg(target_os = "windows")]
    let cmd = std::process::Command::new("cmd")
        .args(&["/C", "start", "", url])
        .spawn();
    #[cfg(target_os = "linux")]
    let cmd = std::process::Command::new("xdg-open").arg(url).spawn();

    cmd.map_err(|e| GDriveError::OAuth(format!("브라우저 open 실패: {}", e)))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn code_verifier_length_and_charset() {
        for _ in 0..100 {
            let v = gen_code_verifier();
            // 32 bytes → base64url (no padding) = 43 chars
            assert_eq!(v.len(), 43, "verifier length: {}", v);
            // URL-safe: only [A-Za-z0-9_-]
            for ch in v.chars() {
                assert!(
                    ch.is_ascii_alphanumeric() || ch == '-' || ch == '_',
                    "invalid char {:?} in verifier {}",
                    ch,
                    v
                );
            }
        }
    }

    #[test]
    fn code_challenge_matches_rfc7636_test_vector() {
        // RFC 7636 Appendix B
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        let expected = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
        assert_eq!(gen_code_challenge(verifier), expected);
    }

    #[test]
    fn state_is_url_safe_and_unique() {
        let mut seen = std::collections::HashSet::new();
        for _ in 0..1000 {
            let s = gen_state();
            // 16 bytes → 22 chars
            assert_eq!(s.len(), 22);
            for ch in s.chars() {
                assert!(ch.is_ascii_alphanumeric() || ch == '-' || ch == '_');
            }
            assert!(seen.insert(s), "duplicate state — entropy issue");
        }
    }

    #[test]
    fn now_secs_returns_positive_unix_time() {
        let t = now_secs();
        // 2026 년 기준 매우 안전한 lower bound
        assert!(t > 1_700_000_000, "got {}", t);
    }

    #[test]
    fn error_page_escapes_html() {
        let page = error_page("<script>alert(1)</script>");
        assert!(page.contains("&lt;script&gt;"));
        assert!(!page.contains("<script>alert(1)</script>"));
    }
}
