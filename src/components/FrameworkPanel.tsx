/**
 * 프레임워크로 마인드맵 생성 패널 (MindBusiness 이식).
 *
 * 주제 + 프레임워크(기본 갤러리 + 고급 접기) 선택 → generateFrameworkMindmap 으로 채운 뒤
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

/** AI 추천 카드의 sentinel — 실제 프레임워크가 아니라 "생성 시 LLM 이 주제 보고 선택" 표시. */
const SUGGEST_ID = '__suggest__';

export function FrameworkPanel({ initialTopic, docNonEmpty, onApply, onClose }: FrameworkPanelProps) {
    const list = frameworkList();
    const basicList = list.filter((f) => f.basic);
    const advanced = list.filter((f) => !f.basic);

    const [topic, setTopic] = useState(initialTopic);
    const [selectedId, setSelectedId] = useState<string>(SUGGEST_ID); // 기본 = AI 추천
    const [showAdvanced, setShowBusiness] = useState(false);
    const [mode, setMode] = useState<'replace' | 'append'>(docNonEmpty ? 'append' : 'replace');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const selected = FRAMEWORKS[selectedId];
    const isSuggest = selectedId === SUGGEST_ID;

    const pick = (id: string) => setSelectedId(id);

    const runGenerate = async () => {
        const t = topic.trim();
        if (!t) return;
        if (mode === 'replace' && docNonEmpty) {
            const ok = window.confirm('현재 문서 내용을 교체합니다. 계속할까요? (⌘Z 로 되돌릴 수 있습니다)');
            if (!ok) return;
        }
        setLoading(true);
        setError(null);
        try {
            // AI 추천 선택이면 먼저 주제에 맞는 프레임워크를 LLM 이 결정한 뒤 생성.
            let fw = selected;
            if (isSuggest) {
                const { frameworkId } = await suggestFramework(t);
                fw = FRAMEWORKS[frameworkId] ?? FRAMEWORKS.LOGIC;
            }
            if (!fw) { setLoading(false); return; }
            const tree = await generateFrameworkMindmap(t, fw, fw.intent);
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
                    <span>마인드맵 자동 생성</span>
                    <button type="button" className="modal-close" onClick={onClose} title="닫기" disabled={loading}>
                        <X size={18} />
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

                {/* 슬롯 미리보기 — 선택한 프레임워크의 L1 골격(주제 바로 아래). AI 추천 선택 시엔 미정이라 숨김. */}
                {selected && (
                    <div className="fw-slots">
                        {selected.slots.map((s) => (
                            <span key={s.label} className="fw-slot-chip" title={s.display}>
                                {s.label}
                            </span>
                        ))}
                    </div>
                )}

                <div className="fw-gallery">
                    {/* AI 추천 — 첫 카드, 기본 선택. 생성 시 LLM 이 주제에 맞는 프레임워크를 골라 만든다. */}
                    <button
                        type="button"
                        className={`fw-card fw-card-suggest${isSuggest ? ' fw-card-sel' : ''}`}
                        onClick={() => setSelectedId(SUGGEST_ID)}
                    >
                        <span className="fw-card-name"><Sparkles size={13} /> AI 추천</span>
                        <span className="fw-card-desc">주제에 맞는 프레임워크를 AI가 골라 생성</span>
                    </button>
                    {basicList.map((f) => (
                        <FwCard key={f.id} fw={f} selected={f.id === selectedId} onClick={() => pick(f.id)} />
                    ))}
                </div>

                <button type="button" className="fw-biz-toggle" onClick={() => setShowBusiness((v) => !v)}>
                    {showAdvanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />} 더 많은 프레임워크
                </button>
                {showAdvanced && (
                    <div className="fw-gallery">
                        {advanced.map((f) => (
                            <FwCard key={f.id} fw={f} selected={f.id === selectedId} onClick={() => pick(f.id)} />
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

                <div className="modal-actions">
                    <button type="button" className="modal-btn modal-btn-primary modal-btn-full" onClick={runGenerate} disabled={loading || !topic.trim()}>
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
