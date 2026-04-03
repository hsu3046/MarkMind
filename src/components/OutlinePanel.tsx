import { useMemo } from 'react';

interface OutlineItem {
    level: number;
    text: string;
    id: string;
    /** 1-indexed line number in the source markdown */
    line: number;
}

interface OutlinePanelProps {
    content: string;
    visible: boolean;
    /**
     * Called when a heading is clicked.
     * Provides both the heading id (for preview DOM scroll) and the
     * 1-indexed source line number (for editor scroll).
     */
    onHeadingClick?: (id: string, line: number) => void;
}

export function OutlinePanel({ content, visible, onHeadingClick }: OutlinePanelProps) {
    const headings = useMemo<OutlineItem[]>(() => {
        if (!content) return [];
        const lines = content.split('\n');
        const items: OutlineItem[] = [];

        lines.forEach((line, index) => {
            const match = line.match(/^(#{1,3})\s+(.+)/);
            if (match) {
                const level = match[1].length;
                const text = match[2].replace(/[*_`#]/g, '').trim();
                const id = text
                    .toLowerCase()
                    .replace(/[^\w\s가-힣ぁ-んァ-ヶ一-龠-]/g, '')
                    .replace(/\s+/g, '-');
                items.push({ level, text, id, line: index + 1 });
            }
        });
        return items;
    }, [content]);

    if (!visible) return null;

    const handleClick = (item: OutlineItem) => {
        if (onHeadingClick) {
            // Delegate to parent — parent decides scroll target based on view mode
            onHeadingClick(item.id, item.line);
            return;
        }

        // Fallback: scroll preview DOM directly (legacy behavior)
        const previewEl = document.querySelector('.preview-wrapper');
        if (!previewEl) return;
        const headingEls = previewEl.querySelectorAll('h1, h2, h3');
        for (const h of headingEls) {
            const hId = (h.textContent || '')
                .toLowerCase()
                .replace(/[^\w\s가-힣ぁ-んァ-ヶ一-龠-]/g, '')
                .replace(/\s+/g, '-');
            if (hId === item.id) {
                h.scrollIntoView({ behavior: 'smooth', block: 'start' });
                break;
            }
        }
    };

    return (
        <div className="outline-panel">
            <div className="outline-header">Outline</div>
            <div className="outline-list">
                {headings.length === 0 ? (
                    <div className="outline-empty">No headings found</div>
                ) : (
                    headings.map((item, i) => (
                        <button
                            key={`${item.id}-${i}`}
                            className={`outline-item outline-level-${item.level}`}
                            onClick={() => handleClick(item)}
                            title={item.text}
                        >
                            {item.text}
                        </button>
                    ))
                )}
            </div>
        </div>
    );
}
