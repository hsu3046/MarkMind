/**
 * Safe Gantt drag edits against the Markdown SSOT (#54 — drag-edit follow-up).
 *
 * Gantt bars/milestones derive from the SAME inline markers as Kanban
 * (@start/@due/@progress) on a single source line (`mdLine`). To guarantee a
 * Gantt edit can never corrupt the Kanban markers on that line — and vice
 * versa — every edit goes through the SHARED line engine `updateKanbanCardLine`,
 * which re-parses the whole line and re-emits all known + preserved markers.
 * A drag only ever sends `{ start, due }`; `@status`/`@priority`/`@order` and
 * any unknown markers are read back from the line and kept verbatim.
 *
 * The day math here is PURE so the view can render a live preview and tests can
 * assert the round-trip (Gantt edit → parseKanban still intact, and back).
 */

import { updateKanbanCardLine, type KanbanCardPatch } from './kanbanEdit';
import type { GanttTask } from '../types/gantt';

/** What a pointer drag on a bar is doing. */
export type GanttDragMode = 'move' | 'resize-start' | 'resize-end';

/** Result of a drag in date space (local midnight), before serialization. */
export interface GanttDragResult {
    start: Date;
    end: Date;
    /** A drag can flip a bar↔milestone (drop the due, or grow one out of a point). */
    isMilestone: boolean;
}

function addDays(base: Date, n: number): Date {
    return new Date(base.getFullYear(), base.getMonth(), base.getDate() + n);
}

function ymd(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Compute the new start/end for dragging `task` by `dayDelta` whole days.
 * Pure + deterministic — the same call drives the live preview and the commit.
 *
 *  - move          → start and end shift together (duration preserved).
 *  - resize-start  → start moves; clamped to ≤ end (a milestone just moves).
 *  - resize-end    → end moves; if pulled before start the bar collapses to a
 *                    milestone (due dropped); growing a milestone's end makes a bar.
 */
export function previewGanttDrag(task: GanttTask, mode: GanttDragMode, dayDelta: number): GanttDragResult {
    if (mode === 'move') {
        return {
            start: addDays(task.start, dayDelta),
            end: addDays(task.end, dayDelta),
            isMilestone: task.isMilestone,
        };
    }

    if (mode === 'resize-start') {
        let start = addDays(task.start, dayDelta);
        // A milestone is a point: resizing its start is the same as moving it.
        if (task.isMilestone) return { start, end: start, isMilestone: true };
        // Never let the start cross past the end.
        if (start.getTime() > task.end.getTime()) start = task.end;
        return { start, end: task.end, isMilestone: false };
    }

    // resize-end
    const end = addDays(task.end, dayDelta);
    // Pulled before the start → collapse to a milestone (no due marker).
    if (end.getTime() < task.start.getTime()) {
        return { start: task.start, end: task.start, isMilestone: true };
    }
    // Otherwise it's a real bar (this is also how a milestone grows into one).
    return { start: task.start, end, isMilestone: false };
}

/**
 * Apply a Gantt drag to the markdown via the shared line engine.
 * Returns the markdown unchanged when there's nothing to do (no source line,
 * or a zero-day delta).
 */
export function applyGanttDrag(
    markdown: string,
    task: GanttTask,
    mode: GanttDragMode,
    dayDelta: number,
): string {
    if (typeof task.mdLine !== 'number' || dayDelta === 0) return markdown;

    const { start, end, isMilestone } = previewGanttDrag(task, mode, dayDelta);
    const patch: KanbanCardPatch = {
        start: ymd(start),
        // Milestone ⇒ drop the due marker; bar ⇒ set it. `null` removes it safely.
        due: isMilestone ? null : ymd(end),
    };
    return updateKanbanCardLine(markdown, task.mdLine, patch);
}

/** Rename a task via the shared line engine (Kanban markers preserved). Empty ⇒ no-op. */
export function applyGanttLabel(markdown: string, task: GanttTask, label: string): string {
    if (typeof task.mdLine !== 'number') return markdown;
    const next = label.replace(/\s+/g, ' ').trim();
    if (!next) return markdown;
    return updateKanbanCardLine(markdown, task.mdLine, { label: next });
}

/** Set a task's progress (clamped 0–100) via the shared line engine. */
export function applyGanttProgress(markdown: string, task: GanttTask, progress: number): string {
    if (typeof task.mdLine !== 'number' || !Number.isFinite(progress)) return markdown;
    const p = Math.min(100, Math.max(0, Math.round(progress)));
    return updateKanbanCardLine(markdown, task.mdLine, { progress: p });
}
