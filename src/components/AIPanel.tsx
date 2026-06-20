/**
 * AI 에이전트 사이드 패널 — 단일 진입점(#60).
 * 8 모드: 음성 인식(stt) / 이미지 인식(ocr) / 회의록 작성 / 슬라이드 만들기(pptx) /
 *         문서 개선 / 문법 교정 / 번역 / 마인드맵 정리(structurize).
 *  - stt/ocr: 기존 AudioTab/OcrTab 을 그대로 mount(변환 로직 재사용). converter 자체 키 사용.
 *  - pptx: 현재 문서를 AI 레이아웃으로 .pptx 내보내기(onExportPptx).
 *  - 나머지: prompt → onRun → InlineDiff / ResultCard.
 * 모드별 옵션 UI 는 sub-component 로 분리 (ModeSelector, LlmSelector, NotesOptions, NotesResultCard).
 */

import { useState, useRef, useEffect, ReactNode } from 'react';
import { AIMode, TranslateLanguage, AITurn } from '../types/ai';
import { Sparkles, Send, Loader2, AlertCircle, Presentation } from 'lucide-react';
import type { NotesJobResult, TemplateInfo } from '../types/converter';
import type { useConverter } from '../hooks/useConverter';
import type { DroppedFile } from './convert/types';
import { initSecureStorage, hasKey } from '../services/secureStorage';
import {
    AI_CATALOG,
    getAIModelSelection,
    setAIModelSelection,
    resolveUsableSelection,
    type AICompany,
    type AIAuthMode,
} from '../services/aiModelConfig';
import { detectSubscriptionLogins } from '../services/subscriptionService';
import { InlineModelDropdown } from './ai/InlineModelDropdown';
import { ModeSelector } from './ai/ModeSelector';
import { ConversationTimeline } from './ai/ConversationTimeline';
import { NotesOptions } from './ai/NotesOptions';
import { NotesResultCard } from './ai/NotesResultCard';
import { ImageGenPanel } from './ai/ImageGenPanel';
import { AudioTab } from './convert/AudioTab';
import { OcrTab } from './convert/OcrTab';
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
    onShowSettings: () => void;
    // ── 입력 변환(stt/ocr) ──
    converter: ReturnType<typeof useConverter>;
    audioDropped: DroppedFile[] | null;
    ocrDropped: DroppedFile | null;
    onConsumeAudioDropped: () => void;
    onConsumeOcrDropped: () => void;
    // ── 슬라이드 만들기(pptx) ──
    onExportPptx: () => void;
    pptxAvailable: boolean;
    pptxBusy: string | null;
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
    onShowSettings,
    converter,
    audioDropped,
    ocrDropped,
    onConsumeAudioDropped,
    onConsumeOcrDropped,
    onExportPptx,
    pptxAvailable,
    pptxBusy,
    onInsertGeneratedImage,
    imageGenRefDropped,
    onConsumeImageGenRefDropped,
    conversationHistory,
    onNewThread,
}: AIPanelProps) {
    const [prompt, setPrompt] = useState('');
    const promptRef = useRef<HTMLTextAreaElement>(null);

    // 인라인 모델 드롭다운 — 텍스트 작업·슬라이드 공통(전역 텍스트 모델). 가용성=키 or 구독.
    const [, bumpModel] = useState(0);
    const [subStatus, setSubStatus] = useState({ claude: false, codex: false, gemini: false, grok: false });
    useEffect(() => {
        detectSubscriptionLogins().then(setSubStatus).catch(() => {});
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

    // stt/ocr/pptx/image-gen 은 AI 에이전트 키(apiKeySet)와 무관 — 키 게이트를 적용하지 않는다.
    // (image-gen 은 ImageGenPanel 이 gemini/openai 키를 자체 검사한다.)
    const isConvertMode = mode === 'stt' || mode === 'ocr';
    const isPptxMode = mode === 'pptx';
    const isImageGenMode = mode === 'image-gen';
    const keyGated = !isConvertMode && !isPptxMode && !isImageGenMode && !apiKeySet;

    // 인라인 모델 드롭다운 JSX — 텍스트 작업(improve/grammar/translate/structurize/meeting-notes)
    // 과 슬라이드(pptx)가 같은 전역 텍스트 모델을 쓰므로 하나를 공유한다.
    const textIsUsable = (company: AICompany, auth: AIAuthMode): boolean =>
        auth === 'subscription'
            ? company === 'claude'
                ? subStatus.claude
                : company === 'openai'
                  ? subStatus.codex
                  : company === 'gemini'
                    ? subStatus.gemini
                    : company === 'grok'
                      ? subStatus.grok
                      : false
            : hasKey(company);
    const textSel = resolveUsableSelection(AI_CATALOG, getAIModelSelection(), textIsUsable);
    const textModelDropdown = (
        <InlineModelDropdown
            label="AI 모델"
            catalog={AI_CATALOG}
            selection={textSel}
            onChange={(s) => {
                setAIModelSelection(s);
                bumpModel((n) => n + 1);
            }}
            isUsable={textIsUsable}
        />
    );

    return (
        <div className="ai-panel">
            <div className="ai-panel-header">
                <span className="ai-panel-title">
                    <Sparkles size={14} /> AI 에이전트
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
                    {!pptxAvailable ? (
                        <div className="ai-no-key">
                            <AlertCircle size={20} />
                            <p>슬라이드 레이아웃에 Claude 또는 Gemini 키가 필요합니다</p>
                            <button className="ai-btn primary" onClick={onShowSettings}>
                                설정하기
                            </button>
                        </div>
                    ) : (
                        <>
                            {textModelDropdown}
                            <div className="ai-prompt-actions">
                                <button
                                    className="ai-btn primary"
                                    onClick={onExportPptx}
                                    disabled={!!pptxBusy || content.trim().length === 0}
                                    title="슬라이드 만들기"
                                >
                                    {pptxBusy ? <Loader2 size={14} className="spinning" /> : <Presentation size={14} />}
                                    {pptxBusy ? '생성 중...' : '슬라이드 만들기'}
                                </button>
                                {pptxBusy && <div className="ai-pptx-busy">{pptxBusy}</div>}
                            </div>
                        </>
                    )}
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
                    {textModelDropdown}
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
