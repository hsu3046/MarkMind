import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { AIMode, AIResponse, TranslateLanguage, AITurn } from '../types/ai';
import { callAI, hasApiKey, isTextAIUsable, getApiKey, setApiKey, removeApiKey, applyDiff, isAuthError } from '../services/aiService';
import { getAIModelSelection } from '../services/aiModelConfig';
import { setValidationStatus } from '../services/apiValidation';
import type { NotesJobResult } from '../types/converter';

export function useAI() {
    const [mode, setMode] = useState<AIMode>('grammar');
    const [language, setLanguage] = useState<TranslateLanguage>('en');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [response, setResponse] = useState<AIResponse | null>(null);
    const [streamingText, setStreamingText] = useState<string>('');
    const abortRef = useRef<AbortController | null>(null);
    // 멀티턴(improve): 대화 히스토리 — LLM fold-in + 타임라인 표시 공용.
    const [conversationHistory, setConversationHistory] = useState<AITurn[]>([]);
    // 현재 턴의 지시(prompt) — 적용 확정(commitTurn) 시 히스토리에 push.
    const lastInstructionRef = useRef<string>('');
    const [apiKeySet, setApiKeySet] = useState(hasApiKey());
    const [panelVisible, setPanelVisible] = useState(false);
    // 회의록 작성 (mode === 'meeting-notes') 전용 옵션/결과
    const [notesTemplate, setNotesTemplate] = useState<string>('general');
    const [notesResult, setNotesResult] = useState<NotesJobResult | null>(null);

    // 패널 열림/모드 변경 시 현재 기본 AI 선택의 가용성(API 키 OR 구독)을 재확인 →
    // keyGate 정확화. (hasApiKey 초기값은 현재 회사 키 동기 판정, 구독은 여기서 보강.)
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const usable = await isTextAIUsable();
            if (!cancelled) setApiKeySet(usable);
        })();
        return () => {
            cancelled = true;
        };
    }, [panelVisible, mode]);

    // Toggle AI panel
    const togglePanel = useCallback(() => {
        setPanelVisible(v => !v);
    }, []);

    // API Key management — Tauri Keychain (async) or localStorage fallback
    const saveApiKey = useCallback(async (key: string) => {
        await setApiKey(key);
        setApiKeySet(true);
    }, []);

    const clearApiKey = useCallback(async () => {
        await removeApiKey();
        setApiKeySet(false);
    }, []);

    const currentApiKey = useCallback(() => {
        return getApiKey() || '';
    }, []);

    // Run AI — 항상 quality (improve mode 도 quality 모델 사용)
    const runAI = useCallback(async (
        content: string,
        prompt?: string,
        modeOverride?: AIMode,
    ) => {
        const activeMode = modeOverride ?? mode;
        // improve 멀티턴: 이번 지시를 기억(적용 시 commitTurn 으로 히스토리에 push).
        if (activeMode === 'improve') lastInstructionRef.current = prompt ?? '';
        const controller = new AbortController();
        abortRef.current = controller;
        setIsLoading(true);
        setError(null);
        setResponse(null);
        setStreamingText('');

        try {
            const result = await callAI(
                {
                    mode: activeMode,
                    content,
                    prompt,
                    language: activeMode === 'translate' ? language : undefined,
                    improveQuality: activeMode === 'improve' ? 'quality' : undefined,
                    // improve 면 직전 히스토리 동봉 → callAI 가 <conversation_history> 로 fold-in.
                    conversationHistory: activeMode === 'improve' ? conversationHistory : undefined,
                },
                (text) => setStreamingText(text),
                controller.signal,
            );
            setResponse(result);
            return result;
        } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') return null; // 중지 — 조용히
            // 실제 사용 중 인증 실패(키 무효)면 설정 검증 상태를 invalid 로 갱신(정상→확인 필요).
            // API 키 인증일 때만 — 구독 인증은 별개(설정의 "연결됨" 표시로 관리).
            const sel = getAIModelSelection();
            if (sel.auth === 'api_key' && isAuthError(err)) {
                setValidationStatus(sel.company, 'invalid');
            }
            // Tauri invoke 실패는 string 으로 reject(Err(String)) — Error 가 아니라
            // 그대로 두면 fallback 으로 뭉개진다. string 이면 그 원문(HTTP status 등)을 표면화.
            const message =
                err instanceof Error
                    ? err.message
                    : typeof err === 'string'
                        ? err
                        : 'AI 요청 중 오류가 발생했습니다.';
            setError(message);
            return null;
        } finally {
            setIsLoading(false);
        }
    }, [mode, language, conversationHistory]);

    /** 진행 중 AI 호출 중지(JS-only) — invoke 경로는 백그라운드 계속(별도 이슈). */
    const stopAI = useCallback(() => abortRef.current?.abort(), []);

    // Accept/Reject individual chunk
    const acceptChunk = useCallback((chunkId: number) => {
        setResponse(prev => {
            if (!prev) return prev;
            const chunks = prev.chunks.map(c =>
                c.id === chunkId ? { ...c, accepted: true } : c
            );
            return { ...prev, chunks };
        });
    }, []);

    const rejectChunk = useCallback((chunkId: number) => {
        setResponse(prev => {
            if (!prev) return prev;
            const chunks = prev.chunks.map(c =>
                c.id === chunkId ? { ...c, accepted: false } : c
            );
            return { ...prev, chunks };
        });
    }, []);

    // Accept all / Reject all
    const acceptAll = useCallback(() => {
        setResponse(prev => {
            if (!prev) return prev;
            const chunks = prev.chunks.map(c =>
                c.type === 'unchanged' ? c : { ...c, accepted: true }
            );
            return { ...prev, chunks };
        });
    }, []);

    const rejectAll = useCallback(() => {
        setResponse(null);
        setStreamingText('');
    }, []);

    // 적용 확정 시 현재 턴(지시 + 적용요약)을 히스토리에 push — improve 멀티턴.
    const commitTurn = useCallback((assistantSummary: string) => {
        const instr = lastInstructionRef.current;
        if (!instr) return;
        setConversationHistory(prev =>
            [
                ...prev,
                { role: 'user' as const, content: instr },
                { role: 'assistant' as const, content: assistantSummary },
            ].slice(-12), // 최근 6턴(12 메시지) 상한 — 토큰 누적 가드
        );
        lastInstructionRef.current = '';
    }, []);

    // 대화 스레드 초기화 (새 문서 / [새 대화]).
    const resetThread = useCallback(() => {
        setConversationHistory([]);
        lastInstructionRef.current = '';
    }, []);

    // Build final text from accepted/rejected chunks
    const getFinalText = useCallback((): string | null => {
        if (!response) return null;
        return applyDiff(response.chunks);
    }, [response]);

    // Check if all chunks have been decided
    const allDecided = useMemo(() => {
        if (!response) return false;
        return response.chunks
            .filter(c => c.type !== 'unchanged')
            .every(c => c.accepted !== undefined);
    }, [response]);

    // Count remaining undecided
    const undecidedCount = useMemo(() => {
        if (!response) return 0;
        return response.chunks
            .filter(c => c.type !== 'unchanged' && c.accepted === undefined)
            .length;
    }, [response]);

    return {
        // State
        mode,
        language,
        isLoading,
        error,
        response,
        streamingText,
        apiKeySet,
        panelVisible,
        allDecided,
        undecidedCount,
        conversationHistory,
        notesTemplate,
        notesResult,

        // Actions
        setMode,
        setLanguage,
        togglePanel,
        setPanelVisible,
        saveApiKey,
        clearApiKey,
        currentApiKey,
        runAI,
        stopAI,
        acceptChunk,
        rejectChunk,
        acceptAll,
        rejectAll,
        commitTurn,
        resetThread,
        getFinalText,
        setResponse,
        setError,
        setNotesTemplate,
        setNotesResult,
        setIsLoading,
    };
}
