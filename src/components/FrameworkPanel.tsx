/**
 * 프레임워크로 마인드맵 생성 패널 (MindBusiness 이식).
 *
 * 주제 + 프레임워크(범용 갤러리 + 비즈니스 접기) 선택 → generateFrameworkMindmap 으로 채운 뒤
 * onApply(tree, mode) 로 부모(MindmapView)에 넘긴다(쓰기=교체/이어붙이기, 모두 마크다운 SSOT 경유).
 * AI 추천(suggestFramework)은 선택을 하이라이트만 — 차단하지 않고 오버라이드 가능.
 */

import { useState } from 'react';
import { Sparkles, Loader2, X, ChevronDown, ChevronRight } from 'lucide-react';
import { frameworkList, FRAMEWORKS, type Framework } from '../lib/frameworks';
import { generateFrameworkMindmap, suggestFramework } from '../services/aiService';
import type { MindmapNode } from '../types/mindmap';
import './FrameworkPanel.css';

interface FrameworkPanelProps {
    initialTopic: string;
    /** 현재 문서에 실질 내용이 있으면 쓰기 모드(이어붙이기/교체)를 노출. */
    docNonEmpty: boolean;
    onApply: (tree: MindmapNode, mode: 'replace' | 'append') => void;
    onClose: () => void;
}

function FwCard({ fw, selected, onClick }: { fw: Framework; selected: boolean; onClick: () => void }) {
    return (
        <button type="button" className={`fw-card${selected ? ' fw-card-sel' : ''}`} onClick={onClick}>
            <span className="fw-card-name">{fw.name}</span>
            <span className="fw-card-desc">{fw.description}</span>
        </button>
    );
}

export function FrameworkPanel({ initialTopic, docNonEmpty, onApply, onClose }: FrameworkPanelProps) {
    const list = frameworkList();
    const general = list.filter((f) => f.general);
    const business = list.filter((f) => !f.general);

    const [topic, setTopic] = useState(initialTopic);
    const [selectedId, setSelectedId] = useState<string>(general[0]?.id ?? business[0]?.id ?? '');
    const [showBusiness, setShowBusiness] = useState(false);
    const [mode, setMode] = useState<'replace' | 'append'>(docNonEmpty ? 'append' : 'replace');
    const [loading, setLoading] = useState(false);
    const [suggesting, setSuggesting] = useState(false);
    const [suggestReason, setSuggestReason] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const selected = FRAMEWORKS[selectedId];

    const pick = (id: string) => {
        setSelectedId(id);
        setSuggestReason(null);
    };

    const runSuggest = async () => {
        const t = topic.trim() || initialTopic;
        setSuggesting(true);
        setError(null);
        try {
            const { frameworkId, reason } = await suggestFramework(t);
            setSelectedId(frameworkId);
            setSuggestReason(reason || null);
            if (!FRAMEWORKS[frameworkId]?.general) setShowBusiness(true);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'AI 추천에 실패했습니다.');
        } finally {
            setSuggesting(false);
        }
    };

    const runGenerate = async () => {
        const t = topic.trim();
        if (!selected || !t) return;
        if (mode === 'replace' && docNonEmpty) {
            const ok = window.confirm('현재 문서 내용을 교체합니다. 계속할까요? (⌘Z 로 되돌릴 수 있습니다)');
            if (!ok) return;
        }
        setLoading(true);
        setError(null);
        try {
            const tree = await generateFrameworkMindmap(t, selected, selected.intent);
            onApply(tree, mode);
            onClose();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'AI 생성에 실패했습니다.');
            setLoading(false);
        }
    };

    return (
        <div className="fw-backdrop" onClick={loading ? undefined : onClose} aria-hidden>
            <div className="fw-panel" role="dialog" aria-modal onClick={(e) => e.stopPropagation()}>
                <div className="fw-head">
                    <span>프레임워크로 마인드맵 생성</span>
                    <button type="button" className="fw-x" onClick={onClose} title="닫기" disabled={loading}>
                        <X size={16} />
                    </button>
                </div>

                <label className="fw-field">
                    <span>주제</span>
                    <input
                        value={topic}
                        onChange={(e) => setTopic(e.target.value)}
                        placeholder="예: 카페 창업, 신규 기능 출시, 회의 안건…"
                    />
                </label>

                <div className="fw-suggest-row">
                    <button type="button" className="fw-suggest" onClick={runSuggest} disabled={suggesting || loading || !topic.trim()}>
                        {suggesting ? <Loader2 size={13} className="spinning" /> : <Sparkles size={13} />}
                        AI 추천
                    </button>
                    {suggestReason && <span className="fw-suggest-reason">✨ {suggestReason}</span>}
                </div>

                <div className="fw-gallery">
                    {general.map((f) => (
                        <FwCard key={f.id} fw={f} selected={f.id === selectedId} onClick={() => pick(f.id)} />
                    ))}
                </div>

                <button type="button" className="fw-biz-toggle" onClick={() => setShowBusiness((v) => !v)}>
                    {showBusiness ? <ChevronDown size={14} /> : <ChevronRight size={14} />} 비즈니스 프레임워크
                </button>
                {showBusiness && (
                    <div className="fw-gallery">
                        {business.map((f) => (
                            <FwCard key={f.id} fw={f} selected={f.id === selectedId} onClick={() => pick(f.id)} />
                        ))}
                    </div>
                )}

                {selected && (
                    <div className="fw-slots">
                        {selected.slots.map((s) => (
                            <span key={s.label} className="fw-slot-chip" title={s.display}>
                                {s.label}
                            </span>
                        ))}
                    </div>
                )}

                {docNonEmpty && (
                    <div className="fw-mode">
                        <label>
                            <input type="radio" name="fw-mode" checked={mode === 'append'} onChange={() => setMode('append')} />
                            현재 문서에 이어붙이기
                        </label>
                        <label>
                            <input type="radio" name="fw-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />
                            현재 문서 교체
                        </label>
                    </div>
                )}

                {error && <div className="fw-error">{error}</div>}

                <div className="fw-actions">
                    <button type="button" onClick={onClose} disabled={loading}>
                        취소
                    </button>
                    <button type="button" className="fw-go" onClick={runGenerate} disabled={loading || !selected || !topic.trim()}>
                        {loading ? (
                            <>
                                <Loader2 size={14} className="spinning" /> 생성 중…
                            </>
                        ) : (
                            '생성'
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
