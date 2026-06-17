/**
 * Gantt parser (#54) — deterministic, no LLM.
 *
 * Reuses documentToTree() so we get the section hierarchy and source lines
 * (`mdLine`, full-document coordinates incl. frontmatter) for free. We then walk
 * the tree and pull inline markers off each node's label:
 *
 *     @start(YYYY-MM-DD)   required — a node without a valid start is not a task
 *     @due(YYYY-MM-DD)     end of the bar. @end(...) is an accepted alias.
 *     @progress(0..100)    completion. Falls back to checkbox [x]=100 / [ ]=0, else 0.
 *
 * A task with a start but no due/end is a milestone (rendered as a diamond).
 * The nearest ancestor (heading or list parent) label becomes the section/group,
 * and each section gets a stable palette colour. Dates are parsed at LOCAL
 * midnight (`new Date(y, m-1, d)`) to dodge the UTC off-by-one trap.
 */

import { documentToTree } from './markdownTree';
import { PALETTE } from './d3-layout';
import type { MindmapNode } from '../types/mindmap';
import type { GanttTask, GanttData } from '../types/gantt';

const START_RE = /@start\(\s*(\d{4})-(\d{1,2})-(\d{1,2})\s*\)/i;
const DUE_RE = /@(?:due|end)\(\s*(\d{4})-(\d{1,2})-(\d{1,2})\s*\)/i;
const PROGRESS_RE = /@progress\(\s*(\d{1,3})\s*\)/i;
const CHECKBOX_RE = /^\[([ xX])\]\s*/;
const MARKER_RE = /@\w+\([^)]*\)/g;

/** Parse `YYYY-MM-DD` at local midnight. Returns null for impossible dates
 *  (e.g. month 13, day 32) so bad markers are silently ignored. */
function parseLocalDate(y: number, m: number, d: number): Date | null {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const date = new Date(y, m - 1, d);
    // Reject overflow (e.g. Feb 30 → Mar 2): the round-trip must match.
    if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
    return date;
}

/** Strip all `@marker(...)` tokens and a leading checkbox from a label. */
function cleanLabel(label: string): string {
    return label.replace(CHECKBOX_RE, '').replace(MARKER_RE, '').replace(/\s+/g, ' ').trim();
}

/** Parse a full markdown document into gantt tasks. `fileName` (without extension)
 *  is used only as the tree root label and never appears as a section. */
export function parseGantt(fullMd: string, fileName?: string): GanttData {
    const stem = (fileName ?? '').replace(/\.(md|markdown|mdx|txt)$/i, '').trim() || undefined;
    const { tree } = documentToTree(fullMd, stem);

    const tasks: GanttTask[] = [];
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
        const startMatch = node.label.match(START_RE);
        if (startMatch) {
            const start = parseLocalDate(+startMatch[1], +startMatch[2], +startMatch[3]);
            if (start) {
                const dueMatch = node.label.match(DUE_RE);
                const due = dueMatch ? parseLocalDate(+dueMatch[1], +dueMatch[2], +dueMatch[3]) : null;
                const isMilestone = due === null;
                // End is inclusive and never before start (guards bad due < start).
                const end = isMilestone ? start : (due!.getTime() < start.getTime() ? start : due!);

                let progress: number;
                const progMatch = node.label.match(PROGRESS_RE);
                if (progMatch) {
                    progress = Math.min(100, Math.max(0, parseInt(progMatch[1], 10)));
                } else {
                    const box = node.label.match(CHECKBOX_RE);
                    progress = box ? (box[1].toLowerCase() === 'x' ? 100 : 0) : 0;
                }

                tasks.push({
                    id: node.id,
                    label: cleanLabel(node.label),
                    section,
                    start,
                    end,
                    isMilestone,
                    progress,
                    mdLine: node.mdLine,
                    color: colorFor(section),
                });
            }
        }
        // This node's clean label is the section for its children.
        const childSection = cleanLabel(node.label) || section;
        for (const child of node.children) visit(child, childSection);
    };

    // Root is the document title (H1) — its children's section is '' (top-level),
    // not the title, so a bare task list isn't grouped under the file name.
    for (const child of tree.children) visit(child, '');

    let rangeStart: Date | null = null;
    let rangeEnd: Date | null = null;
    for (const t of tasks) {
        if (rangeStart === null || t.start.getTime() < rangeStart.getTime()) rangeStart = t.start;
        if (rangeEnd === null || t.end.getTime() > rangeEnd.getTime()) rangeEnd = t.end;
    }

    return { tasks, rangeStart, rangeEnd };
}
