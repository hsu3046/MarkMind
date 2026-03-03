import { useMemo } from 'react';

interface OutlineItem {
    level: number;
    text: string;
    id: string;
}

interface OutlinePanelProps {
    content: string;
    visible: boolean;
}

export function OutlinePanel({ content, visible }: OutlinePanelProps) {
    const headings = useMemo<OutlineItem[]>(() => {
        if (!content) return [];
        const lines = content.split('\n');
        const items: OutlineItem[] = [];

        for (const line of lines) {
            const match = line.match(/^(#{1,3})\s+(.+)/);
            if (match) {
                const level = match[1].length;
                const text = match[2].replace(/[*_`#]/g, '').trim();
                const id = text
                    .toLowerCase()
                    .replace(/[^\w\s가-힣ぁ-んァ-ヶ一-龠-]/g, '')
                    .replace(/\s+/g, '-');
                items.push({ level, text, id });
            }
        }
        return items;
    }, [content]);

    if (!visible) return null;

    const scrollToHeading = (id: string) => {
        const previewEl = document.querySelector('.preview-wrapper');
        if (!previewEl) return;

        // Find heading by text content match
        const headings = previewEl.querySelectorAll('h1, h2, h3');
        for (const h of headings) {
            const hId = (h.textContent || '')
                .toLowerCase()
                .replace(/[^\w\s가-힣ぁ-んァ-ヶ一-龠-]/g, '')
                .replace(/\s+/g, '-');
            if (hId === id) {
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
                            onClick={() => scrollToHeading(item.id)}
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
