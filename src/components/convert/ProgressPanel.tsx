/**
 * 변환 진행상황 표시 — Rust 가 emoji prefix 로 보낸 step 메시지를
 * lucide-react 아이콘 + 한국어 텍스트로 분리해서 렌더.
 *
 * 예) "✅ Pass 1 완료 (12.3초)" → <CheckCircle2/> "Pass 1 완료 (12.3초)"
 */

import { ReactNode } from 'react';
import { JobState, ProgressStep } from '../../types/converter';
import { AI_CATALOG, getSelectionDisplay } from '../../services/aiModelConfig';
import {
    Upload, Clock, AudioLines, CheckCircle2, Binoculars, Notebook, Scissors,
    AlertTriangle, MessagesSquare, FastForward, Combine, Waypoints,
    HardDriveDownload, Search, BarChart3, FileText, Save, Loader2,
} from 'lucide-react';

interface ProgressPanelProps {
    state: JobState;
    newestFirst?: boolean;
    showStepProgress?: boolean;
    modelDetailMode?: 'all' | 'running';
}

/** emoji → lucide icon 매핑. doc-converter step 메시지의 모든 prefix 대응. */
function iconFor(step: string): { icon: ReactNode; text: string } {
    // emoji 길이 가변 (단일 codepoint or 합성). 첫 grapheme 추출.
    // 간단히 정규식으로 prefix emoji 매칭.
    const map: { pattern: RegExp; icon: ReactNode }[] = [
        { pattern: /^📤\s*/, icon: <Upload size={14} /> },
        { pattern: /^🕐\s*/, icon: <Clock size={14} /> },
        { pattern: /^🔊\s*/, icon: <AudioLines size={14} /> },
        { pattern: /^✅\s*/, icon: <CheckCircle2 size={14} className="ok" /> },
        { pattern: /^🧠\s*/, icon: <Binoculars size={14} /> },
        { pattern: /^📒\s*/, icon: <Notebook size={14} /> },
        { pattern: /^✂️\s*/, icon: <Scissors size={14} /> },
        { pattern: /^⚠️?\s*/, icon: <AlertTriangle size={14} className="warn" /> },
        // 화자 분석/분리/라벨 통일 — 🎭 (구 🎙️ 도 호환 유지)
        { pattern: /^🎭\s*/, icon: <MessagesSquare size={14} /> },
        { pattern: /^🎙️?\s*/, icon: <MessagesSquare size={14} /> },
        { pattern: /^⚡\s*/, icon: <FastForward size={14} /> },
        { pattern: /^🔗\s*/, icon: <Combine size={14} /> },
        { pattern: /^🔁\s*/, icon: <Waypoints size={14} /> },
        { pattern: /^📁\s*/, icon: <HardDriveDownload size={14} /> },
        { pattern: /^📝\s*/, icon: <FileText size={14} /> },
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

function ModelDetail({ step, mode }: { step: ProgressStep; mode: 'all' | 'running' }) {
    if (!step.model) return step.detail ? <div className="step-detail">{step.detail}</div> : null;
    if (mode === 'running' && !/^⏳\s*/.test(step.step)) return null;
    const display = getSelectionDisplay(AI_CATALOG, {
        company: step.model.company,
        auth: step.model.auth,
        model: step.model.model,
    });
    return (
        <div className="step-detail step-model-detail" title={step.detail ?? step.model.model}>
            {display.logo && <img src={display.logo} alt="" className="step-model-logo" />}
            <span className="step-model-label">{display.label}</span>
            {display.sub && <span className="step-model-sub">구독</span>}
        </div>
    );
}

export function ProgressPanel({
    state,
    newestFirst = true,
    showStepProgress = true,
    modelDetailMode = 'all',
}: ProgressPanelProps) {
    if (state.phase === 'idle' && state.steps.length === 0) return null;

    const steps = newestFirst ? state.steps.slice().reverse() : state.steps;

    return (
        <div className={`convert-progress phase-${state.phase}`}>
            {state.phase === 'running' && (
                <div className="convert-progress-bar">
                    <div className="convert-progress-bar-fill indeterminate" />
                </div>
            )}
            <ol className="convert-progress-steps">
                {steps
                    .map((s, i) => {
                        const { icon, text } = iconFor(s.step);
                        return (
                            <li
                                key={s.stepId ?? `${newestFirst ? state.steps.length - 1 - i : i}`}
                                className="convert-progress-step"
                            >
                                <div className="step-main">
                                    {icon && <span className="step-icon">{icon}</span>}
                                    <span className="step-text">{text}</span>
                                </div>
                                {showStepProgress && typeof s.progress === 'number' && (
                                    <div className="step-progress-bar">
                                        <div
                                            className="step-progress-fill"
                                            style={{ width: `${Math.round(s.progress * 100)}%` }}
                                        />
                                    </div>
                                )}
                                <ModelDetail step={s} mode={modelDetailMode} />
                            </li>
                        );
                    })}
            </ol>
            {state.error && <div className="convert-progress-error">{state.error}</div>}
        </div>
    );
}
