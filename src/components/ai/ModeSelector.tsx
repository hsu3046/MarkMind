/**
 * AI 에이전트 모드 라디오 그룹 — AIPanel 에서 분리.
 * 순서: 편집(개선/문법/번역) → 이미지 생성 → 변환(음성/이미지 텍스트) → 생성(회의록/슬라이드).
 * 'structurize'(마인드맵 정리)는 마인드맵 뷰 상단 버튼으로 이동(#60).
 */

import { useState } from 'react';
import { Mic, ScanText, FileText, Presentation, ImagePlus, Wand2, SpellCheck, Languages, ChevronDown } from 'lucide-react';
import { LucideIcon } from 'lucide-react';
import { AIMode } from '../../types/ai';

interface ModeSelectorProps {
    mode: AIMode;
    onChange: (m: AIMode) => void;
}

const MODES: { value: AIMode; label: string; Icon: LucideIcon }[] = [
    { value: 'improve', label: '문서 개선', Icon: Wand2 },
    { value: 'grammar', label: '문법 교정', Icon: SpellCheck },
    { value: 'translate', label: '번역', Icon: Languages },
    { value: 'image-gen', label: '이미지 생성', Icon: ImagePlus },
    { value: 'stt', label: '음성 → 텍스트 변환', Icon: Mic },
    { value: 'ocr', label: '이미지 → 텍스트 변환', Icon: ScanText },
    { value: 'meeting-notes', label: '녹취록 → 회의록 변환', Icon: FileText },
    { value: 'pptx', label: '슬라이드 만들기', Icon: Presentation },
];

export function ModeSelector({ mode, onChange }: ModeSelectorProps) {
    // 모드 목록 접기/펼치기 — 모드 선택 시 접고, 현재 모드 클릭 시 펼친다(공간 절약).
    const [collapsed, setCollapsed] = useState(false);
    const current = MODES.find((m) => m.value === mode) ?? MODES[0];
    const CurrentIcon = current.Icon;

    if (collapsed) {
        return (
            <div className="ai-modes ai-modes-collapsed">
                <button
                    type="button"
                    className="ai-mode-radio active ai-mode-current"
                    onClick={() => setCollapsed(false)}
                    title="모드 목록 펼치기"
                >
                    <CurrentIcon size={13} /> {current.label}
                    <ChevronDown size={14} className="ai-modes-caret" />
                </button>
            </div>
        );
    }

    return (
        <div className="ai-modes">
            {MODES.map(({ value, label, Icon }) => (
                <label key={value} className={`ai-mode-radio${mode === value ? ' active' : ''}`}>
                    <input
                        type="radio"
                        name="ai-mode"
                        checked={mode === value}
                        onChange={() => {
                            onChange(value);
                            setCollapsed(true); // 선택하면 목록 접기
                        }}
                    />
                    <Icon size={13} /> {label}
                </label>
            ))}
        </div>
    );
}
