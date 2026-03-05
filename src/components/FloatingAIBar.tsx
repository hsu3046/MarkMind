import { useEffect, useRef, useState } from 'react';
import { AIMode } from '../types/ai';
import { SpellCheck, Languages, Wand2 } from 'lucide-react';
import './FloatingAIBar.css';

interface FloatingAIBarProps {
    selectedText: string;
    coords: { top: number; left: number } | null;
    onAction: (mode: AIMode, text: string) => void;
}

export function FloatingAIBar({ selectedText, coords, onAction }: FloatingAIBarProps) {
    const barRef = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        // Show bar only when there's a meaningful selection
        if (selectedText.length > 2 && coords) {
            const timer = setTimeout(() => setVisible(true), 300);
            return () => clearTimeout(timer);
        } else {
            setVisible(false);
        }
    }, [selectedText, coords]);

    if (!visible || !coords) return null;

    // Position the bar above the selection
    const style: React.CSSProperties = {
        top: coords.top - 44,
        left: coords.left,
    };

    return (
        <div
            ref={barRef}
            className="floating-ai-bar"
            style={style}
            onMouseDown={(e) => e.preventDefault()} // prevent losing selection
        >
            <button
                className="fab-btn"
                title="문법 교정"
                onClick={() => onAction('grammar', selectedText)}
            >
                <SpellCheck size={13} />
                <span>교정</span>
            </button>
            <button
                className="fab-btn"
                title="번역"
                onClick={() => onAction('translate', selectedText)}
            >
                <Languages size={13} />
                <span>번역</span>
            </button>
            <button
                className="fab-btn"
                title="문서 개선"
                onClick={() => onAction('improve', selectedText)}
            >
                <Wand2 size={13} />
                <span>개선</span>
            </button>
        </div>
    );
}
