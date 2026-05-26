/**
 * 배경색 picker — toolbar 의 Palette 버튼 클릭 시 작은 popover.
 * preset swatches + native color input + 기본(테마) 리셋.
 */

import { useEffect, useState } from 'react';
import { Palette, Check, X } from 'lucide-react';

interface BackgroundPickerProps {
    value: string; // '' = 테마 기본, 그 외 CSS color
    onChange: (color: string) => void;
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

export function BackgroundPicker({ value, onChange }: BackgroundPickerProps) {
    const [open, setOpen] = useState(false);

    // Esc 닫기 (외부 탭 닫기는 invisible backdrop div 가 처리 — iOS Safari 호환)
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open]);

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
                    <div
                        className="bg-picker-backdrop"
                        onClick={() => setOpen(false)}
                        aria-hidden
                    />
                <div className="bg-picker-popover">
                    <div className="bg-picker-presets">
                        {PRESETS.map((p) => {
                            const active = p.color === value;
                            return (
                                <button
                                    key={p.label}
                                    className={`bg-picker-swatch${active ? ' active' : ''}${
                                        p.color === '' ? ' no-color' : ''
                                    }`}
                                    // p.color 가 있을 때만 inline style — '' 면 CSS class 가 background 담당
                                    style={p.color ? { background: p.color } : undefined}
                                    onClick={() => {
                                        onChange(p.color);
                                        setOpen(false);
                                    }}
                                    title={p.label}
                                >
                                    {p.color === '' && <X size={12} />}
                                    {active && p.color !== '' && <Check size={12} color="#000" />}
                                </button>
                            );
                        })}
                    </div>
                    <label className="bg-picker-custom">
                        <span>사용자 정의</span>
                        <input
                            type="color"
                            value={value || '#ffffff'}
                            onChange={(e) => onChange(e.target.value)}
                        />
                    </label>
                </div>
                </>
            )}
        </div>
    );
}
