/**
 * AI 에이전트 사이드 패널 — 4 모드 (문법 교정 / 번역 / 문서 개선 / 회의록 작성).
 * 모드별 옵션 UI 는 sub-component 로 분리 (ModeSelector, LlmSelector, NotesOptions, NotesResultCard).
 */

import { useState, useRef, useEffect } from 'react';
import { AIMode, TranslateLanguage } from '../types/ai';
import { Sparkles, Send, Loader2, AlertCircle } from 'lucide-react';
import type { ClaudeAuthMode, NotesJobResult, TemplateInfo } from '../types/converter';
import { hasKey, type Provider } from '../services/secureStorage';
import { detectSubscriptionLogins } from '../services/subscriptionService';
import { ModeSelector } from './ai/ModeSelector';
import { LlmSelector } from './ai/LlmSelector';
import { NotesOptions } from './ai/NotesOptions';
import { NotesResultCard } from './ai/NotesResultCard';
import './AIPanel.css';

interface AIPanelProps {
    visible: boolean;
    mode: AIMode;
    language: TranslateLanguage;
    isLoading: boolean;
    error: string | null;
    streamingText: string;
    apiKeySet: boolean;
    content: string;
    selectedModel: Provider;
    onSelectedModelChange: (p: Provider) => void;
    claudeAuthMode: ClaudeAuthMode;
    onClaudeAuthChange: (m: ClaudeAuthMode) => void;
    notesTemplate: string;
    notesResult: NotesJobResult | null;
    loadTemplates: () => Promise<TemplateInfo[]>;
    openEditorWindow: (path: string) => Promise<void> | void;
    onModeChange: (mode: AIMode) => void;
    onLanguageChange: (lang: TranslateLanguage) => void;
    onNotesTemplateChange: (t: string) => void;
    onRun: (content: string, prompt?: string) => void;
    onShowSettings: () => void;
}

export function AIPanel({
    visible,
    mode,
    language,
    isLoading,
    error,
    streamingText,
    apiKeySet,
    content,
    selectedModel,
    onSelectedModelChange,
    claudeAuthMode,
    onClaudeAuthChange,
    notesTemplate,
    notesResult,
    loadTemplates,
    openEditorWindow,
    onModeChange,
    onLanguageChange,
    onNotesTemplateChange,
    onRun,
    onShowSettings,
}: AIPanelProps) {
    const [prompt, setPrompt] = useState('');
    const promptRef = useRef<HTMLTextAreaElement>(null);

    // 구독(Claude Code / Codex) 로그인 감지 — mount 1회.
    const [subClaude, setSubClaude] = useState(false);
    const [subCodex, setSubCodex] = useState(false);
    useEffect(() => {
        let cancelled = false;
        detectSubscriptionLogins().then((s) => {
            if (cancelled) return;
            setSubClaude(s.claude);
            setSubCodex(s.codex);
            // Claude API 키가 없고 구독만 있으면 인증 소스를 구독으로 자동 설정.
            if (s.claude && !hasKey('claude') && claudeAuthMode !== 'subscription') {
                onClaudeAuthChange('subscription');
            }
        });
        return () => {
            cancelled = true;
        };
        // mount 1회만 — 콜백/상태 변화로 재실행하지 않음.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (mode === 'improve' && promptRef.current) {
            promptRef.current.focus();
        }
    }, [mode]);

    if (!visible) return null;

    const handleRun = () => {
        if (!apiKeySet) {
            onShowSettings();
            return;
        }
        if (mode === 'improve' && !prompt.trim()) return;
        onRun(content, prompt || undefined);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleRun();
        }
    };

    const runDisabled =
        isLoading ||
        (mode === 'improve' && !prompt.trim()) ||
        (mode === 'meeting-notes' && content.trim().length < 100);

    return (
        <div className="ai-panel">
            <div className="ai-panel-header">
                <span className="ai-panel-title">
                    <Sparkles size={14} /> AI 에이전트
                </span>
            </div>

            {!apiKeySet ? (
                <div className="ai-no-key">
                    <AlertCircle size={20} />
                    <p>API 키를 설정해주세요</p>
                    <button className="ai-btn primary" onClick={onShowSettings}>
                        설정하기
                    </button>
                </div>
            ) : (
                <>
                    <LlmSelector
                        selected={selectedModel}
                        onChange={onSelectedModelChange}
                        claudeSubscription={subClaude}
                        codexSubscription={subCodex}
                    />

                    {selectedModel === 'claude' && (
                        <div className="ai-llm-select" title="Claude 호출 인증 소스">
                            <label>Claude 인증</label>
                            <select
                                value={claudeAuthMode}
                                onChange={(e) => onClaudeAuthChange(e.target.value as ClaudeAuthMode)}
                            >
                                <option value="api_key" disabled={!hasKey('claude')}>
                                    API 키{!hasKey('claude') ? ' (없음)' : ''}
                                </option>
                                <option value="subscription" disabled={!subClaude}>
                                    구독 로그인{!subClaude ? ' (미감지)' : ''}
                                </option>
                            </select>
                        </div>
                    )}

                    <ModeSelector mode={mode} onChange={onModeChange} />

                    {mode === 'translate' && (
                        <div className="ai-language-select">
                            <span>번역 언어:</span>
                            <select
                                value={language}
                                onChange={(e) => onLanguageChange(e.target.value as TranslateLanguage)}
                            >
                                <option value="ko">한국어</option>
                                <option value="en">English</option>
                                <option value="ja">日本語</option>
                            </select>
                        </div>
                    )}

                    {mode === 'meeting-notes' && (
                        <NotesOptions
                            selectedTemplate={notesTemplate}
                            onChange={onNotesTemplateChange}
                            loadTemplates={loadTemplates}
                        />
                    )}

                    {mode !== 'meeting-notes' && (
                        <div className="ai-prompt-area">
                            <textarea
                                ref={promptRef}
                                className="ai-prompt-input"
                                placeholder={
                                    mode === 'improve'
                                        ? '문서 개선 지시사항을 입력하세요... (필수)'
                                        : '상세 지시사항 (선택)'
                                }
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                onKeyDown={handleKeyDown}
                                rows={6}
                            />
                        </div>
                    )}

                    <div className="ai-prompt-actions">
                        <button
                            className="ai-btn primary"
                            onClick={handleRun}
                            disabled={runDisabled}
                            title="실행"
                        >
                            {isLoading ? <Loader2 size={14} className="spinning" /> : <Send size={14} />}
                            {isLoading
                                ? '처리 중...'
                                : mode === 'meeting-notes'
                                    ? '회의록 생성'
                                    : '실행'}
                        </button>
                    </div>

                    {error && (
                        <div className="ai-error">
                            <AlertCircle size={14} />
                            {error}
                        </div>
                    )}

                    {isLoading && streamingText && mode !== 'meeting-notes' && (
                        <div className="ai-streaming">
                            <div className="ai-streaming-label">
                                <Loader2 size={12} className="spinning" /> 생성 중...
                            </div>
                            <pre className="ai-streaming-text">{streamingText.slice(-500)}</pre>
                        </div>
                    )}

                    {mode === 'meeting-notes' && notesResult && (
                        <NotesResultCard result={notesResult} onOpen={openEditorWindow} />
                    )}
                </>
            )}
        </div>
    );
}
