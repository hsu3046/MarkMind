/**
 * 사용자 메모리(#15) — "내 정보" 를 appDataDir/memory.md 에 보관(Rust command 경유).
 *
 * AI 호출 시 getSystemPrompt 가 캐시된 값을 system prompt 에 주입한다. getSystemPrompt 는
 * 동기 함수라 매번 파일을 읽을 수 없으므로 모듈 캐시를 두고, 앱 시작 시 loadUserMemory()
 * 로 채운다. Settings 저장 시 캐시도 즉시 갱신해 다음 호출에 바로 반영된다.
 */
import { invoke } from '@tauri-apps/api/core';

const isTauri =
    typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** system prompt 주입 + UI 입력 폭주를 막는 상한(토큰 비용 보호). */
export const USER_MEMORY_MAX_CHARS = 4000;

let cached = '';

/** getSystemPrompt 등 동기 경로에서 쓰는 캐시 접근자. */
export function getCachedUserMemory(): string {
    return cached;
}

/** 앱 시작 시(또는 Settings 진입 시) memory.md 를 읽어 캐시를 채운다. 실패해도 빈 값. */
export async function loadUserMemory(): Promise<string> {
    if (!isTauri) return cached; // web 빌드: 기능 비활성(빈 메모리)
    try {
        cached = (await invoke<string>('read_user_memory')) ?? '';
    } catch {
        cached = '';
    }
    return cached;
}

/** Settings 에서 저장. 상한으로 자른 뒤 디스크에 쓰고 캐시도 즉시 갱신. */
export async function saveUserMemory(content: string): Promise<void> {
    const trimmed = content.slice(0, USER_MEMORY_MAX_CHARS);
    if (isTauri) {
        await invoke('write_user_memory', { content: trimmed });
    }
    cached = trimmed;
}
