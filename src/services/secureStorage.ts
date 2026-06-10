/**
 * 보안 키 저장소 — Tauri 환경에서는 macOS Keychain (Rust keyring 크레이트),
 * 웹 환경에서는 localStorage fallback.
 *
 * 사용 패턴: 앱 시작 시 `initSecureStorage()` 호출 → 이후 sync getKey/hasKey 사용.
 * setKey/removeKey 는 async (Tauri invoke 필요).
 *
 * 첫 실행 시 legacy localStorage 키 (`markmind-gemini-api-key`) 가 있으면
 * Keychain 으로 자동 마이그레이션 후 localStorage 삭제.
 */

import { isTauri } from './platform';

export type Provider = 'gemini' | 'claude' | 'openai' | 'pyannoteai';

const LEGACY_LOCALSTORAGE_KEYS: Record<Provider, string> = {
    gemini: 'markmind-gemini-api-key',
    claude: 'markmind-claude-api-key',
    openai: 'markmind-openai-api-key',
    pyannoteai: 'markmind-pyannoteai-api-key',
};

const cache: Record<Provider, string | null> = {
    gemini: null,
    claude: null,
    openai: null,
    pyannoteai: null,
};

let initialized = false;
let initPromise: Promise<void> | null = null;

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<T>(cmd, args);
}

async function loadFromTauri(provider: Provider): Promise<string | null> {
    try {
        return await tauriInvoke<string | null>('get_api_key', { provider });
    } catch (err) {
        console.warn(`[secureStorage] Keychain ${provider} 읽기 실패:`, err);
        return null;
    }
}

async function migrateLegacy(provider: Provider): Promise<void> {
    if (!isTauri()) return;
    const legacyKey = LEGACY_LOCALSTORAGE_KEYS[provider];
    const legacyValue = localStorage.getItem(legacyKey);
    if (!legacyValue || !legacyValue.trim()) return;

    // Keychain 에 이미 있으면 마이그레이션 skip — 사용자가 직접 입력한 게 우선
    if (cache[provider]) {
        localStorage.removeItem(legacyKey);
        return;
    }
    try {
        await tauriInvoke<void>('set_api_key', { provider, key: legacyValue.trim() });
        cache[provider] = legacyValue.trim();
        localStorage.removeItem(legacyKey);
        console.info(`[secureStorage] legacy ${provider} 키 → Keychain 마이그레이션 완료`);
    } catch (err) {
        console.error(`[secureStorage] ${provider} 마이그레이션 실패:`, err);
    }
}

export async function initSecureStorage(): Promise<void> {
    if (initialized) return;
    if (initPromise) return initPromise;

    initPromise = (async () => {
        if (isTauri()) {
            // Tauri keychain 우선 로드
            const [gemini, claude, openai, pyannoteai] = await Promise.all([
                loadFromTauri('gemini'),
                loadFromTauri('claude'),
                loadFromTauri('openai'),
                loadFromTauri('pyannoteai'),
            ]);
            cache.gemini = gemini;
            cache.claude = claude;
            cache.openai = openai;
            cache.pyannoteai = pyannoteai;
            // legacy localStorage 마이그레이션
            await Promise.all([
                migrateLegacy('gemini'),
                migrateLegacy('claude'),
                migrateLegacy('openai'),
            ]);
        } else {
            // ⚠️ 웹 빌드: API 키가 평문으로 localStorage 에 저장됨.
            // 프로덕션 웹 배포 전에 서버 경유 프록시 또는 OAuth 인증으로 전환 필수.
            console.warn(
                '[secureStorage] 웹 환경에서 API 키는 localStorage 에 평문 저장됩니다. ' +
                '프로덕션 배포 시 보안 강화 필요.'
            );
            cache.gemini = localStorage.getItem(LEGACY_LOCALSTORAGE_KEYS.gemini);
            cache.claude = localStorage.getItem(LEGACY_LOCALSTORAGE_KEYS.claude);
            cache.openai = localStorage.getItem(LEGACY_LOCALSTORAGE_KEYS.openai);
            cache.pyannoteai = localStorage.getItem(LEGACY_LOCALSTORAGE_KEYS.pyannoteai);
        }
        initialized = true;
    })();

    return initPromise;
}

export function isInitialized(): boolean {
    return initialized;
}

export function getKey(provider: Provider): string | null {
    return cache[provider];
}

export function hasKey(provider: Provider): boolean {
    const v = cache[provider];
    return !!v && v.trim().length > 0;
}

export async function setKey(provider: Provider, key: string): Promise<void> {
    const trimmed = key.trim();
    if (!trimmed) {
        throw new Error('API 키가 비어있습니다.');
    }
    if (isTauri()) {
        await tauriInvoke<void>('set_api_key', { provider, key: trimmed });
    } else {
        localStorage.setItem(LEGACY_LOCALSTORAGE_KEYS[provider], trimmed);
    }
    cache[provider] = trimmed;
}

export async function removeKey(provider: Provider): Promise<void> {
    if (isTauri()) {
        await tauriInvoke<void>('delete_api_key', { provider });
    } else {
        localStorage.removeItem(LEGACY_LOCALSTORAGE_KEYS[provider]);
    }
    cache[provider] = null;
}

/**
 * batch 저장 후 메모리 캐시도 한 번에 갱신.
 * - undefined → 변경 없음
 * - null / 빈 문자열 → 캐시 비우기
 * - 값 → 캐시 저장
 */
export function updateCacheAfterBatch(updates: Partial<Record<Provider, string | null | undefined>>): void {
    for (const provider of ['gemini', 'claude', 'openai', 'pyannoteai'] as Provider[]) {
        if (provider in updates) {
            const val = updates[provider];
            cache[provider] = val && val.trim() ? val.trim() : null;
        }
    }
}
