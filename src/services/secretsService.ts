/**
 * 통합 secret batch 저장 — UI 가 한 번에 수정하는 필드들을 1회 Keychain write 로.
 * Keychain 다이얼로그 빈도 최소화 (ad-hoc 서명 빌드 환경).
 *
 * 시멘틱:
 *   - undefined → 변경 없음 (기존 값 보존)
 *   - ""        → 삭제
 *   - string    → 설정
 *
 * refresh_token / user_email 은 OAuth flow 전용 — 이 batch 에 포함 안 됨.
 */

import { isTauri } from './platform';

export interface SecretsUserInputs {
    gemini?: string;
    claude?: string;
    openai?: string;
    grok?: string;
    pyannoteai?: string;
    /** 로컬 화자분리용 Python 경로 (pyannote.audio 설치). */
    diarPython?: string;
    gdriveClientId?: string;
    gdriveClientSecret?: string;
}

/** undefined 필드는 JSON 에서 제외 — Rust 에서 "변경 없음" 으로 해석 */
function buildPayload(updates: SecretsUserInputs): Record<string, string> {
    const out: Record<string, string> = {};
    if (updates.gemini !== undefined) out.gemini = updates.gemini;
    if (updates.claude !== undefined) out.claude = updates.claude;
    if (updates.openai !== undefined) out.openai = updates.openai;
    if (updates.grok !== undefined) out.grok = updates.grok;
    if (updates.pyannoteai !== undefined) out.pyannoteai = updates.pyannoteai;
    if (updates.diarPython !== undefined) out.diar_python = updates.diarPython;
    if (updates.gdriveClientId !== undefined) out.gdrive_client_id = updates.gdriveClientId;
    if (updates.gdriveClientSecret !== undefined) out.gdrive_client_secret = updates.gdriveClientSecret;
    return out;
}

export async function setUserInputs(updates: SecretsUserInputs): Promise<void> {
    if (!isTauri()) {
        throw new Error('Tauri 환경에서만 동작합니다.');
    }
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke<void>('secrets_set_user_inputs', { updates: buildPayload(updates) });
}

/** 로컬 화자분리용 Python 경로 조회 (Settings 프리필). */
export async function getDiarPython(): Promise<string | null> {
    if (!isTauri()) return null;
    const { invoke } = await import('@tauri-apps/api/core');
    return (await invoke<string | null>('get_diar_python')) ?? null;
}
