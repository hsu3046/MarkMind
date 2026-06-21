/**
 * Gantt generation serializer (#?? — gantt auto-generation).
 *
 * The LLM returns a flat JSON of tasks; we deterministically serialize it to the
 * SAME inline-marker markdown the gantt parser already reads (@start/@due/@progress),
 * so the generated chart round-trips through parseGantt() with ZERO new render code.
 * Keeping serialization in code (not the prompt) guarantees the marker format is
 * exact — LLMs drift on literal formats (see COMMON_PATTERNS "LLM 출력 형식 비일관").
 */

export interface GeneratedGanttTask {
    /** Task label (markers/checkbox stripped before output). */
    name: string;
    /** Section/group heading. Empty/absent ⇒ top-level (no heading). */
    section?: string;
    /** Inclusive start day, YYYY-MM-DD. Required — a task without a valid start is dropped. */
    start: string;
    /** Inclusive end day, YYYY-MM-DD. Absent (or before start) ⇒ milestone (diamond). */
    due?: string;
    /** Completion 0–100. Absent ⇒ omitted (renders as 0). */
    progress?: number;
}

export interface GeneratedGantt {
    title?: string;
    tasks: GeneratedGanttTask[];
}

const DATE_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;

/** Validate a YYYY-MM-DD string and return it zero-padded, or null if impossible.
 *  Mirrors gantt-parser's parseLocalDate so generation can't emit dates the parser rejects. */
function normalizeDate(s: string): string | null {
    const m = DATE_RE.exec(String(s).trim());
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const date = new Date(y, mo - 1, d);
    // Reject overflow (e.g. Feb 30 → Mar 2): the round-trip must match.
    if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
    const p = (n: number) => String(n).padStart(2, '0');
    return `${y}-${p(mo)}-${p(d)}`;
}

/** Strip newlines, a leading bullet/checkbox, and any `@marker(...)` tokens from a label
 *  so a hallucinated marker in the name can't corrupt parsing. */
function cleanName(name: string): string {
    return String(name ?? '')
        .replace(/@\w+\([^)]*\)/g, '')
        .replace(/^\s*[-*]\s*/, '')
        .replace(/^\[[ xX]\]\s*/, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Today at local midnight as YYYY-MM-DD (project-start default + prompt TODAY). */
export function todayYmd(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Serialize generated gantt tasks to inline-marker markdown.
 * Sections become `## heading`; each task becomes a checklist item with markers.
 * Order is preserved; tasks are grouped under their section in first-seen order.
 * Tasks with no valid start are silently dropped (matches the parser's contract).
 */
export function ganttToMarkdown(g: GeneratedGantt): string {
    const title = (g.title ?? '').trim() || '프로젝트 일정';

    // Group tasks by section preserving first-seen order.
    const order: string[] = [];
    const bySection = new Map<string, string[]>();

    for (const t of g.tasks ?? []) {
        const start = normalizeDate(t.start ?? '');
        if (!start) continue; // no valid start ⇒ not a task
        const name = cleanName(t.name) || '(제목 없음)';
        const section = (t.section ?? '').trim();

        let due = t.due ? normalizeDate(t.due) : null;
        // Guard: a due before the start makes no sense — treat as a milestone.
        // (Padded YYYY-MM-DD compares correctly as a plain string.)
        if (due && due < start) due = null;
        const isMilestone = !due;

        const markers = [`@start(${start})`];
        if (due) markers.push(`@due(${due})`);
        // Progress only on real bars (a milestone is a point event).
        if (!isMilestone && typeof t.progress === 'number' && Number.isFinite(t.progress)) {
            const p = Math.min(100, Math.max(0, Math.round(t.progress)));
            if (p > 0) markers.push(`@progress(${p})`);
        }

        const line = `- [ ] ${name} ${markers.join(' ')}`;
        if (!bySection.has(section)) { bySection.set(section, []); order.push(section); }
        bySection.get(section)!.push(line);
    }

    const out: string[] = [`# ${title}`];
    for (const section of order) {
        out.push(''); // blank line before each block
        if (section) out.push(`## ${section}`);
        out.push(...bySection.get(section)!);
    }
    return out.join('\n') + '\n';
}
