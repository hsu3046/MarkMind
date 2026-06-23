/**
 * API 키 / OAuth credentials 검증 — 각 provider 의 최소 호출로 ping 테스트.
 * 결과는 localStorage 에 캐시 (다음 모달 진입 시 즉시 표시).
 *
 * - Gemini: GET /v1beta/models (key 쿼리)
 * - Claude: POST /v1/messages with max_tokens=1
 * - OpenAI: GET /v1/models (Bearer)
 * - Google Drive OAuth: client_id 형식 정규식 ('.apps.googleusercontent.com' 끝)
 *   + secret 비어있지 않음 (실제 OAuth flow 는 사용자 동의 필요 → "Google Drive 연결" 클릭 시 검증)
 */

export type Provider = 'gemini' | 'claude' | 'openai' | 'grok' | 'pyannoteai' | 'unsplash' | 'pexels' | 'brandfetch';
export type ValidationKey = Provider | 'gdrive';
export type ValidationResult = 'valid' | 'invalid' | 'error';

const STORAGE_PREFIX = 'markmind-valid-';

// ─── 검증 함수들 ──────────────────────────────────────────────

export async function validateGemini(key: string): Promise<ValidationResult> {
    try {
        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
        );
        if (res.ok) return 'valid';
        if (res.status === 400 || res.status === 401 || res.status === 403) return 'invalid';
        return 'error';
    } catch {
        return 'error';
    }
}

export async function validateClaude(key: string): Promise<ValidationResult> {
    try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': key,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true',
            },
            body: JSON.stringify({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 1,
                messages: [{ role: 'user', content: 'ping' }],
            }),
        });
        if (res.ok) return 'valid';
        if (res.status === 400 || res.status === 401 || res.status === 403) return 'invalid';
        return 'error';
    } catch {
        return 'error';
    }
}

export async function validateOpenAI(key: string): Promise<ValidationResult> {
    try {
        const res = await fetch('https://api.openai.com/v1/models', {
            headers: { Authorization: `Bearer ${key}` },
        });
        if (res.ok) return 'valid';
        if (res.status === 401 || res.status === 403) return 'invalid';
        return 'error';
    } catch {
        return 'error';
    }
}

export async function validateProvider(
    provider: Provider,
    key: string,
): Promise<ValidationResult> {
    if (!key.trim()) return 'invalid';
    switch (provider) {
        case 'gemini':
            return validateGemini(key);
        case 'claude':
            return validateClaude(key);
        case 'openai':
            return validateOpenAI(key);
        case 'grok':
            // Grok(xAI) 키는 브라우저 CORS 가 불확실 → 형식(존재)만 확인.
            // 실제 인증은 호출 시 Rust 백엔드(grok 모듈)에서 검증된다.
            return key.trim() ? 'valid' : 'invalid';
        case 'pyannoteai':
            // pyannote.ai 키는 브라우저 CORS 로 ping 이 막힐 수 있어 형식(존재)만 확인.
            // 실제 인증은 변환 시 Rust 백엔드(diarize_cloud)에서 검증된다.
            return key.trim() ? 'valid' : 'invalid';
        case 'unsplash':
        case 'pexels':
        case 'brandfetch':
            // Stock 이미지 API 키도 실제 호출은 Rust 백엔드에서 수행한다.
            // 브라우저 검증은 CORS/rate limit 영향을 받을 수 있어 존재 여부만 확인한다.
            return key.trim() ? 'valid' : 'invalid';
    }
}

/** Google OAuth client_id + secret 형식 검증 (실제 동작은 OAuth flow 에서 확인) */
export function validateGoogleCredsFormat(clientId: string, clientSecret: string): boolean {
    const id = clientId.trim();
    const secret = clientSecret.trim();
    return /\.apps\.googleusercontent\.com$/i.test(id) && secret.length > 0;
}

// ─── 검증 상태 캐시 (localStorage) ──────────────────────────────────────────────

export function setValidationStatus(key: ValidationKey, result: ValidationResult): void {
    // 일시 실패(error: 네트워크/rate limit 등)는 "키가 틀린 것"이 아니라 "확인을 못 한 것".
    // 이미 valid 인 키를 error 로 덮어쓰면 멀쩡한 키가 "확인 필요"로 뒤집힌다 → 보존.
    // (invalid: 400/401/403 는 진짜 키 문제이므로 그대로 덮어쓴다.)
    if (result === 'error' && getValidationStatus(key) === 'valid') return;
    localStorage.setItem(`${STORAGE_PREFIX}${key}`, result);
}

/** null = 아직 검증 안 됨 */
export function getValidationStatus(key: ValidationKey): ValidationResult | null {
    const v = localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (v === 'valid' || v === 'invalid' || v === 'error') return v;
    return null;
}

export function clearValidationStatus(key: ValidationKey): void {
    localStorage.removeItem(`${STORAGE_PREFIX}${key}`);
}
