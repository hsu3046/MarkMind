/**
 * 변환 진행상황 표시 — Rust 가 emoji prefix 로 보낸 step 메시지를
 * lucide-react 아이콘 + 한국어 텍스트로 분리해서 렌더.
 *
 * 예) "✅ Pass 1 완료 (12.3초)" → <CheckCircle2/> "Pass 1 완료 (12.3초)"
 */

import { ReactNode } from 'react';
import { JobState } from '../../types/converter';
import {
    Upload, Clock, Volume2, CheckCircle2, Brain, Notebook, Scissors,
    AlertTriangle, Mic, Search, BarChart3, FileText, Save, Loader2,
} from 'lucide-react';

interface ProgressPanelProps {
    state: JobState;
}

/** emoji → lucide icon 매핑. doc-converter step 메시지의 모든 prefix 대응. */
function iconFor(step: string): { icon: ReactNode; text: string } {
    // emoji 길이 가변 (단일 codepoint or 합성). 첫 grapheme 추출.
    // 간단히 정규식으로 prefix emoji 매칭.
    const map: { pattern: RegExp; icon: ReactNode }[] = [
        { pattern: /^📤\s*/, icon: <Upload size={14} /> },
        { pattern: /^🕐\s*/, icon: <Clock size={14} /> },
        { pattern: /^🔊\s*/, icon: <Volume2 size={14} /> },
        { pattern: /^✅\s*/, icon: <CheckCircle2 size={14} className="ok" /> },
        { pattern: /^🧠\s*/, icon: <Brain size={14} /> },
        { pattern: /^📒\s*/, icon: <Notebook size={14} /> },
        { pattern: /^✂️\s*/, icon: <Scissors size={14} /> },
        { pattern: /^⚠️?\s*/, icon: <AlertTriangle size={14} className="warn" /> },
        { pattern: /^🎙️?\s*/, icon: <Mic size={14} /> },
        { pattern: /^🔪\s*/, icon: <Scissors size={14} /> },
        { pattern: /^🔍\s*/, icon: <Search size={14} /> },
        { pattern: /^📊\s*/, icon: <BarChart3 size={14} /> },
        { pattern: /^📑\s*/, icon: <FileText size={14} /> },
        { pattern: /^💾\s*/, icon: <Save size={14} /> },
        { pattern: /^📡\s*/, icon: <Upload size={14} /> },
        { pattern: /^⏳\s*/, icon: <Loader2 size={14} className="spinning" /> },
    ];
    for (const { pattern, icon } of map) {
        if (pattern.test(step)) {
            return { icon, text: step.replace(pattern, '') };
        }
    }
    return { icon: null, text: step };
}

export function ProgressPanel({ state }: ProgressPanelProps) {
    if (state.phase === 'idle' && state.steps.length === 0) return null;

    return (
        <div className={`convert-progress phase-${state.phase}`}>
            {state.phase === 'running' && (
                <div className="convert-progress-bar">
                    <div className="convert-progress-bar-fill indeterminate" />
                </div>
            )}
            <ol className="convert-progress-steps">
                {state.steps.map((s, i) => {
                    const { icon, text } = iconFor(s.step);
                    return (
                        <li key={i} className="convert-progress-step">
                            <div className="step-main">
                                {icon && <span className="step-icon">{icon}</span>}
                                <span className="step-text">{text}</span>
                            </div>
                            {s.detail && <div className="step-detail">{s.detail}</div>}
                        </li>
                    );
                })}
            </ol>
            {state.error && <div className="convert-progress-error">{state.error}</div>}
        </div>
    );
}
