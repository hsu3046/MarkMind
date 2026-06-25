/**
 * Kanban parser (#93) — deterministic, Gantt-compatible.
 *
 * This mirrors the Gantt parser shape: reuse documentToTree() for hierarchy and
 * source lines, then pull inline markers from each node label. Kanban accepts
 * its own `@status(...)` marker and also understands Gantt markers so one
 * markdown task can power both views.
 */

import { documentToTree } from './markdownTree';
import { PALETTE } from './d3-layout';
import type { MindmapNode } from '../types/mindmap';
import type { KanbanCard, KanbanData, KanbanPriority, KanbanStatus } from '../types/kanban';

const STATUS_RE = /@status\(\s*([^)]+?)\s*\)/i;
const START_RE = /@start\(\s*(\d{4})-(\d{1,2})-(\d{1,2})\s*\)/i;
const DUE_RE = /@(?:due|end)\(\s*(\d{4})-(\d{1,2})-(\d{1,2})\s*\)/i;
const PROGRESS_RE = /@progress\(\s*(\d{1,3})\s*\)/i;
const PRIORITY_RE = /@priority\(\s*([^)]+?)\s*\)/i;
const ORDER_RE = /@order\(\s*(\d+)\s*\)/i;
const CHECKBOX_RE = /^\[([ xX])\]\s*/;
const MARKER_RE = /@\w+\([^)]*\)/g;

export const STATUS_ALIASES: Record<string, KanbanStatus> = {
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
    '작업-중': 'doing',
    진행: 'doing',
    진행중: 'doing',
    '진행-중': 'doing',

    check: 'review',
    qa: 'review',
    review: 'review',
    reviewing: 'review',
    검토: 'review',
    검토중: 'review',
    '검토-중': 'review',
    리뷰: 'review',
    리뷰중: 'review',
    '리뷰-중': 'review',

    block: 'blocked',
    blocked: 'blocked',
    hold: 'blocked',
    paused: 'blocked',
    waiting: 'blocked',
    대기중: 'blocked',
    '대기-중': 'blocked',
    보류: 'blocked',
    '보류-중': 'blocked',
    차단: 'blocked',

    closed: 'done',
    complete: 'done',
    completed: 'done',
    done: 'done',
    finish: 'done',
    finished: 'done',
    shipped: 'done',
    완료: 'done',
    완료됨: 'done',
    '완료-됨': 'done',
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

/** Parse `YYYY-MM-DD` at local midnight and reject impossible dates. */
function parseLocalDate(y: number, m: number, d: number): Date | null {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const date = new Date(y, m - 1, d);
    if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
    return date;
}

export function cleanToken(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, '-');
}

function normalizeStatus(raw: string): KanbanStatus {
    return STATUS_ALIASES[cleanToken(raw)] ?? 'todo';
}

function normalizePriority(raw: string): KanbanPriority | null {
    return PRIORITY_ALIASES[cleanToken(raw)] ?? null;
}

function parseDate(label: string, re: RegExp): Date | null {
    const match = label.match(re);
    if (!match) return null;
    return parseLocalDate(+match[1], +match[2], +match[3]);
}

function parseProgress(label: string): number | null {
    const match = label.match(PROGRESS_RE);
    if (!match) return null;
    return Math.min(100, Math.max(0, parseInt(match[1], 10)));
}

function cleanLabel(label: string): string {
    return label.replace(CHECKBOX_RE, '').replace(MARKER_RE, '').replace(/\s+/g, ' ').trim();
}

function isCandidate(label: string): boolean {
    return (
        STATUS_RE.test(label) ||
        CHECKBOX_RE.test(label) ||
        START_RE.test(label) ||
        DUE_RE.test(label) ||
        PROGRESS_RE.test(label)
    );
}

function inferStatus(label: string, progress: number | null): { status: KanbanStatus; rawStatus?: string } {
    const statusMatch = label.match(STATUS_RE);
    if (statusMatch) {
        const rawStatus = statusMatch[1].trim();
        return { status: normalizeStatus(rawStatus), rawStatus };
    }

    const box = label.match(CHECKBOX_RE);
    if (box?.[1].toLowerCase() === 'x') return { status: 'done' };
    if (progress !== null) {
        if (progress >= 100) return { status: 'done' };
        if (progress > 0) return { status: 'doing' };
    }
    return { status: 'todo' };
}

export function parseKanban(fullMd: string, fileName?: string): KanbanData {
    const stem = (fileName ?? '').replace(/\.(md|markdown|mdx|txt)$/i, '').trim() || undefined;
    const { tree } = documentToTree(fullMd, stem);

    const cards: KanbanCard[] = [];
    const sectionColor = new Map<string, string>();

    const colorFor = (section: string): string => {
        let c = sectionColor.get(section);
        if (c === undefined) {
            c = PALETTE[sectionColor.size % PALETTE.length];
            sectionColor.set(section, c);
        }
        return c;
    };

    const visit = (node: MindmapNode, section: string): void => {
        if (isCandidate(node.label)) {
            const label = cleanLabel(node.label);
            if (label) {
                const progress = parseProgress(node.label);
                const { status, rawStatus } = inferStatus(node.label, progress);
                const priorityMatch = node.label.match(PRIORITY_RE);
                const orderMatch = node.label.match(ORDER_RE);
                cards.push({
                    id: node.id,
                    label,
                    status,
                    rawStatus: rawStatus && normalizeStatus(rawStatus) !== rawStatus ? rawStatus : undefined,
                    section,
                    start: parseDate(node.label, START_RE),
                    due: parseDate(node.label, DUE_RE),
                    progress,
                    priority: priorityMatch ? normalizePriority(priorityMatch[1]) : null,
                    order: orderMatch ? Math.max(0, parseInt(orderMatch[1], 10)) : null,
                    mdLine: node.mdLine,
                    color: colorFor(section),
                });
            }
        }

        const childSection = cleanLabel(node.label) || section;
        for (const child of node.children) visit(child, childSection);
    };

    for (const child of tree.children) visit(child, '');

    const counts: KanbanData['counts'] = {
        todo: 0,
        doing: 0,
        review: 0,
        blocked: 0,
        done: 0,
    };
    for (const card of cards) counts[card.status]++;

    return { cards, counts };
}
