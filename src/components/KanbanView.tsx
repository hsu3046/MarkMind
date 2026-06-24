/**
 * Kanban view mode (#93) — read-only, Gantt-compatible board.
 *
 * Markdown is the SSOT: parseKanban() derives cards from checkbox/status/Gantt
 * markers, and clicking a card jumps back to the source line for editing.
 */

import { useMemo } from 'react';
import { CalendarDays, Kanban, ListChecks } from 'lucide-react';
import { parseKanban } from '../lib/kanban-parser';
import { KANBAN_COLUMNS, type KanbanCard, type KanbanPriority } from '../types/kanban';
import { KanbanPanel } from './KanbanPanel';
import './KanbanView.css';

interface KanbanViewProps {
    content: string;
    fileName: string;
    onJumpToSource: (line: number) => void;
    /** 마크다운 SSOT 쓰기 — AI 자동 생성 결과 반영(없으면 read-only). */
    onChange?: (md: string) => void;
    /** 모달(KanbanPanel) 열림 — 메인 툴바 "자동 생성" 클릭을 App 이 토글. */
    kanbanPanelOpen?: boolean;
    onCloseKanbanPanel?: () => void;
}

export function KanbanView({ content, fileName, onJumpToSource, onChange, kanbanPanelOpen, onCloseKanbanPanel }: KanbanViewProps) {
    const data = useMemo(() => parseKanban(content, fileName), [content, fileName]);
    const byStatus = useMemo(() => {
        const grouped = Object.fromEntries(KANBAN_COLUMNS.map((col) => [col.id, [] as KanbanCard[]]));
        for (const card of data.cards) grouped[card.status].push(card);
        return grouped;
    }, [data.cards]);

    const panel = kanbanPanelOpen && onChange ? (
        <KanbanPanel
            content={content}
            onApply={(md, applyMode) => {
                const next = applyMode === 'replace'
                    ? md
                    : (content.trim() ? `${content.replace(/\s+$/, '')}\n\n${md}` : md);
                onChange(next);
            }}
            onClose={() => onCloseKanbanPanel?.()}
        />
    ) : null;

    if (data.cards.length === 0) {
        return (
            <div className="kanban-view">
                <div className="kanban-empty">
                    <Kanban size={48} strokeWidth={1.25} />
                    <p className="kanban-empty-title">표시할 카드가 없습니다</p>
                    <p className="kanban-empty-hint">체크박스나 상태 마커가 있는 항목을 카드로 표시합니다</p>
                    <pre className="kanban-empty-example"><code>{`## 개발
- [ ] 구현 @status(doing) @start(2026-07-01) @due(2026-07-10) @progress(40)
- [ ] 리뷰 @status(review)
- [x] 릴리스 @start(2026-07-15)`}</code></pre>
                    <p className="kanban-empty-markers">
                        <code>@status</code> 상태 · <code>@start</code>/<code>@due</code> 일정 · <code>@progress</code> 진행률
                    </p>
                </div>
                {panel}
            </div>
        );
    }

    return (
        <div className="kanban-view">
            <div className="kanban-board" role="list" aria-label="칸반 보드">
                {KANBAN_COLUMNS.map((col) => {
                    const cards = byStatus[col.id];
                    return (
                        <section key={col.id} className={`kanban-column kanban-column--${col.id}`} aria-label={col.label}>
                            <div className="kanban-column-header">
                                <span className="kanban-column-title">
                                    <span className="kanban-status-dot" aria-hidden="true" />
                                    <span>{col.label}</span>
                                </span>
                                <span className="kanban-count">{cards.length}</span>
                            </div>
                            <div className="kanban-card-list">
                                {cards.length === 0 ? (
                                    <div className="kanban-column-empty">없음</div>
                                ) : (
                                    cards.map((card) => (
                                        <KanbanCardView
                                            key={card.id}
                                            card={card}
                                            onJumpToSource={onJumpToSource}
                                        />
                                    ))
                                )}
                            </div>
                        </section>
                    );
                })}
            </div>
            {panel}
        </div>
    );
}

function KanbanCardView({ card, onJumpToSource }: {
    card: KanbanCard;
    onJumpToSource: (line: number) => void;
}) {
    const clickable = typeof card.mdLine === 'number';
    const title = [
        card.label,
        card.section ? `섹션: ${card.section}` : '',
        card.start ? `시작: ${ymd(card.start)}` : '',
        card.due ? `마감: ${ymd(card.due)}` : '',
        card.progress !== null ? `진행률: ${card.progress}%` : '',
    ].filter(Boolean).join('\n');

    return (
        <button
            type="button"
            className={`kanban-card kanban-card--${card.status}`}
            onClick={() => clickable && onJumpToSource(card.mdLine!)}
            disabled={!clickable}
            title={title}
        >
            <div className="kanban-card-topline">
                {card.section && <span className="kanban-card-section">{card.section}</span>}
                {card.priority && <span className={`kanban-priority kanban-priority--${card.priority}`}>{priorityLabel(card.priority)}</span>}
            </div>
            <span className="kanban-card-title">{card.label}</span>
            {(card.start || card.due || card.progress !== null) && (
                <div className="kanban-card-meta">
                    {(card.start || card.due) && (
                        <span className="kanban-meta-chip">
                            <CalendarDays size={12} strokeWidth={1.7} />
                            <span>{dateRangeLabel(card.start, card.due)}</span>
                        </span>
                    )}
                    {card.progress !== null && (
                        <span className="kanban-meta-chip">
                            <ListChecks size={12} strokeWidth={1.7} />
                            <span>{card.progress}%</span>
                        </span>
                    )}
                </div>
            )}
        </button>
    );
}

function priorityLabel(priority: KanbanPriority): string {
    switch (priority) {
        case 'urgent': return 'P0';
        case 'high': return 'P1';
        case 'medium': return 'P2';
        case 'low': return 'P3';
    }
}

function dateRangeLabel(start: Date | null, due: Date | null): string {
    if (start && due) return `${shortDate(start)}-${shortDate(due)}`;
    if (due) return `마감 ${shortDate(due)}`;
    if (start) return `시작 ${shortDate(start)}`;
    return '';
}

function shortDate(d: Date): string {
    return `${d.getMonth() + 1}/${d.getDate()}`;
}

function ymd(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
