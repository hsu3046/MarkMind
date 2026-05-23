/**
 * doc-converter 통합 훅 — Tauri command 호출 + 진행상황 event 구독.
 *
 * 사용:
 *   const { jobState, runAudio, runOcr, runNotes, listTemplates } = useConverter();
 *   await runAudio({ file_path: '/Users/.../meeting.m4a' });
 *   // jobState.steps 가 실시간 업데이트됨 (Tauri "converter-progress" event)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { isTauri } from '../services/platform';
import {
    AudioJobOptions,
    AudioJobResult,
    JobState,
    NotesJobOptions,
    NotesJobResult,
    OcrJobOptions,
    OcrJobResult,
    ProgressStep,
    TemplateInfo,
} from '../types/converter';

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    if (!isTauri()) {
        throw new Error('Convert 기능은 데스크탑 앱에서만 사용 가능합니다.');
    }
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<T>(cmd, args);
}

async function tauriListen<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
    if (!isTauri()) return () => {};
    const { listen } = await import('@tauri-apps/api/event');
    const unlisten = await listen<T>(event, (e) => handler(e.payload));
    return unlisten;
}

export function useConverter() {
    const [jobState, setJobState] = useState<JobState>({ phase: 'idle', steps: [] });
    const unlistenRef = useRef<(() => void) | null>(null);
    // 한 번에 1개 작업만 추적. 이미 running 인데 새 wrap() 호출 시 거부.
    // (Toolbar mutex 로 4-panel 동시 활성 X 이지만, 코드 차원에서도 보장)
    const runningRef = useRef(false);

    // 진행 이벤트 전역 구독 (이 윈도우 안 모든 job 공통)
    useEffect(() => {
        let mounted = true;
        (async () => {
            try {
                const unlisten = await tauriListen<ProgressStep>('converter-progress', (step) => {
                    if (!mounted) return;
                    // 활성 job 이 없으면 무시 (이전 작업 끝났는데 늦게 도착한 event)
                    if (!runningRef.current) return;
                    setJobState((prev) => ({
                        ...prev,
                        steps: [...prev.steps, step],
                    }));
                });
                unlistenRef.current = unlisten;
            } catch (err) {
                console.warn('[useConverter] event listener 실패:', err);
            }
        })();
        return () => {
            mounted = false;
            if (unlistenRef.current) unlistenRef.current();
        };
    }, []);

    const resetJob = useCallback(() => {
        setJobState({ phase: 'idle', steps: [] });
    }, []);

    const wrap = useCallback(
        async <T>(fn: () => Promise<T>): Promise<T | null> => {
            if (runningRef.current) {
                console.warn('[useConverter] 이미 다른 작업 진행 중 — 거부');
                return null;
            }
            runningRef.current = true;
            setJobState({ phase: 'running', steps: [] });
            try {
                const result = await fn();
                setJobState((prev) => ({ ...prev, phase: 'done' }));
                return result;
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                setJobState((prev) => ({ ...prev, phase: 'error', error: message }));
                console.error('[useConverter] 작업 실패:', err);
                return null;
            } finally {
                runningRef.current = false;
            }
        },
        [],
    );

    const runAudio = useCallback(
        (options: AudioJobOptions): Promise<AudioJobResult | null> =>
            wrap(() => tauriInvoke<AudioJobResult>('run_audio_job', { options })),
        [wrap],
    );

    const runOcr = useCallback(
        (options: OcrJobOptions): Promise<OcrJobResult | null> =>
            wrap(() => tauriInvoke<OcrJobResult>('run_ocr_job', { options })),
        [wrap],
    );

    const runNotes = useCallback(
        (options: NotesJobOptions): Promise<NotesJobResult | null> =>
            wrap(() => tauriInvoke<NotesJobResult>('run_notes_job', { options })),
        [wrap],
    );

    const runOcrInline = useCallback(
        async (imagePath: string): Promise<string | null> => {
            try {
                return await tauriInvoke<string>('run_ocr_inline', { imagePath });
            } catch (err) {
                console.error('[useConverter] 인라인 OCR 실패:', err);
                return null;
            }
        },
        [],
    );

    const listTemplates = useCallback(
        (): Promise<TemplateInfo[]> => tauriInvoke<TemplateInfo[]>('list_meeting_templates'),
        [],
    );

    const openEditorWindow = useCallback(
        (filePath: string): Promise<void> =>
            tauriInvoke<void>('open_new_window', { filePath }),
        [],
    );

    /** Tauri 환경에서 파일 텍스트 읽기 (frontend 전용 헬퍼) */
    const readFileText = useCallback(async (path: string): Promise<string> => {
        if (!isTauri()) throw new Error('Tauri 전용');
        const { readTextFile } = await import('@tauri-apps/plugin-fs');
        return readTextFile(path);
    }, []);

    return {
        jobState,
        resetJob,
        runAudio,
        runOcr,
        runNotes,
        runOcrInline,
        listTemplates,
        openEditorWindow,
        readFileText,
    };
}
