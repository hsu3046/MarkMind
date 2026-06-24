/**
 * 칸반 보드 생성 패널 — 간트 GanttPanel 과 동형(모달).
 *
 * 소스(문서/주제) + 상세도 + 간트 호환 일정 옵션 + 쓰기모드(이어붙이기/교체)를 받아
 * generateKanban 으로 인라인 마커(@status/@priority/@start/@due/@progress) 마크다운을 생성한다.
 */

import { useState, useRef } from 'react';
import { Loader2, X } from 'lucide-react';
import { generateKanban } from '../services/aiService';
import { todayYmd } from '../lib/ganttSerialize';
import { confirmAction } from '../services/dialogService';
import './FrameworkPanel.css';
import './FlowchartPanel.css';

const MIN_CHARS = 40;
const WARN_CHARS = 6000;
const HARD_CHARS = 30000;

interface KanbanPanelProps {
    /** 현재 문서 — 소스 'doc' 일 때 사용. */
    content: string;
    onApply: (markdown: string, mode: 'replace' | 'append') => void;
    onClose: () => void;
}

export function KanbanPanel({ content, onApply, onClose }: KanbanPanelProps) {
    const docNonEmpty = content.trim().length > 0;
    const [source, setSource] = useState<'doc' | 'topic'>(docNonEmpty ? 'doc' : 'topic');
    const [topic, setTopic] = useState('');
    const [detail, setDetail] = useState<'basic' | 'detailed'>('basic');
    const [includeSchedule, setIncludeSchedule] = useState(true);
    const [startDate, setStartDate] = useState(todayYmd());
    const [mode, setMode] = useState<'replace' | 'append'>(docNonEmpty ? 'append' : 'replace');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    const runGenerate = async () => {
        const sourceText = source === 'doc' ? content : topic.trim();
        if (!sourceText) return;
        if (source === 'doc') {
            const len = content.trim().length;
            if (len < MIN_CHARS) {
                setError('칸반으로 만들기엔 문서 내용이 너무 짧습니다.');
                return;
            }
            if (len > HARD_CHARS) {
                const ok = await confirmAction(
                    `문서가 매우 깁니다 (${len.toLocaleString()}자).\n\n비용·시간이 크게 늘고 핵심 작업을 제대로 추리지 못하거나 도중에 실패할 수 있어요. 짧은 문서로 나누길 권장합니다. 그래도 진행할까요?`,
                    { title: '경고', kind: 'warning' },
                );
                if (!ok) return;
            } else if (len > WARN_CHARS) {
                const ok = await confirmAction(
                    `문서가 깁니다 (${len.toLocaleString()}자).\n\nAI 가 핵심 작업만 추려 만들어 세부는 단순화되고, 문서가 길수록 토큰 비용도 늘어납니다. 계속할까요?`,
                    { title: '주의', kind: 'info' },
                );
                if (!ok) return;
            }
        }
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
            const md = await generateKanban(
                { source, content, topic: topic.trim() },
                { detail, includeSchedule, startDate },
                'Korean',
                controller.signal,
            );
            onApply(md, mode);
            onClose();
        } catch (e) {
            if (e instanceof DOMException && e.name === 'AbortError') {
                setLoading(false);
                return;
            }
            setError(e instanceof Error ? e.message : '칸반 보드 생성에 실패했습니다.');
            setLoading(false);
        }
    };

    return (
        <div className="fw-backdrop" onClick={loading ? undefined : onClose} aria-hidden>
            <div className="fw-panel" role="dialog" aria-modal onClick={(e) => e.stopPropagation()}>
                <div className="fw-head">
                    <span>칸반 보드 생성</span>
                    <button type="button" className="modal-close" onClick={onClose} title="닫기" disabled={loading}>
                        <X size={18} />
                    </button>
                </div>

                {docNonEmpty && (
                    <div className="fc-opt-group">
                        <span className="fc-opt-label">생성 계획</span>
                        <div className="fc-opt-row">
                            <label><input type="radio" name="kb-source" checked={source === 'doc'} onChange={() => setSource('doc')} /> 자동 분석</label>
                            <label><input type="radio" name="kb-source" checked={source === 'topic'} onChange={() => setSource('topic')} /> 직접 입력</label>
                        </div>
                    </div>
                )}
                {source === 'topic' && (
                    <label className="fw-field">
                        <span>주제</span>
                        <input
                            value={topic}
                            onChange={(e) => setTopic(e.target.value)}
                            placeholder="예: 신제품 출시, 앱 개발, 콘텐츠 캘린더…"
                        />
                    </label>
                )}

                <div className="fc-opt-group">
                    <span className="fc-opt-label">상세도</span>
                    <div className="fc-opt-row">
                        <label><input type="radio" name="kb-detail" checked={detail === 'basic'} onChange={() => setDetail('basic')} /> 기본 (핵심 카드)</label>
                        <label><input type="radio" name="kb-detail" checked={detail === 'detailed'} onChange={() => setDetail('detailed')} /> 상세 (작업 분해)</label>
                    </div>
                </div>

                <div className="fc-opt-group">
                    <span className="fc-opt-label">호환성</span>
                    <div className="fc-opt-row">
                        <label>
                            <input
                                type="checkbox"
                                checked={includeSchedule}
                                onChange={(e) => setIncludeSchedule(e.target.checked)}
                            /> 간트 호환 일정 포함
                        </label>
                    </div>
                </div>

                {includeSchedule && (
                    <label className="fw-field">
                        <span>시작 기준일</span>
                        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                    </label>
                )}

                {docNonEmpty && (
                    <div className="fc-opt-group">
                        <span className="fc-opt-label">생성 방법</span>
                        <div className="fc-opt-row">
                            <label><input type="radio" name="kb-mode" checked={mode === 'append'} onChange={() => setMode('append')} /> 현재 문서에 추가</label>
                            <label><input type="radio" name="kb-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} /> 전체 교체</label>
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
