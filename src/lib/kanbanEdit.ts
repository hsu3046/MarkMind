/**
 * Safe Kanban edits against Markdown SSOT.
 *
 * Kanban cards are derived from a single source line (`mdLine`). These helpers
 * patch only that line's card label and inline markers, avoiding structural
 * Markdown moves that could break nested lists, headings, or descriptions.
 */

import type { KanbanPriority, KanbanStatus } from '../types/kanban';

export interface KanbanCardPatch {
    label?: string;
    status?: KanbanStatus;
    priority?: KanbanPriority | null;
    start?: string | null;
    due?: string | null;
    progress?: number | null;
    order?: number | null;
}

const LIST_PREFIX_RE = /^(\s*(?:[-*+]|\d+[.)])\s+)(.*)$/;
const HEADING_PREFIX_RE = /^(\s*#{1,6}\s+)(.*)$/;
const CHECKBOX_RE = /^(\[[ xX]\]\s*)(.*)$/;
const MARKER_RE = /@([A-Za-z]\w*)\([^)]*\)/g;
const KNOWN_MARKERS = new Set(['status', 'priority', 'start', 'due', 'end', 'progress', 'order']);
const DATE_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;

interface ParsedLine {
    prefix: string;
    checkbox: string | null;
    label: string;
    preservedMarkers: Array<{ name: string; marker: string }>;
    status: KanbanStatus | null;
    priority: KanbanPriority | null;
    start: string | null;
    due: string | null;
    progress: number | null;
    order: number | null;
}

function splitLine(line: string): { prefix: string; body: string } {
    const list = line.match(LIST_PREFIX_RE);
    if (list) return { prefix: list[1], body: list[2] };
    const heading = line.match(HEADING_PREFIX_RE);
    if (heading) return { prefix: heading[1], body: heading[2] };
    return { prefix: '', body: line };
}

function cleanMarkerText(text: string): string {
    return text
        .replace(CHECKBOX_RE, '$2')
        .replace(MARKER_RE, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeDate(value: string | null | undefined): string | null {
    if (value === null || value === undefined || value.trim() === '') return null;
    const m = DATE_RE.exec(value.trim());
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const date = new Date(y, mo - 1, d);
    if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
    const p = (n: number) => String(n).padStart(2, '0');
    return `${y}-${p(mo)}-${p(d)}`;
}

function normalizeProgress(value: number | null | undefined): number | null {
    if (value === null || value === undefined || !Number.isFinite(value)) return null;
    return Math.min(100, Math.max(0, Math.round(value)));
}

function normalizeOrder(value: number | null | undefined): number | null {
    if (value === null || value === undefined || !Number.isFinite(value)) return null;
    return Math.max(0, Math.round(value));
}

function parseLine(line: string): ParsedLine {
    const { prefix, body } = splitLine(line);
    const box = body.match(CHECKBOX_RE);
    const content = box ? box[2] : body;

    let status: KanbanStatus | null = null;
    let priority: KanbanPriority | null = null;
    let start: string | null = null;
    let due: string | null = null;
    let progress: number | null = null;
    let order: number | null = null;
    const preservedMarkers: Array<{ name: string; marker: string }> = [];

    for (const match of content.matchAll(MARKER_RE)) {
        const marker = match[0];
        const name = match[1].toLowerCase();
        const value = marker.slice(marker.indexOf('(') + 1, -1).trim();
        if (!KNOWN_MARKERS.has(name)) {
            preservedMarkers.push({ name, marker });
            continue;
        }
        if (name === 'status') {
            if (isKanbanStatus(value)) status = value;
            else preservedMarkers.push({ name, marker });
        } else if (name === 'priority') {
            if (isKanbanPriority(value)) priority = value;
            else preservedMarkers.push({ name, marker });
        } else if (name === 'start') {
            start = normalizeDate(value);
            if (!start) preservedMarkers.push({ name, marker });
        } else if (name === 'due' || name === 'end') {
            due = normalizeDate(value);
            if (!due) preservedMarkers.push({ name, marker });
        } else if (name === 'progress') {
            progress = normalizeProgress(Number(value));
            if (progress === null) preservedMarkers.push({ name, marker });
        } else if (name === 'order') {
            order = normalizeOrder(Number(value));
            if (order === null) preservedMarkers.push({ name, marker });
        }
    }

    return {
        prefix,
        checkbox: box ? box[1] : null,
        label: cleanMarkerText(body),
        preservedMarkers,
        status,
        priority,
        start,
        due,
        progress,
        order,
    };
}

function isKanbanStatus(value: string): value is KanbanStatus {
    return value === 'todo' || value === 'doing' || value === 'review' || value === 'blocked' || value === 'done';
}

function isKanbanPriority(value: string): value is KanbanPriority {
    return value === 'low' || value === 'medium' || value === 'high' || value === 'urgent';
}

function buildLine(parsed: ParsedLine, patch: KanbanCardPatch): string {
    const label = patch.label !== undefined ? patch.label.replace(/\s+/g, ' ').trim() : parsed.label;
    const status = patch.status !== undefined ? patch.status : parsed.status;
    const priority = patch.priority !== undefined ? patch.priority : parsed.priority;
    const start = patch.start !== undefined ? normalizeDate(patch.start) : parsed.start;
    let due = patch.due !== undefined ? normalizeDate(patch.due) : parsed.due;
    let progress = patch.progress !== undefined ? normalizeProgress(patch.progress) : parsed.progress;
    const order = patch.order !== undefined ? normalizeOrder(patch.order) : parsed.order;
    if (start && due && due < start) due = null;
    if (patch.status !== undefined && patch.status !== 'done' && patch.progress === undefined && progress === 100) {
        progress = null;
    }

    const markers: string[] = [];
    if (status) markers.push(`@status(${status})`);
    if (priority) markers.push(`@priority(${priority})`);
    if (start) markers.push(`@start(${start})`);
    if (due) markers.push(`@due(${due})`);
    if (progress !== null && progress > 0 && status !== 'done') markers.push(`@progress(${progress})`);
    if (order !== null) markers.push(`@order(${order})`);
    const replaced = new Set<string>();
    if (patch.status !== undefined) replaced.add('status');
    if (patch.priority !== undefined) replaced.add('priority');
    if (patch.start !== undefined) replaced.add('start');
    if (patch.due !== undefined) {
        replaced.add('due');
        replaced.add('end');
    }
    if (patch.progress !== undefined) replaced.add('progress');
    if (patch.order !== undefined) replaced.add('order');
    markers.push(...parsed.preservedMarkers.filter((m) => !replaced.has(m.name)).map((m) => m.marker));

    const wasChecked = parsed.checkbox?.trim().toLowerCase() === '[x]';
    const shouldCheck = patch.status !== undefined ? status === 'done' : status === 'done' || wasChecked;
    const checkbox = parsed.checkbox !== null || patch.status !== undefined
        ? `${shouldCheck ? '[x]' : '[ ]'} `
        : '';
    const suffix = markers.length ? ` ${markers.join(' ')}` : '';
    return `${parsed.prefix}${checkbox}${label || '(제목 없음)'}${suffix}`;
}

/** Patch a single 1-based Markdown source line. Returns the original markdown if line is invalid. */
export function updateKanbanCardLine(markdown: string, mdLine: number, patch: KanbanCardPatch): string {
    if (!Number.isInteger(mdLine) || mdLine < 1) return markdown;
    const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
    const idx = mdLine - 1;
    if (idx < 0 || idx >= lines.length) return markdown;
    const parsed = parseLine(lines[idx]);
    lines[idx] = buildLine(parsed, patch);
    return lines.join('\n');
}
