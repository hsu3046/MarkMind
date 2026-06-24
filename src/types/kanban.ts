/**
 * Kanban data model (#93).
 *
 * Markdown stays the single source of truth. The parser derives cards from
 * checkbox/list/heading nodes that carry Kanban or Gantt-compatible inline
 * markers:
 *
 *     - [ ] 구현 @status(doing) @start(2026-07-01) @due(2026-07-10) @progress(40)
 *     - [x] 릴리스 @start(2026-07-15)
 *
 * `@status(...)` wins. Without it, checkbox/progress markers infer a sensible
 * default so one task can appear in both Gantt and Kanban views.
 */

export type KanbanStatus = 'todo' | 'doing' | 'review' | 'blocked' | 'done';

export type KanbanPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface KanbanColumn {
    id: KanbanStatus;
    label: string;
}

export const KANBAN_COLUMNS: KanbanColumn[] = [
    { id: 'todo', label: 'Todo' },
    { id: 'doing', label: 'Doing' },
    { id: 'review', label: 'Review' },
    { id: 'blocked', label: 'Blocked' },
    { id: 'done', label: 'Done' },
];

export interface KanbanCard {
    /** Stable id derived from the source tree node id. */
    id: string;
    /** Card title with checkbox and `@marker(...)` tokens stripped. */
    label: string;
    /** Normalized board column. */
    status: KanbanStatus;
    /** Original status token, when explicit and different from the normalized id. */
    rawStatus?: string;
    /** Group/section label (nearest ancestor heading or list parent). '' when top-level. */
    section: string;
    /** Optional Gantt-compatible start date. */
    start: Date | null;
    /** Optional Gantt-compatible due/end date. */
    due: Date | null;
    /** Optional completion 0-100. */
    progress: number | null;
    /** Optional priority from `@priority(...)`. */
    priority: KanbanPriority | null;
    /** Optional persisted sort key for Kanban-only drag ordering. */
    order: number | null;
    /** 1-based source line in the full document. */
    mdLine?: number;
    /** Palette colour for this card's section. */
    color: string;
}

export interface KanbanData {
    cards: KanbanCard[];
    counts: Record<KanbanStatus, number>;
}
