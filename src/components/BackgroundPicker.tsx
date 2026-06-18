/**
 * 배경색 picker.
 *  - inline (뷰어 설정 탭): 스와치를 바로 표시 — 버튼/팝오버 없음.
 *  - 기본(팝오버): Palette 버튼 클릭 시 popover (현재 메뉴바에선 미사용, 호환 유지).
 * preset swatches + native color input + 기본(테마) 리셋.
 */

import { useEffect, useState } from 'react';
import { Palette, Check, X } from 'lucide-react';

interface BackgroundPickerProps {
    value: string; // '' = 테마 기본, 그 외 CSS color
    onChange: (color: string) => void;
    /** true 면 팝오버 없이 스와치를 바로 인라인 표시 (뷰어 설정 탭). */
    inline?: boolean;
}

// 일반적인 reading 배경 preset (sepia, paper, soft tints)
const PRESETS: { label: string; color: string }[] = [
    { label: '기본', color: '' },
    { label: '종이', color: '#f4ecd8' },
    { label: '회색', color: '#f5f5f5' },
    { label: '연두', color: '#eef5ec' },
    { label: '하늘', color: '#eaf2f8' },
    { label: '연분홍', color: '#fbeef0' },
    { label: '다크', color: '#1f2128' },
    { label: '진청', color: '#1a2332' },
];

/** preset 스와치 + 사용자 정의 색상 input (공통 — inline/popover 모두 사용). */
function Swatches({ value, onChange }: { value: string; onChange: (color: string) => void }) {
    const customActive = value !== '' && !PRESETS.some((p) => p.color === value);
    return (
        <div className="bg-picker-presets">
            {PRESETS.map((p) => {
                const active = p.color === value;
                return (
                    <button
                        key={p.label}
                        type="button"
                        className={`bg-picker-swatch${active ? ' active' : ''}${p.color === '' ? ' no-color' : ''}`}
                        // p.color 가 있을 때만 inline style — '' 면 CSS class 가 background 담당
                        style={p.color ? { background: p.color } : undefined}
                        onClick={() => onChange(p.color)}
                        title={p.label}
                    >
                        {p.color === '' && <X size={12} />}
                        {active && p.color !== '' && <Check size={12} color="#000" />}
                    </button>
                );
            })}
            {/* 사용자 정의 색상 — 색상환 input 을 스와치 형태로 */}
            <label
                className={`bg-picker-swatch bg-picker-custom-swatch${customActive ? ' active' : ''}`}
                title="사용자 정의 색상"
            >
                <Palette size={13} strokeWidth={1.5} />
                <input
                    type="color"
                    value={value || '#ffffff'}
                    onChange={(e) => onChange(e.target.value)}
                />
            </label>
        </div>
    );
}

export function BackgroundPicker({ value, onChange, inline }: BackgroundPickerProps) {
    const [open, setOpen] = useState(false);

    // Esc 닫기 (팝오버 모드 — inline 은 불필요하지만 hook 순서 보장 위해 항상 등록)
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open]);

    // 인라인: 스와치를 바로 표시 (버튼/팝오버 없음)
    if (inline) {
        return (
            <div className="bg-picker-inline">
                <Swatches value={value} onChange={onChange} />
            </div>
        );
    }

    // 팝오버: Palette 버튼 클릭 → 스와치 popover
    return (
        <div className="bg-picker-root">
            <button
                className={`toolbar-btn${open ? ' active' : ''}`}
                onClick={() => setOpen((v) => !v)}
                title="배경색 설정"
            >
                <Palette size={15} strokeWidth={1.5} />
            </button>
            {open && (
                <>
                    {/* iOS Safari 호환 — document mousedown 대신 invisible backdrop div */}
                    <div className="bg-picker-backdrop" onClick={() => setOpen(false)} aria-hidden />
                    <div className="bg-picker-popover">
                        <Swatches
                            value={value}
                            onChange={(c) => {
                                onChange(c);
                                setOpen(false);
                            }}
                        />
                    </div>
                </>
            )}
        </div>
    );
}
