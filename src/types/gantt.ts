/**
 * Gantt data model (#54).
 *
 * Markdown stays the single source of truth: tasks are derived from deterministic
 * inline markers on heading/list nodes —
 *
 *     - [ ] 구현 @start(2026-01-21) @due(2026-02-10) @progress(40)
 *     - [ ] 출시 마일스톤 @start(2026-02-11)        ← no due/end ⇒ milestone
 *
 * The parser (see ../lib/gantt-parser.ts) reuses documentToTree() so each task
 * carries its source line (`mdLine`) for jump-to-source and inherits its parent
 * heading/list label as its section (group). Dates are parsed at local midnight
 * to avoid the UTC off-by-one trap.
 */

export interface GanttTask {
    /** Stable id (derived from the source tree node id). */
    id: string;
    /** Task label with the `@…(…)` markers stripped. */
    label: string;
    /** Group/section label (nearest ancestor heading or list parent). '' when top-level. */
    section: string;
    /** Inclusive start day at local midnight. */
    start: Date;
    /** Inclusive end day at local midnight. Equals `start` for milestones. */
    end: Date;
    /** A milestone has a start but no due/end marker (rendered as a diamond). */
    isMilestone: boolean;
    /** Completion 0–100. From `@progress(n)`, else checkbox ([x]=100 / [ ]=0), else 0. */
    progress: number;
    /** 1-based source line in the FULL document (for onJumpToSource). */
    mdLine?: number;
    /** Palette colour for this task's section (consistent per section). */
    color: string;
}

export interface GanttData {
    tasks: GanttTask[];
    /** Earliest task start across all tasks (local midnight). null when empty. */
    rangeStart: Date | null;
    /** Latest task end across all tasks (local midnight). null when empty. */
    rangeEnd: Date | null;
}
