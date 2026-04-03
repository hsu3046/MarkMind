/**
 * KnowAI SSO Authentication Service (SPA / PKCE)
 *
 * Handles the full PKCE OAuth flow for MarkMind:
 *   1. Generate PKCE code_verifier + code_challenge
 *   2. Redirect to KnowAI authorize endpoint
 *   3. Exchange authorization code for tokens
 *   4. Refresh tokens on expiry
 *   5. Fetch user info
 *
 * Token storage (per EXTERNAL_API.md §1.8 SPA):
 *   - access_token → memory (variable)
 *   - refresh_token → sessionStorage
 *   - user_info → sessionStorage (UI display)
 */

import type { AuthUser, TokenResponse, MeResponse } from '../types/auth';

// ─── Configuration ────────────────────────────────────────

const KNOWAI_APP_ID = import.meta.env.VITE_KNOWAI_APP_ID || 'markmind';
const KNOWAI_API_URL = import.meta.env.VITE_KNOWAI_API_URL || 'https://www.knowai.space';
const BASE_URL = import.meta.env.VITE_BASE_URL || window.location.origin;

const CALLBACK_PATH = '/auth/callback';
const REDIRECT_URI = `${BASE_URL}${CALLBACK_PATH}`;

// Storage keys
const STORAGE_KEYS = {
    refreshToken: 'markmind-refresh-token',
    userInfo: 'markmind-user-info',
    codeVerifier: 'markmind-code-verifier',
    oauthState: 'markmind-oauth-state',
} as const;

// ─── In-memory token storage ──────────────────────────────

let accessToken: string | null = null;
let tokenExpiresAt: number | null = null;

// ─── PKCE Utilities ───────────────────────────────────────

/** Generate a cryptographically random string for PKCE code_verifier */
function generateRandomString(length: number): string {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    const randomValues = crypto.getRandomValues(new Uint8Array(length));
    return Array.from(randomValues, (v) => charset[v % charset.length]).join('');
}

/** SHA-256 hash → base64url encoded (for PKCE code_challenge) */
async function sha256Base64Url(plain: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(plain);
    const hash = await crypto.subtle.digest('SHA-256', data);
    // Convert ArrayBuffer to base64url
    const base64 = btoa(String.fromCharCode(...new Uint8Array(hash)));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Generate PKCE code_verifier and code_challenge pair */
async function generatePKCE(): Promise<{ codeVerifier: string; codeChallenge: string }> {
    const codeVerifier = generateRandomString(64);
    const codeChallenge = await sha256Base64Url(codeVerifier);
    return { codeVerifier, codeChallenge };
}

// ─── Public API ───────────────────────────────────────────

/**
 * Start SSO login flow.
 * Generates PKCE parameters and CSRF state, stores them, then redirects to KnowAI.
 */
export async function startLogin(): Promise<void> {
    const { codeVerifier, codeChallenge } = await generatePKCE();
    const state = generateRandomString(32);

    // Persist for callback verification
    sessionStorage.setItem(STORAGE_KEYS.codeVerifier, codeVerifier);
    sessionStorage.setItem(STORAGE_KEYS.oauthState, state);

    const params = new URLSearchParams({
        app_id: KNOWAI_APP_ID,
        redirect_uri: REDIRECT_URI,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
    });

    // Redirect to KnowAI authorize endpoint
    window.location.href = `${KNOWAI_API_URL}/api/x/authorize?${params.toString()}`;
}

/**
 * Handle the OAuth callback.
 * Validates CSRF state, exchanges code for tokens, stores user info.
 *
 * @returns AuthUser on success
 * @throws Error on validation or exchange failure
 */
export async function handleCallback(code: string, state: string): Promise<AuthUser> {
    // 1. CSRF state verification
    const storedState = sessionStorage.getItem(STORAGE_KEYS.oauthState);
    if (!storedState || storedState !== state) {
        // Clean up
        sessionStorage.removeItem(STORAGE_KEYS.oauthState);
        sessionStorage.removeItem(STORAGE_KEYS.codeVerifier);
        throw new Error('CSRF state mismatch — 인증이 유효하지 않습니다. 다시 시도해주세요.');
    }

    // 2. Retrieve code_verifier
    const codeVerifier = sessionStorage.getItem(STORAGE_KEYS.codeVerifier);
    if (!codeVerifier) {
        throw new Error('PKCE code_verifier not found — 다시 로그인해주세요.');
    }

    // 3. Clean up PKCE/state storage immediately
    sessionStorage.removeItem(STORAGE_KEYS.oauthState);
    sessionStorage.removeItem(STORAGE_KEYS.codeVerifier);

    // 4. Exchange code for tokens (PKCE flow)
    const response = await fetch(`${KNOWAI_API_URL}/api/x/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            code,
            app_id: KNOWAI_APP_ID,
            code_verifier: codeVerifier,
        }),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'unknown' }));
        throw new Error(`토큰 교환 실패: ${error.error || response.statusText}`);
    }

    const tokenData: TokenResponse = await response.json();

    // 5. Store tokens
    accessToken = tokenData.access_token;
    tokenExpiresAt = Date.now() + tokenData.expires_in * 1000;
    sessionStorage.setItem(STORAGE_KEYS.refreshToken, tokenData.refresh_token);

    // 6. Store user info for UI (per §1.9 dual storage strategy)
    sessionStorage.setItem(STORAGE_KEYS.userInfo, JSON.stringify(tokenData.user));

    return tokenData.user;
}

/**
 * Refresh the access token using the stored refresh token.
 * @returns true if refresh succeeded
 */
export async function refreshAccessToken(): Promise<boolean> {
    const refreshToken = sessionStorage.getItem(STORAGE_KEYS.refreshToken);
    if (!refreshToken) return false;

    try {
        const response = await fetch(`${KNOWAI_API_URL}/api/x/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: refreshToken }),
        });

        if (!response.ok) {
            // Refresh token expired or invalid → force logout
            clearAuth();
            return false;
        }

        const data: TokenResponse = await response.json();

        accessToken = data.access_token;
        tokenExpiresAt = Date.now() + data.expires_in * 1000;
        sessionStorage.setItem(STORAGE_KEYS.refreshToken, data.refresh_token);

        // Update user info if provided
        if (data.user) {
            sessionStorage.setItem(STORAGE_KEYS.userInfo, JSON.stringify(data.user));
        }

        return true;
    } catch {
        return false;
    }
}

/**
 * Fetch latest user info from KnowAI.
 * Attempts token refresh if access_token is expired.
 *
 * @returns AuthUser or null if not authenticated
 */
export async function fetchUserInfo(): Promise<AuthUser | null> {
    // Ensure we have a valid access token
    if (!accessToken || (tokenExpiresAt && Date.now() >= tokenExpiresAt)) {
        const refreshed = await refreshAccessToken();
        if (!refreshed) return null;
    }

    try {
        const response = await fetch(`${KNOWAI_API_URL}/api/x/me`, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (response.status === 401) {
            // Token invalid → try refresh once
            const refreshed = await refreshAccessToken();
            if (!refreshed) return null;

            // Retry with new token
            const retryResponse = await fetch(`${KNOWAI_API_URL}/api/x/me`, {
                headers: { Authorization: `Bearer ${accessToken}` },
            });

            if (!retryResponse.ok) return null;

            const retryData: MeResponse = await retryResponse.json();
            const user: AuthUser = {
                id: retryData.user_id,
                name: retryData.name,
                avatar: retryData.avatar,
                balance: retryData.balance,
            };
            sessionStorage.setItem(STORAGE_KEYS.userInfo, JSON.stringify(user));
            return user;
        }

        if (!response.ok) return null;

        const data: MeResponse = await response.json();
        const user: AuthUser = {
            id: data.user_id,
            name: data.name,
            avatar: data.avatar,
            balance: data.balance,
        };
        sessionStorage.setItem(STORAGE_KEYS.userInfo, JSON.stringify(user));
        return user;
    } catch {
        return null;
    }
}

/**
 * Get stored user info from sessionStorage (instant, no network).
 * Used for the "dual storage" strategy (§1.9).
 */
export function getStoredUser(): AuthUser | null {
    const stored = sessionStorage.getItem(STORAGE_KEYS.userInfo);
    if (!stored) return null;
    try {
        return JSON.parse(stored) as AuthUser;
    } catch {
        return null;
    }
}

/** Check if we have a refresh token (indicates past login) */
export function hasStoredSession(): boolean {
    return !!sessionStorage.getItem(STORAGE_KEYS.refreshToken);
}

/** Get the current access token (for API calls) */
export function getAccessToken(): string | null {
    return accessToken;
}

/** Clear all auth data */
export function clearAuth(): void {
    accessToken = null;
    tokenExpiresAt = null;
    sessionStorage.removeItem(STORAGE_KEYS.refreshToken);
    sessionStorage.removeItem(STORAGE_KEYS.userInfo);
    sessionStorage.removeItem(STORAGE_KEYS.codeVerifier);
    sessionStorage.removeItem(STORAGE_KEYS.oauthState);
}

/** Logout — clear tokens and optionally redirect */
export function logout(): void {
    clearAuth();
}

/** Get the callback path for routing */
export function getCallbackPath(): string {
    return CALLBACK_PATH;
}
