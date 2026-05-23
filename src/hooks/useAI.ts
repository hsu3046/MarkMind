import { useState, useCallback, useMemo } from 'react';
import { AIMode, AIResponse, TranslateLanguage } from '../types/ai';
import { callAI, hasApiKey, getApiKey, setApiKey, removeApiKey, applyDiff } from '../services/aiService';
import type { NotesJobResult } from '../types/converter';
import type { Provider } from '../services/secureStorage';

export function useAI() {
    const [mode, setMode] = useState<AIMode>('grammar');
    const [language, setLanguage] = useState<TranslateLanguage>('en');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [response, setResponse] = useState<AIResponse | null>(null);
    const [streamingText, setStreamingText] = useState<string>('');
    const [apiKeySet, setApiKeySet] = useState(hasApiKey());
    const [panelVisible, setPanelVisible] = useState(false);
    // 공통 LLM 모델 선택 — 회의록 모드에서 실제 사용. 그 외 모드는 항상 Gemini.
    const [selectedModel, setSelectedModel] = useState<Provider>('gemini');
    // 회의록 작성 (mode === 'meeting-notes') 전용 옵션/결과
    const [notesTemplate, setNotesTemplate] = useState<string>('general');
    const [notesResult, setNotesResult] = useState<NotesJobResult | null>(null);

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
                },
                (text) => setStreamingText(text),
            );
            setResponse(result);
            return result;
        } catch (err) {
            const message = err instanceof Error ? err.message : 'AI 요청 중 오류가 발생했습니다.';
            setError(message);
            return null;
        } finally {
            setIsLoading(false);
        }
    }, [mode, language]);

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
        selectedModel,
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
        acceptChunk,
        rejectChunk,
        acceptAll,
        rejectAll,
        getFinalText,
        setResponse,
        setError,
        setSelectedModel,
        setNotesTemplate,
        setNotesResult,
        setIsLoading,
    };
}
