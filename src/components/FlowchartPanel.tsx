/**
 * 플로우차트 생성 패널 — 마인드맵 FrameworkPanel 과 동형(모달).
 *
 * 소스(문서/주제) + 관점 + 방향 + 상세도를 받아 generateFlowchart 로 생성한 뒤
 * onApply(fc) 로 부모(FlowchartView)에 넘긴다. FlowchartView 가 upsertFlowchartBlock →
 * onChange 로 마크다운 SSOT 에 저장. (이슈: 플로우차트 생성 모달)
 */

import { useState, useRef } from 'react';
import { Loader2, X } from 'lucide-react';
import { generateFlowchart } from '../services/aiService';
import { confirmAction } from '../services/dialogService';
import type { StoredFlowchart } from '../lib/flowchartBlock';
import './FrameworkPanel.css';
import './FlowchartPanel.css';

// FlowchartView 와 동일 임계값(문서 기반 생성 가드).
const MIN_CHARS = 80;
const WARN_CHARS = 6000;
const HARD_CHARS = 30000;

interface FlowchartPanelProps {
    /** 현재 문서 — 소스 'doc' 일 때 사용. */
    content: string;
    onApply: (fc: StoredFlowchart, mode: 'replace' | 'append') => void;
    onClose: () => void;
}

export function FlowchartPanel({ content, onApply, onClose }: FlowchartPanelProps) {
    const docNonEmpty = content.trim().length > 0;
    const [source, setSource] = useState<'doc' | 'topic'>(docNonEmpty ? 'doc' : 'topic');
    const [topic, setTopic] = useState('');
    const [perspective, setPerspective] = useState<'process' | 'decision' | 'data'>('process');
    const [direction, setDirection] = useState<'LR' | 'TB'>('LR');
    const [detail, setDetail] = useState<'basic' | 'detailed'>('basic');
    const [mode, setMode] = useState<'replace' | 'append'>(docNonEmpty ? 'append' : 'replace');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    const runGenerate = async () => {
        const sourceText = source === 'doc' ? content : topic.trim();
        if (!sourceText) return;
        // 문서 기반 길이 가드 — 비용/품질 경고.
        if (source === 'doc') {
            const len = content.trim().length;
            if (len < MIN_CHARS) {
                setError('흐름도로 만들기엔 문서 내용이 너무 짧습니다.');
                return;
            }
            if (len > HARD_CHARS) {
                const ok = await confirmAction(
                    `문서가 매우 깁니다 (${len.toLocaleString()}자).\n\n비용·시간이 크게 늘고 핵심을 제대로 추리지 못하거나 도중에 실패할 수 있어요. 짧은 문서로 나누길 권장합니다. 그래도 진행할까요?`,
                    { title: '경고', kind: 'warning' },
                );
                if (!ok) return;
            } else if (len > WARN_CHARS) {
                const ok = await confirmAction(
                    `문서가 깁니다 (${len.toLocaleString()}자).\n\nAI 가 핵심 흐름만 추려 만들어 세부는 단순화되고, 문서가 길수록 토큰 비용도 늘어납니다. 계속할까요?`,
                    { title: '주의', kind: 'info' },
                );
                if (!ok) return;
            }
        }
        // 교체 모드 — 기존 문서가 사라지므로 확인(⌘Z 로 복구 가능).
        if (mode === 'replace' && docNonEmpty) {
            const ok = await confirmAction(
                '현재 문서 내용을 교체합니다. 계속할까요? (⌘Z 로 되돌릴 수 있습니다)',
                { title: '확인', kind: 'warning' },
            );
            if (!ok) return;
        }
        const controller = new AbortController();
        abortRef.current = controller;
        setLoading(true);
        setError(null);
        try {
            const fc = await generateFlowchart({ source, content, topic: topic.trim() }, { perspective, direction, detail }, 'Korean', controller.signal);
            onApply(fc, mode);
            onClose();
        } catch (e) {
            if (e instanceof DOMException && e.name === 'AbortError') { setLoading(false); return; } // 중지
            setError(e instanceof Error ? e.message : '플로우차트 생성에 실패했습니다.');
            setLoading(false);
        }
    };

    return (
        <div className="fw-backdrop" onClick={loading ? undefined : onClose} aria-hidden>
            <div className="fw-panel" role="dialog" aria-modal onClick={(e) => e.stopPropagation()}>
                <div className="fw-head">
                    <span>플로우차트 생성</span>
                    <button type="button" className="modal-close" onClick={onClose} title="닫기" disabled={loading}>
                        <X size={18} />
                    </button>
                </div>

                {/* 소스 — 문서가 있을 때만 선택지(없으면 주제 입력 고정) */}
                {docNonEmpty && (
                    <div className="fc-opt-group">
                        <span className="fc-opt-label">생성 계획</span>
                        <div className="fc-opt-row">
                            <label><input type="radio" name="fc-source" checked={source === 'doc'} onChange={() => setSource('doc')} /> 자동 분석</label>
                            <label><input type="radio" name="fc-source" checked={source === 'topic'} onChange={() => setSource('topic')} /> 직접 입력</label>
                        </div>
                    </div>
                )}
                {source === 'topic' && (
                    <label className="fw-field">
                        <span>주제</span>
                        <input
                            value={topic}
                            onChange={(e) => setTopic(e.target.value)}
                            placeholder="예: 이커머스 환불 처리, 회원가입 인증…"
                        />
                    </label>
                )}

                {/* 관점 */}
                <div className="fc-opt-group">
                    <span className="fc-opt-label">관점</span>
                    <div className="fc-opt-row">
                        <label><input type="radio" name="fc-persp" checked={perspective === 'process'} onChange={() => setPerspective('process')} /> 절차 흐름</label>
                        <label><input type="radio" name="fc-persp" checked={perspective === 'decision'} onChange={() => setPerspective('decision')} /> 의사결정 중심</label>
                        <label><input type="radio" name="fc-persp" checked={perspective === 'data'} onChange={() => setPerspective('data')} /> 데이터 흐름</label>
                    </div>
                </div>

                {/* 방향 */}
                <div className="fc-opt-group">
                    <span className="fc-opt-label">방향</span>
                    <div className="fc-opt-row">
                        <label><input type="radio" name="fc-dir" checked={direction === 'LR'} onChange={() => setDirection('LR')} /> 가로 (→)</label>
                        <label><input type="radio" name="fc-dir" checked={direction === 'TB'} onChange={() => setDirection('TB')} /> 세로 (↓)</label>
                    </div>
                </div>

                {/* 상세도 */}
                <div className="fc-opt-group">
                    <span className="fc-opt-label">상세도</span>
                    <div className="fc-opt-row">
                        <label><input type="radio" name="fc-detail" checked={detail === 'basic'} onChange={() => setDetail('basic')} /> 기본</label>
                        <label><input type="radio" name="fc-detail" checked={detail === 'detailed'} onChange={() => setDetail('detailed')} /> 상세</label>
                    </div>
                </div>

                {/* 쓰기 모드 — 문서에 내용이 있을 때만 (마인드맵·간트와 동일) */}
                {docNonEmpty && (
                    <div className="fc-opt-group">
                        <span className="fc-opt-label">생성 방법</span>
                        <div className="fc-opt-row">
                            <label><input type="radio" name="fc-mode" checked={mode === 'append'} onChange={() => setMode('append')} /> 현재 문서에 추가</label>
                            <label><input type="radio" name="fc-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} /> 전체 교체</label>
                        </div>
                    </div>
                )}

                {error && <div className="fw-error">{error}</div>}

                <div className="modal-actions">
                    {loading ? (
                        <button type="button" className="modal-btn modal-btn-full" onClick={() => abortRef.current?.abort()}>
                            <Loader2 size={14} className="spinning" /> 중지
                        </button>
                    ) : (
                        <button
                            type="button"
                            className="modal-btn modal-btn-primary modal-btn-full"
                            onClick={runGenerate}
                            disabled={source === 'topic' && !topic.trim()}
                        >
                            생성
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
