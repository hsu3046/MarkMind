/**
 * AI 에이전트 사이드 패널 — 단일 진입점(#60).
 * 8 모드: 음성 인식(stt) / 이미지 인식(ocr) / 회의록 작성 / 슬라이드 생성(pptx) /
 *         문서 개선 / 문법 교정 / 번역 / 마인드맵 정리(structurize).
 *  - stt/ocr: 기존 AudioTab/OcrTab 을 그대로 mount(변환 로직 재사용). converter 자체 키 사용.
 *  - pptx: 슬라이드 Markdown 초안 생성 + AI 기반 PPTX 생성.
 *  - 나머지: prompt → onRun → InlineDiff / ResultCard.
 * 모드별 옵션 UI 는 sub-component 로 분리 (ModeSelector, LlmSelector, NotesOptions, NotesResultCard).
 */

import { useState, useRef, useEffect, ReactNode } from 'react';
import { AIMode, TranslateLanguage, AITurn } from '../types/ai';
import { Sparkles, Send, Loader2, AlertCircle } from 'lucide-react';
import type { NotesJobResult, TemplateInfo } from '../types/converter';
import type { useConverter } from '../hooks/useConverter';
import type { DroppedFile } from './convert/types';
import { initSecureStorage } from '../services/secureStorage';
import {
    getAIModelSelection,
    getImageAIModelSelection,
    getSelectionDisplay,
    AI_CATALOG,
    IMAGE_AI_CATALOG,
} from '../services/aiModelConfig';
import { ModeSelector } from './ai/ModeSelector';
import { ConversationTimeline } from './ai/ConversationTimeline';
import { NotesOptions } from './ai/NotesOptions';
import { NotesResultCard } from './ai/NotesResultCard';
import { ImageGenPanel } from './ai/ImageGenPanel';
import { SlideExportPanel } from './ai/SlideExportPanel';
import { AudioTab } from './convert/AudioTab';
import { OcrTab } from './convert/OcrTab';
import type { SlideExportOptions, SlideTheme } from '../lib/slideTheme';
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
    notesTemplate: string;
    notesResult: NotesJobResult | null;
    loadTemplates: () => Promise<TemplateInfo[]>;
    openEditorWindow: (path: string) => Promise<void> | void;
    onModeChange: (mode: AIMode) => void;
    onLanguageChange: (lang: TranslateLanguage) => void;
    onNotesTemplateChange: (t: string) => void;
    onRun: (content: string, prompt?: string) => void;
    /** "인용" — App 이 선택을 프롬프트에 마커로 주입(key 변경 시 append). */
    injectedQuote?: { marker: string; key: number } | null;
    /** 프롬프트 변경 알림 — App 이 살아있는 인용 마커를 하이라이트로 동기화. */
    onPromptChange?: (prompt: string) => void;
    /** 진행 중 AI 호출 중지(JS-only). */
    onStop: () => void;
    onShowSettings: () => void;
    // ── 입력 변환(stt/ocr) ──
    converter: ReturnType<typeof useConverter>;
    audioDropped: DroppedFile[] | null;
    ocrDropped: DroppedFile | null;
    onConsumeAudioDropped: () => void;
    onConsumeOcrDropped: () => void;
    // ── 슬라이드 생성(pptx) ──
    onGenerateSlideDraft: () => void;
    onExportPptx: () => void;
    onExportHtml: () => void;
    pptxAvailable: boolean;
    pptxBusy: string | null;
    pptxThemes: SlideTheme[];
    pptxOptions: SlideExportOptions;
    onPptxOptionsChange: (next: SlideExportOptions) => void;
    // ── 이미지 생성(image-gen) ──
    onInsertGeneratedImage: (dataUrl: string) => void;
    imageGenRefDropped: string[] | null;
    onConsumeImageGenRefDropped: () => void;
    // ── 문서 개선(improve) 멀티턴 ──
    conversationHistory: AITurn[];
    onNewThread: () => void;
}

/** stt/ocr 모드 본문 — secureStorage 초기화 가드(기존 ConvertSidebar 패턴). */
function ConvertModeBody({ visible, children }: { visible: boolean; children: ReactNode }) {
    const [keysReady, setKeysReady] = useState(false);
    useEffect(() => {
        if (!visible) return;
        let cancelled = false;
        (async () => {
            await initSecureStorage();
            if (!cancelled) setKeysReady(true);
        })();
        return () => {
            cancelled = true;
        };
    }, [visible]);

    if (!keysReady) return <div className="convert-sidebar-loading">로딩 중...</div>;
    return <>{children}</>;
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
    notesTemplate,
    notesResult,
    loadTemplates,
    openEditorWindow,
    onModeChange,
    onLanguageChange,
    onNotesTemplateChange,
    onRun,
    onStop,
    onShowSettings,
    converter,
    audioDropped,
    ocrDropped,
    onConsumeAudioDropped,
    onConsumeOcrDropped,
    onGenerateSlideDraft,
    onExportPptx,
    onExportHtml,
    pptxAvailable,
    pptxBusy,
    pptxThemes,
    pptxOptions,
    onPptxOptionsChange,
    onInsertGeneratedImage,
    imageGenRefDropped,
    onConsumeImageGenRefDropped,
    conversationHistory,
    onNewThread,
    injectedQuote,
    onPromptChange,
}: AIPanelProps) {
    const [prompt, setPrompt] = useState('');
    const promptRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (mode === 'improve' && promptRef.current) {
            promptRef.current.focus();
        }
    }, [mode]);

    // "인용" 주입 — App 에서 선택을 마커로 넣음. key 변경 시 프롬프트 끝에 마커 append + 포커스.
    useEffect(() => {
        if (!injectedQuote) return;
        setPrompt((p) => (p.trim() ? p.replace(/\s+$/, '') + ' ' : '') + injectedQuote.marker + ' ');
        promptRef.current?.focus();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [injectedQuote?.key]);

    // 프롬프트 변경 시 App 에 알림 → 살아있는 인용 마커의 하이라이트 동기화.
    useEffect(() => {
        onPromptChange?.(prompt);
    }, [prompt, onPromptChange]);

    if (!visible) return null;

    const handleRun = () => {
        if (!apiKeySet) {
            onShowSettings();
            return;
        }
        if (mode === 'improve' && !prompt.trim()) return;
        onRun(content, prompt || undefined);
        setPrompt(''); // 실행 후 입력창 자동 리셋
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

    // stt/ocr/pptx/image-gen 은 AI 에이전트 키(apiKeySet)와 무관 — 키 게이트를 적용하지 않는다.
    // (image-gen 은 ImageGenPanel 이 gemini/openai 키를 자체 검사한다.)
    const isConvertMode = mode === 'stt' || mode === 'ocr';
    const isPptxMode = mode === 'pptx';
    const isImageGenMode = mode === 'image-gen';
    const keyGated = !isConvertMode && !isPptxMode && !isImageGenMode && !apiKeySet;

    // 헤더에 표시할 현재 모드의 모델 — 텍스트/이미지는 Settings 전역 선택, stt/ocr 은 변환 엔진(커스텀).
    const headerModel =
        mode === 'stt' || mode === 'ocr'
            ? { logo: '/aib.svg', label: '커스텀 모델', sub: false }
            : mode === 'image-gen'
              ? getSelectionDisplay(IMAGE_AI_CATALOG, getImageAIModelSelection())
              : getSelectionDisplay(AI_CATALOG, getAIModelSelection());

    return (
        <div className="ai-panel">
            <div className="ai-panel-header">
                <span className="ai-panel-title">
                    <Sparkles size={14} /> AI 에이전트
                </span>
                <span className="ai-panel-model" title="현재 AI 모델 (Settings 에서 변경)">
                    <img src={headerModel.logo} alt="" className="ai-panel-model-logo" />
                    <span className="ai-panel-model-label">{headerModel.label}</span>
                    {headerModel.sub && <span className="ai-panel-model-sub">구독</span>}
                </span>
            </div>

            <ModeSelector mode={mode} onChange={onModeChange} />

            {mode === 'stt' && (
                <ConvertModeBody visible={visible}>
                    <AudioTab
                        converter={converter}
                        onOpenResult={openEditorWindow}
                        droppedFiles={audioDropped}
                        onConsumeDropped={onConsumeAudioDropped}
                    />
                </ConvertModeBody>
            )}

            {mode === 'ocr' && (
                <ConvertModeBody visible={visible}>
                    <OcrTab
                        converter={converter}
                        onOpenResult={openEditorWindow}
                        droppedFile={ocrDropped}
                        onConsumeDropped={onConsumeOcrDropped}
                    />
                </ConvertModeBody>
            )}

            {isPptxMode && (
                <div className="ai-pptx-mode">
                    <SlideExportPanel
                        content={content}
                        available={pptxAvailable}
                        busy={pptxBusy}
                        themes={pptxThemes}
                        options={pptxOptions}
                        onOptionsChange={onPptxOptionsChange}
                        onGenerateDraft={onGenerateSlideDraft}
                        onExportDirect={onExportPptx}
                        onExportHtml={onExportHtml}
                        onShowSettings={onShowSettings}
                    />
                </div>
            )}

            {isImageGenMode && (
                <ConvertModeBody visible={visible}>
                    <ImageGenPanel
                        onInsertImage={onInsertGeneratedImage}
                        onShowSettings={onShowSettings}
                        refDropped={imageGenRefDropped}
                        onConsumeRefDropped={onConsumeImageGenRefDropped}
                    />
                </ConvertModeBody>
            )}

            {keyGated && (
                <div className="ai-no-key">
                    <AlertCircle size={20} />
                    <p>API 키를 설정해주세요</p>
                    <button className="ai-btn primary" onClick={onShowSettings}>
                        설정하기
                    </button>
                </div>
            )}

            {!isConvertMode && !isPptxMode && !isImageGenMode && !keyGated && (
                <>
                    {mode === 'improve' && (
                        <ConversationTimeline messages={conversationHistory} onNewThread={onNewThread} />
                    )}
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
                                        ? '원하는 작업을 입력하세요 — 개선·추가·재구성·요약·표 만들기 등 (필수)'
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
                        {isLoading ? (
                            <button className="ai-btn" onClick={onStop} title="중지">
                                <Loader2 size={14} className="spinning" /> 중지
                            </button>
                        ) : (
                            <button
                                className="ai-btn primary"
                                onClick={handleRun}
                                disabled={runDisabled}
                                title="실행"
                            >
                                <Send size={14} />
                                {mode === 'meeting-notes' ? '회의록 생성' : '실행'}
                            </button>
                        )}
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
