import { describe, it, expect } from 'vitest';
import { applyGanttDrag, applyGanttLabel, applyGanttProgress, previewGanttDrag } from './ganttEdit';
import { parseGantt } from './gantt-parser';
import { parseKanban } from './kanban-parser';
import type { GanttTask } from '../types/gantt';

/** Build a single GanttTask from one marker line via the real parser. */
function firstTask(md: string): GanttTask {
    const t = parseGantt(md).tasks[0];
    if (!t) throw new Error('no task parsed');
    return t;
}
function line(md: string, n: number): string {
    return md.split('\n')[n - 1];
}
function ymd(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

describe('previewGanttDrag (pure date math)', () => {
    const md = `# P\n- [ ] A @start(2026-07-01) @due(2026-07-10) @progress(40)\n`;

    it('move shifts start and end together (duration preserved)', () => {
        const r = previewGanttDrag(firstTask(md), 'move', 3);
        expect(ymd(r.start)).toBe('2026-07-04');
        expect(ymd(r.end)).toBe('2026-07-13');
        expect(r.isMilestone).toBe(false);
    });

    it('resize-end extends only the end', () => {
        const r = previewGanttDrag(firstTask(md), 'resize-end', 5);
        expect(ymd(r.start)).toBe('2026-07-01');
        expect(ymd(r.end)).toBe('2026-07-15');
    });

    it('resize-start moves only the start, clamped to the end', () => {
        const r = previewGanttDrag(firstTask(md), 'resize-start', 100);
        expect(ymd(r.start)).toBe('2026-07-10'); // clamped, never past end
        expect(ymd(r.end)).toBe('2026-07-10');
    });

    it('resize-end dragged before the start collapses to a milestone', () => {
        const r = previewGanttDrag(firstTask(md), 'resize-end', -100);
        expect(r.isMilestone).toBe(true);
        expect(ymd(r.end)).toBe(ymd(r.start));
    });

    it('a milestone grows into a bar when its end is dragged out', () => {
        const ms = firstTask(`# P\n- [ ] 출시 @start(2026-07-15)\n`);
        expect(ms.isMilestone).toBe(true);
        const r = previewGanttDrag(ms, 'resize-end', 4);
        expect(r.isMilestone).toBe(false);
        expect(ymd(r.end)).toBe('2026-07-19');
    });
});

describe('applyGanttDrag — Kanban marker compatibility (shared line engine)', () => {
    it('moving a bar keeps @status/@priority/@order/@progress and unknown markers intact', () => {
        const md = `# Board
- [ ] 구현 @status(doing) @priority(high) @start(2026-07-01) @due(2026-07-10) @progress(40) @order(2000) @owner(kim)
`;
        const next = applyGanttDrag(md, firstTask(md), 'move', 7);

        // Gantt side: both dates shifted by 7 days.
        const gt = parseGantt(next).tasks[0];
        expect(ymd(gt.start)).toBe('2026-07-08');
        expect(ymd(gt.end)).toBe('2026-07-17');

        // Kanban side: every non-date marker survived the edit.
        const card = parseKanban(next).cards[0];
        expect(card.status).toBe('doing');
        expect(card.priority).toBe('high');
        expect(card.order).toBe(2000);
        expect(card.progress).toBe(40);

        // An unknown marker is preserved verbatim.
        expect(line(next, 2)).toContain('@owner(kim)');
    });

    it('resize-end only rewrites @due, leaving the rest of the line stable', () => {
        const md = `# Board
- [ ] B @status(review) @start(2026-07-01) @due(2026-07-05)
`;
        const next = applyGanttDrag(md, firstTask(md), 'resize-end', 3);
        expect(line(next, 2)).toContain('@start(2026-07-01)');
        expect(line(next, 2)).toContain('@due(2026-07-08)');
        expect(parseKanban(next).cards[0].status).toBe('review');
    });

    it('collapsing a bar to a milestone drops @due but keeps the Kanban card', () => {
        const md = `# Board\n- [ ] C @status(todo) @start(2026-07-10) @due(2026-07-15)\n`;
        const next = applyGanttDrag(md, firstTask(md), 'resize-end', -100);
        expect(line(next, 2)).not.toContain('@due');
        expect(parseGantt(next).tasks[0].isMilestone).toBe(true);
        expect(parseKanban(next).cards[0].status).toBe('todo');
    });

    it('a zero-day drag is a no-op', () => {
        const md = `# Board\n- [ ] D @start(2026-07-01) @due(2026-07-10)\n`;
        expect(applyGanttDrag(md, firstTask(md), 'move', 0)).toBe(md);
    });

    it('never touches sibling lines', () => {
        const md = `# Board
- [ ] A @start(2026-07-01) @due(2026-07-05)
- [ ] B @start(2026-07-10) @due(2026-07-12)
`;
        const next = applyGanttDrag(md, parseGantt(md).tasks[0], 'move', 2);
        expect(line(next, 3)).toBe('- [ ] B @start(2026-07-10) @due(2026-07-12)');
    });
});

describe('applyGanttLabel / applyGanttProgress — inline edits via shared engine', () => {
    it('renames the label (collapsed whitespace), preserving markers', () => {
        const md = `# Board\n- [ ] 구현 @status(doing) @start(2026-07-01) @due(2026-07-10) @progress(40)\n`;
        const next = applyGanttLabel(md, firstTask(md), '  설계  검토 ');
        const card = parseKanban(next).cards[0];
        expect(card.label).toBe('설계 검토');
        expect(card.status).toBe('doing');
        expect(card.progress).toBe(40);
        expect(ymd(parseGantt(next).tasks[0].start)).toBe('2026-07-01');
    });

    it('ignores an empty rename', () => {
        const md = `# Board\n- [ ] A @start(2026-07-01) @due(2026-07-05)\n`;
        expect(applyGanttLabel(md, firstTask(md), '   ')).toBe(md);
    });

    it('sets progress and keeps other markers (status/dates)', () => {
        const md = `# Board\n- [ ] B @status(doing) @start(2026-07-01) @due(2026-07-10)\n`;
        const next = applyGanttProgress(md, firstTask(md), 65);
        expect(line(next, 2)).toContain('@progress(65)');
        expect(parseGantt(next).tasks[0].progress).toBe(65);
        expect(parseKanban(next).cards[0].status).toBe('doing');
    });

    it('clamps progress to 0–100', () => {
        const md = `# Board\n- [ ] C @start(2026-07-01) @due(2026-07-10) @progress(50)\n`;
        expect(parseGantt(applyGanttProgress(md, firstTask(md), 150)).tasks[0].progress).toBe(100);
        // progress 0 ⇒ marker dropped, parser falls back to checkbox [ ] = 0
        expect(parseGantt(applyGanttProgress(md, firstTask(md), -20)).tasks[0].progress).toBe(0);
    });

    it('lowering a done task below 100 releases done — status + checkbox (Codex P2, 저장 유실 방지)', () => {
        const md = `# Board\n- [x] 완료작업 @status(done) @start(2026-07-01) @due(2026-07-10)\n`;
        const next = applyGanttProgress(md, firstTask(md), 60);
        expect(parseGantt(next).tasks[0].progress).toBe(60);          // 진행률 반영(유실 X)
        expect(line(next, 2)).not.toContain('@status(done)');         // done 마커 해제
        expect(line(next, 2)).not.toContain('[x]');                   // checkbox 해제
        expect(parseKanban(next).cards[0].status).not.toBe('done');   // Kanban 도 done 아님
        expect(parseKanban(next).cards[0].progress).toBe(60);
    });

    it('checkbox-only done also releases when progress lowered', () => {
        const md = `# Board\n- [x] 작업 @start(2026-07-01) @due(2026-07-10)\n`;
        const next = applyGanttProgress(md, firstTask(md), 40);
        expect(parseGantt(next).tasks[0].progress).toBe(40);
        expect(line(next, 2)).not.toContain('[x]');
    });

    it('progress 100 keeps done (release only below 100)', () => {
        const md = `# Board\n- [x] 작업 @status(done) @start(2026-07-01) @due(2026-07-10)\n`;
        const next = applyGanttProgress(md, firstTask(md), 100);
        expect(parseGantt(next).tasks[0].progress).toBe(100);
        expect(parseKanban(next).cards[0].status).toBe('done');
    });

    it('done alias without checkbox (@status(완료)) also releases on progress lower (Codex P2)', () => {
        const md = `# Board\n- 작업 @status(완료) @start(2026-07-01) @due(2026-07-10) @progress(100)\n`;
        const next = applyGanttProgress(md, firstTask(md), 60);
        expect(line(next, 2)).not.toContain('@status(완료)');         // done 별칭 해제
        expect(parseKanban(next).cards[0].status).not.toBe('done');   // Kanban 도 done 아님
        expect(parseGantt(next).tasks[0].progress).toBe(60);
    });

    it('checked card with a non-done alias keeps the alias on release (Codex P2 — only done alias removed)', () => {
        const md = `# Board\n- [x] 작업 @status(qa) @start(2026-07-01) @due(2026-07-10)\n`;
        const next = applyGanttProgress(md, firstTask(md), 60);
        expect(line(next, 2)).toContain('@status(qa)');               // 비-done 별칭(qa=review) 보존
        expect(line(next, 2)).toContain('[ ]');                       // checkbox 만 해제
        expect(parseKanban(next).cards[0].status).toBe('review');     // review 유지
        expect(parseGantt(next).tasks[0].progress).toBe(60);
    });
});
