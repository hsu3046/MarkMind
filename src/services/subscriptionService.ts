/**
 * 구독 OAuth 연동 — 로컬에 로그인해 둔 Claude Code / Codex CLI 토큰을 본인 구독으로
 * 재사용하기 위한 프론트 헬퍼.
 *
 * - 로그인 감지(`detectSubscriptionLogins`)는 토큰 값을 받지 않고 bool 만 받는다(Rust 보장).
 * - Claude 인증 소스(API 키 ↔ 구독)는 localStorage 에 저장 — 설정/회의록 탭이 공유.
 */

import { isTauri } from './platform';
import type { ClaudeAuthMode } from '../types/converter';

export interface SubscriptionStatus {
    /** Claude Code(keychain) 로그인 감지 여부. */
    claude: boolean;
    /** Codex(~/.codex/auth.json) 로그인 감지 여부. */
    codex: boolean;
    /** Claude 플랜명 ("Max" 등). 토큰에서 추출, 없으면 null. */
    claudePlan?: string | null;
    /** ChatGPT 플랜명 ("Plus" 등). id_token 에서 추출, 없으면 null. */
    codexPlan?: string | null;
}

/** 로컬 CLI 로그인 감지. 비-Tauri / 실패 시 모두 false. */
export async function detectSubscriptionLogins(): Promise<SubscriptionStatus> {
    if (!isTauri()) return { claude: false, codex: false };
    try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke<SubscriptionStatus>('detect_subscription_logins');
    } catch (err) {
        console.warn('[subscription] 로그인 감지 실패:', err);
        return { claude: false, codex: false };
    }
}

const CLAUDE_AUTH_KEY = 'markmind-claude-auth-mode';

/** 저장된 Claude 인증 소스 (기본 api_key). */
export function getClaudeAuthMode(): ClaudeAuthMode {
    return localStorage.getItem(CLAUDE_AUTH_KEY) === 'subscription' ? 'subscription' : 'api_key';
}

export function setClaudeAuthMode(mode: ClaudeAuthMode): void {
    localStorage.setItem(CLAUDE_AUTH_KEY, mode);
}
