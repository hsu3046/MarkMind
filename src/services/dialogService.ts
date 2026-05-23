/**
 * 통합 confirm 다이얼로그 — Tauri 환경에서는 native ask(), 웹에서는 browser confirm().
 *
 * 사용:
 *   const ok = await confirmAction('이 작업을 진행하시겠습니까?');
 *   if (!ok) return;
 */

import { isTauri } from './platform';

export interface ConfirmOptions {
    title?: string;
    kind?: 'info' | 'warning' | 'error';
}

export async function confirmAction(
    message: string,
    options: ConfirmOptions = {},
): Promise<boolean> {
    const { title = 'MarkMind', kind = 'warning' } = options;
    if (isTauri()) {
        try {
            const { ask } = await import('@tauri-apps/plugin-dialog');
            return await ask(message, { title, kind });
        } catch (err) {
            console.warn('[dialogService] Tauri ask 실패, browser confirm fallback:', err);
        }
    }
    return confirm(message);
}
