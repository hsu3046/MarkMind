/**
 * AI 에이전트 모드 라디오 그룹 — AIPanel 에서 분리.
 */

import { SpellCheck, Languages, Wand2, FileText } from 'lucide-react';
import { AIMode } from '../../types/ai';

interface ModeSelectorProps {
    mode: AIMode;
    onChange: (m: AIMode) => void;
}

export function ModeSelector({ mode, onChange }: ModeSelectorProps) {
    return (
        <div className="ai-modes">
            <label className={`ai-mode-radio${mode === 'grammar' ? ' active' : ''}`}>
                <input type="radio" name="ai-mode" checked={mode === 'grammar'} onChange={() => onChange('grammar')} />
                <SpellCheck size={13} /> 문법 교정
            </label>
            <label className={`ai-mode-radio${mode === 'translate' ? ' active' : ''}`}>
                <input type="radio" name="ai-mode" checked={mode === 'translate'} onChange={() => onChange('translate')} />
                <Languages size={13} /> 번역
            </label>
            <label className={`ai-mode-radio${mode === 'improve' ? ' active' : ''}`}>
                <input type="radio" name="ai-mode" checked={mode === 'improve'} onChange={() => onChange('improve')} />
                <Wand2 size={13} /> 문서 개선
            </label>
            <label className={`ai-mode-radio${mode === 'meeting-notes' ? ' active' : ''}`}>
                <input type="radio" name="ai-mode" checked={mode === 'meeting-notes'} onChange={() => onChange('meeting-notes')} />
                <FileText size={13} /> 회의록 작성
            </label>
        </div>
    );
}
