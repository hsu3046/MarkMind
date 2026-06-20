/**
 * 문서 개선(improve) 결과 — 원본 | 결과를 좌우 Preview 로 비교(before/after).
 * improve 는 전체 변형이라 chunk diff 가 노이즈 → diff 대신 렌더 비교 + 전체 적용/취소.
 * 기존 Split View 와 같은 좌우 분할 + 드래그 핸들(비율 조절) UX 를 재현한다(읽기 전용 Preview).
 */

import { useState, useRef, useEffect } from 'react';
import { Check, X } from 'lucide-react';
import { Preview } from './Preview';
import './BeforeAfterView.css';

interface BeforeAfterViewProps {
    before: string;
    after: string;
    fontSize: number;
    onApply: () => void;
    onCancel: () => void;
}

export function BeforeAfterView({ before, after, fontSize, onApply, onCancel }: BeforeAfterViewProps) {
    const [ratio, setRatio] = useState(0.5);
    const panesRef = useRef<HTMLDivElement>(null);
    const draggingRef = useRef(false);

    // 핸들 드래그로 좌우 비율 조절(기존 split-handle 패턴과 동일).
    useEffect(() => {
        const onMove = (e: MouseEvent) => {
            if (!draggingRef.current || !panesRef.current) return;
            const rect = panesRef.current.getBoundingClientRect();
            const r = (e.clientX - rect.left) / rect.width;
            setRatio(Math.min(0.8, Math.max(0.2, r)));
        };
        const onUp = () => {
            draggingRef.current = false;
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
    }, []);

    return (
        <div className="ba-view">
            <div className="ba-toolbar">
                <span className="ba-toolbar-title">AI 문서 개선 — 원본 vs 결과</span>
                <div className="ba-toolbar-actions">
                    <button className="ba-btn" onClick={onCancel}>
                        <X size={14} /> 취소
                    </button>
                    <button className="ba-btn primary" onClick={onApply}>
                        <Check size={14} /> 적용
                    </button>
                </div>
            </div>
            <div className="ba-panes" ref={panesRef}>
                <div className="ba-pane" style={{ width: `${ratio * 100}%` }}>
                    <div className="ba-pane-label">원본</div>
                    <div className="ba-pane-body">
                        <Preview content={before} fontSize={fontSize} />
                    </div>
                </div>
                <div className="ba-handle" onMouseDown={() => { draggingRef.current = true; }} />
                <div className="ba-pane" style={{ width: `${(1 - ratio) * 100}%` }}>
                    <div className="ba-pane-label after">결과</div>
                    <div className="ba-pane-body">
                        <Preview content={after} fontSize={fontSize} />
                    </div>
                </div>
            </div>
        </div>
    );
}
