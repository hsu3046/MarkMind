import { useState, useRef, useEffect } from 'react';
import { AIMode, TranslateLanguage, ImproveQuality } from '../types/ai';
import {
    Sparkles, Languages, SpellCheck, Settings,
    Send, Loader2, AlertCircle, Eye, EyeOff, Trash2, Wand2, Zap, Target
} from 'lucide-react';
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
    improveQuality: ImproveQuality;

    onModeChange: (mode: AIMode) => void;
    onLanguageChange: (lang: TranslateLanguage) => void;
    onImproveQualityChange: (q: ImproveQuality) => void;
    onRun: (content: string, prompt?: string) => void;
    onSaveApiKey: (key: string) => void;
    onClearApiKey: () => void;
    currentApiKey: () => string;
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
    improveQuality,
    onModeChange,
    onLanguageChange,
    onImproveQualityChange,
    onRun,
    onSaveApiKey,
    onClearApiKey,
    currentApiKey,
}: AIPanelProps) {
    const [prompt, setPrompt] = useState('');
    const [showSettings, setShowSettings] = useState(false);
    const [apiKeyInput, setApiKeyInput] = useState('');
    const [showKey, setShowKey] = useState(false);
    const promptRef = useRef<HTMLTextAreaElement>(null);

    // Auto-focus prompt when improve mode selected
    useEffect(() => {
        if (mode === 'improve' && promptRef.current) {
            promptRef.current.focus();
        }
    }, [mode]);

    if (!visible) return null;

    const handleRun = () => {
        if (!apiKeySet) {
            setShowSettings(true);
            return;
        }
        // 문서 개선 모드에서는 프롬프트 필수
        if (mode === 'improve' && !prompt.trim()) return;
        onRun(content, prompt || undefined);
    };

    const handleSaveKey = () => {
        if (apiKeyInput.trim()) {
            onSaveApiKey(apiKeyInput.trim());
            setApiKeyInput('');
            setShowSettings(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleRun();
        }
    };

    // Settings view
    if (showSettings) {
        return (
            <div className="ai-panel">
                <div className="ai-panel-header">
                    <span className="ai-panel-title">
                        <Settings size={14} /> API 설정
                    </span>
                    <button className="ai-panel-close" onClick={() => setShowSettings(false)}>
                        ✕
                    </button>
                </div>
                <div className="ai-settings">
                    <p className="ai-settings-desc">
                        Google Gemini API 키를 입력하세요.
                        <br />
                        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">
                            API 키 발급 →
                        </a>
                    </p>
                    <div className="ai-key-input-group">
                        <input
                            type={showKey ? 'text' : 'password'}
                            className="ai-key-input"
                            placeholder="AIza..."
                            value={apiKeyInput || (apiKeySet ? currentApiKey() : '')}
                            onChange={(e) => setApiKeyInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveKey();
                            }}
                        />
                        <button className="ai-key-toggle" onClick={() => setShowKey(v => !v)}>
                            {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                    </div>
                    <div className="ai-settings-actions">
                        <button className="ai-btn primary" onClick={handleSaveKey}>
                            저장
                        </button>
                        {apiKeySet && (
                            <button className="ai-btn danger" onClick={onClearApiKey}>
                                <Trash2 size={13} /> 삭제
                            </button>
                        )}
                    </div>
                    <p className="ai-key-notice">
                        🔒 API 키는 이 기기의 브라우저에만 저장됩니다.
                        <br />서버로 전송되지 않습니다.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="ai-panel">
            {/* Header */}
            <div className="ai-panel-header">
                <span className="ai-panel-title">
                    <Sparkles size={14} /> AI 어시스턴트
                </span>
                <button
                    className="ai-settings-btn"
                    onClick={() => setShowSettings(true)}
                    title="API 설정"
                >
                    <Settings size={14} />
                </button>
            </div>

            {!apiKeySet ? (
                <div className="ai-no-key">
                    <AlertCircle size={20} />
                    <p>API 키를 설정해주세요</p>
                    <button className="ai-btn primary" onClick={() => setShowSettings(true)}>
                        설정하기
                    </button>
                </div>
            ) : (
                <>
                    {/* Mode Selection */}
                    <div className="ai-modes">
                        <label className={`ai-mode-radio${mode === 'grammar' ? ' active' : ''}`}>
                            <input
                                type="radio"
                                name="ai-mode"
                                checked={mode === 'grammar'}
                                onChange={() => onModeChange('grammar')}
                            />
                            <SpellCheck size={13} /> 문법 교정
                        </label>
                        <label className={`ai-mode-radio${mode === 'translate' ? ' active' : ''}`}>
                            <input
                                type="radio"
                                name="ai-mode"
                                checked={mode === 'translate'}
                                onChange={() => onModeChange('translate')}
                            />
                            <Languages size={13} /> 번역
                        </label>
                        <label className={`ai-mode-radio${mode === 'improve' ? ' active' : ''}`}>
                            <input
                                type="radio"
                                name="ai-mode"
                                checked={mode === 'improve'}
                                onChange={() => onModeChange('improve')}
                            />
                            <Wand2 size={13} /> 문서 개선
                        </label>
                    </div>

                    {/* Language selector for translate mode */}
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

                    {/* Quality toggle for improve mode */}
                    {mode === 'improve' && (
                        <div className="ai-quality-toggle">
                            <label className={`ai-quality-radio${improveQuality === 'speed' ? ' active' : ''}`}>
                                <input
                                    type="radio"
                                    name="ai-quality"
                                    checked={improveQuality === 'speed'}
                                    onChange={() => onImproveQualityChange('speed')}
                                />
                                <Zap size={13} /> 속도 우선
                            </label>
                            <label className={`ai-quality-radio${improveQuality === 'quality' ? ' active' : ''}`}>
                                <input
                                    type="radio"
                                    name="ai-quality"
                                    checked={improveQuality === 'quality'}
                                    onChange={() => onImproveQualityChange('quality')}
                                />
                                <Target size={13} /> 퀄리티 우선
                            </label>
                        </div>
                    )}

                    {/* Prompt input */}
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
                        <div className="ai-prompt-actions">
                            <button
                                className="ai-btn primary"
                                onClick={handleRun}
                                disabled={isLoading || (mode === 'improve' && !prompt.trim())}
                                title="실행"
                            >
                                {isLoading ? <Loader2 size={14} className="spinning" /> : <Send size={14} />}
                                {isLoading ? '처리 중...' : '실행'}
                            </button>
                        </div>
                    </div>

                    {/* Error */}
                    {error && (
                        <div className="ai-error">
                            <AlertCircle size={14} />
                            {error}
                        </div>
                    )}

                    {/* Streaming preview */}
                    {isLoading && streamingText && (
                        <div className="ai-streaming">
                            <div className="ai-streaming-label">
                                <Loader2 size={12} className="spinning" /> 생성 중...
                            </div>
                            <pre className="ai-streaming-text">{streamingText.slice(-500)}</pre>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
