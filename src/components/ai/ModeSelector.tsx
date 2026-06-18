/**
 * AI 에이전트 모드 라디오 그룹 — AIPanel 에서 분리.
 * 순서(#60): 입력(음성/이미지) → 생성(회의록/슬라이드) → 편집(개선/문법/번역).
 * 'structurize'(마인드맵 정리)는 마인드맵 뷰 상단 버튼으로 이동(#60).
 */

import { Mic, ScanText, FileText, Presentation, ImagePlus, Wand2, SpellCheck, Languages } from 'lucide-react';
import { LucideIcon } from 'lucide-react';
import { AIMode } from '../../types/ai';

interface ModeSelectorProps {
    mode: AIMode;
    onChange: (m: AIMode) => void;
}

const MODES: { value: AIMode; label: string; Icon: LucideIcon }[] = [
    { value: 'stt', label: '음성 인식', Icon: Mic },
    { value: 'ocr', label: '이미지 인식', Icon: ScanText },
    { value: 'meeting-notes', label: '회의록 작성', Icon: FileText },
    { value: 'pptx', label: '슬라이드 만들기', Icon: Presentation },
    { value: 'image-gen', label: '이미지 생성', Icon: ImagePlus },
    { value: 'improve', label: '문서 개선', Icon: Wand2 },
    { value: 'grammar', label: '문법 교정', Icon: SpellCheck },
    { value: 'translate', label: '번역', Icon: Languages },
];

export function ModeSelector({ mode, onChange }: ModeSelectorProps) {
    return (
        <div className="ai-modes">
            {MODES.map(({ value, label, Icon }) => (
                <label key={value} className={`ai-mode-radio${mode === value ? ' active' : ''}`}>
                    <input type="radio" name="ai-mode" checked={mode === value} onChange={() => onChange(value)} />
                    <Icon size={13} /> {label}
                </label>
            ))}
        </div>
    );
}
