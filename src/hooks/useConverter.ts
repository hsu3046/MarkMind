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
    // 활성 job 의 id — listener 가 jobId 매칭으로 다른 윈도우/job 의 progress 분리.
    // null 이면 어떤 progress 도 수용 안 함.
    const currentJobIdRef = useRef<string | null>(null);

    // 진행 이벤트 전역 구독 (이 윈도우 안 모든 job 공통). jobId 로 필터.
    useEffect(() => {
        let mounted = true;
        (async () => {
            try {
                const unlisten = await tauriListen<ProgressStep>('converter-progress', (step) => {
                    if (!mounted) return;
                    if (!runningRef.current) return;
                    // 다른 윈도우의 동시 진행 job 또는 stale event 무시
                    if (!currentJobIdRef.current || step.jobId !== currentJobIdRef.current) return;
                    setJobState((prev) => {
                        // stepId 있고 이전에 같은 id row 가 있으면 in-place 갱신 (heartbeat)
                        if (step.stepId) {
                            const idx = prev.steps.findIndex((s) => s.stepId === step.stepId);
                            if (idx >= 0) {
                                const next = [...prev.steps];
                                next[idx] = step;
                                return { ...prev, steps: next };
                            }
                        }
                        return { ...prev, steps: [...prev.steps, step] };
                    });
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

    /** UUID 기반 jobId 생성. crypto.randomUUID 가 없으면 폴백. */
    const newJobId = (): string => {
        const uuid =
            typeof crypto !== 'undefined' && 'randomUUID' in crypto
                ? crypto.randomUUID().replace(/-/g, '')
                : Math.random().toString(36).slice(2) + Date.now().toString(36);
        return `job-${uuid}`;
    };

    const resetJob = useCallback(() => {
        setJobState({ phase: 'idle', steps: [] });
    }, []);

    const wrap = useCallback(
        async <T>(fn: (jobId: string) => Promise<T>): Promise<T | null> => {
            if (runningRef.current) {
                console.warn('[useConverter] 이미 다른 작업 진행 중 — 거부');
                return null;
            }
            const jobId = newJobId();
            runningRef.current = true;
            currentJobIdRef.current = jobId;
            setJobState({ phase: 'running', steps: [] });
            try {
                const result = await fn(jobId);
                setJobState((prev) => ({ ...prev, phase: 'done' }));
                return result;
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                setJobState((prev) => ({ ...prev, phase: 'error', error: message }));
                console.error('[useConverter] 작업 실패:', err);
                return null;
            } finally {
                runningRef.current = false;
                currentJobIdRef.current = null;
            }
        },
        [],
    );

    const runAudio = useCallback(
        (options: AudioJobOptions): Promise<AudioJobResult | null> =>
            wrap((jobId) => tauriInvoke<AudioJobResult>('run_audio_job', { options, jobId })),
        [wrap],
    );

    const runOcr = useCallback(
        (options: OcrJobOptions): Promise<OcrJobResult | null> =>
            wrap((jobId) => tauriInvoke<OcrJobResult>('run_ocr_job', { options, jobId })),
        [wrap],
    );

    const runNotes = useCallback(
        (options: NotesJobOptions): Promise<NotesJobResult | null> =>
            wrap((jobId) => tauriInvoke<NotesJobResult>('run_notes_job', { options, jobId })),
        [wrap],
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
        listTemplates,
        openEditorWindow,
        readFileText,
    };
}
