/**
 * Kanban generation serializer (#93 follow-up).
 *
 * The LLM returns JSON only; this module deterministically serializes it into
 * the inline-marker markdown parseKanban() already understands:
 * `@status`, `@priority`, and optional Gantt-compatible `@start/@due/@progress`.
 */

import type { KanbanPriority, KanbanStatus } from '../types/kanban';

export interface GeneratedKanbanCard {
    /** Card label (markers/checkbox stripped before output). */
    name: string;
    /** Column. Unknown/missing values fall back to todo. */
    status?: KanbanStatus | string;
    /** Section/group heading. Empty/absent => top-level (no heading). */
    section?: string;
    /** Priority. Unknown values are omitted. */
    priority?: KanbanPriority | string;
    /** Optional Gantt-compatible start date, YYYY-MM-DD. */
    start?: string;
    /** Optional Gantt-compatible due/end date, YYYY-MM-DD. */
    due?: string;
    /** Optional completion 0-100. */
    progress?: number;
}

export interface GeneratedKanban {
    title?: string;
    cards: GeneratedKanbanCard[];
}

const DATE_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;

const STATUS_ALIASES: Record<string, KanbanStatus> = {
    backlog: 'todo',
    open: 'todo',
    ready: 'todo',
    task: 'todo',
    todo: 'todo',
    'to-do': 'todo',
    'to_do': 'todo',
    대기: 'todo',
    예정: 'todo',
    할일: 'todo',

    active: 'doing',
    doing: 'doing',
    inprogress: 'doing',
    'in-progress': 'doing',
    progress: 'doing',
    started: 'doing',
    wip: 'doing',
    작업중: 'doing',
    진행: 'doing',
    진행중: 'doing',

    check: 'review',
    qa: 'review',
    review: 'review',
    reviewing: 'review',
    검토: 'review',
    리뷰: 'review',

    block: 'blocked',
    blocked: 'blocked',
    hold: 'blocked',
    paused: 'blocked',
    waiting: 'blocked',
    대기중: 'blocked',
    보류: 'blocked',
    차단: 'blocked',

    closed: 'done',
    complete: 'done',
    completed: 'done',
    done: 'done',
    finish: 'done',
    finished: 'done',
    shipped: 'done',
    완료: 'done',
};

const PRIORITY_ALIASES: Record<string, KanbanPriority> = {
    p0: 'urgent',
    urgent: 'urgent',
    critical: 'urgent',
    긴급: 'urgent',

    p1: 'high',
    high: 'high',
    높음: 'high',

    p2: 'medium',
    medium: 'medium',
    normal: 'medium',
    보통: 'medium',

    p3: 'low',
    low: 'low',
    낮음: 'low',
};

const STATUS_SECTION_TOKENS = new Set([
    'todo',
    'to-do',
    'to_do',
    'backlog',
    'ready',
    'open',
    '할일',
    '할-일',
    '해야할일',
    '해야-할-일',
    '백로그',
    '대기',
    '예정',
    'doing',
    'in-progress',
    'inprogress',
    'wip',
    'active',
    'started',
    '진행',
    '진행중',
    '진행-중',
    '작업중',
    '작업-중',
    'review',
    'reviewing',
    '검토',
    '검토중',
    '검토-중',
    '리뷰',
    'blocked',
    'block',
    'hold',
    'waiting',
    '보류',
    '차단',
    '막힘',
    'done',
    'complete',
    'completed',
    'closed',
    'finished',
    '완료',
]);

function cleanToken(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, '-');
}

function normalizeStatus(raw: unknown): KanbanStatus {
    return STATUS_ALIASES[cleanToken(String(raw ?? ''))] ?? 'todo';
}

function normalizePriority(raw: unknown): KanbanPriority | null {
    return PRIORITY_ALIASES[cleanToken(String(raw ?? ''))] ?? null;
}

/** Validate a YYYY-MM-DD string and return it zero-padded, or null if invalid. */
function normalizeDate(s: unknown): string | null {
    const m = DATE_RE.exec(String(s ?? '').trim());
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const date = new Date(y, mo - 1, d);
    if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
    const p = (n: number) => String(n).padStart(2, '0');
    return `${y}-${p(mo)}-${p(d)}`;
}

function cleanInlineText(text: unknown): string {
    return String(text ?? '')
        .replace(/@\w+\([^)]*\)/g, '')
        .replace(/^\s*[-*]\s*/, '')
        .replace(/^\[[ xX]\]\s*/, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function cleanSection(text: unknown): string {
    return cleanInlineText(text).replace(/^#+\s*/, '').trim();
}

function normalizeGeneratedSection(text: unknown): string {
    const section = cleanSection(text);
    if (!section) return '';
    return STATUS_SECTION_TOKENS.has(cleanToken(section)) ? '' : section;
}

function normalizeProgress(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * Serialize generated Kanban cards to inline-marker markdown.
 * Sections become `## heading`; each card becomes a checklist item. Done cards
 * use `[x]` so the same line renders as complete in Gantt even without progress.
 */
export function kanbanToMarkdown(board: GeneratedKanban): string {
    const title = cleanInlineText(board.title) || '칸반 보드';
    const order: string[] = [];
    const bySection = new Map<string, string[]>();

    for (const card of board.cards ?? []) {
        const name = cleanInlineText(card.name);
        if (!name) continue;

        const status = normalizeStatus(card.status);
        const priority = normalizePriority(card.priority);
        const start = normalizeDate(card.start);
        let due = normalizeDate(card.due);
        if (start && due && due < start) due = null;
        const progress = normalizeProgress(card.progress);

        const markers = [`@status(${status})`];
        if (priority) markers.push(`@priority(${priority})`);
        if (start) markers.push(`@start(${start})`);
        if (due) markers.push(`@due(${due})`);
        if (progress !== null && progress > 0 && status !== 'done') markers.push(`@progress(${progress})`);

        const checkbox = status === 'done' ? '[x]' : '[ ]';
        const line = `- ${checkbox} ${name} ${markers.join(' ')}`;
        const section = normalizeGeneratedSection(card.section);
        if (!bySection.has(section)) {
            bySection.set(section, []);
            order.push(section);
        }
        bySection.get(section)!.push(line);
    }

    const out: string[] = [`# ${title}`];
    for (const section of order) {
        out.push('');
        if (section) out.push(`## ${section}`);
        out.push(...bySection.get(section)!);
    }
    return out.join('\n') + '\n';
}
