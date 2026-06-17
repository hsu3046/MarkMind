import { describe, it, expect } from 'vitest';
import { parseGantt } from './gantt-parser';

/** Helper: local-midnight date as YYYY-MM-DD (avoids UTC drift in assertions). */
function ymd(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

describe('parseGantt', () => {
    it('parses start/due/progress markers into a task', () => {
        const md = `# Plan
## 프로젝트 일정
- [ ] 구현 @start(2026-01-21) @due(2026-02-10) @progress(40)
`;
        const { tasks } = parseGantt(md);
        expect(tasks).toHaveLength(1);
        const t = tasks[0];
        expect(t.label).toBe('구현');
        expect(t.section).toBe('프로젝트 일정');
        expect(ymd(t.start)).toBe('2026-01-21');
        expect(ymd(t.end)).toBe('2026-02-10');
        expect(t.isMilestone).toBe(false);
        expect(t.progress).toBe(40);
    });

    it('treats a task with start but no due/end as a milestone', () => {
        const md = `# Plan
- [ ] 출시 마일스톤 @start(2026-02-11)
`;
        const { tasks } = parseGantt(md);
        expect(tasks).toHaveLength(1);
        expect(tasks[0].isMilestone).toBe(true);
        expect(ymd(tasks[0].start)).toBe('2026-02-11');
        expect(ymd(tasks[0].end)).toBe('2026-02-11');
    });

    it('accepts @end as an alias for @due', () => {
        const md = `# Plan
- [ ] A @start(2026-01-01) @end(2026-01-05)
`;
        const { tasks } = parseGantt(md);
        expect(tasks[0].isMilestone).toBe(false);
        expect(ymd(tasks[0].end)).toBe('2026-01-05');
    });

    it('prefers @progress over the checkbox state', () => {
        const md = `# Plan
- [x] done-but-70 @start(2026-01-01) @due(2026-01-02) @progress(70)
`;
        const { tasks } = parseGantt(md);
        expect(tasks[0].progress).toBe(70);
    });

    it('falls back to checkbox: [x]=100, [ ]=0', () => {
        const md = `# Plan
- [x] 설계 @start(2026-01-13) @due(2026-01-20)
- [ ] 구현 @start(2026-01-21) @due(2026-02-10)
`;
        const { tasks } = parseGantt(md);
        expect(tasks.find((t) => t.label === '설계')?.progress).toBe(100);
        expect(tasks.find((t) => t.label === '구현')?.progress).toBe(0);
    });

    it('clamps progress to 0..100', () => {
        const md = `# Plan
- [ ] A @start(2026-01-01) @due(2026-01-02) @progress(250)
`;
        const { tasks } = parseGantt(md);
        expect(tasks[0].progress).toBe(100);
    });

    it('returns no tasks when there are no markers', () => {
        const md = `# Plan
## Goals
- ship v1
- get users
`;
        const { tasks, rangeStart, rangeEnd } = parseGantt(md);
        expect(tasks).toHaveLength(0);
        expect(rangeStart).toBeNull();
        expect(rangeEnd).toBeNull();
    });

    it('ignores a node with an invalid start date (not a task)', () => {
        const md = `# Plan
- [ ] bad @start(2026-13-40) @due(2026-02-10)
- [ ] good @start(2026-01-01) @due(2026-01-05)
`;
        const { tasks } = parseGantt(md);
        expect(tasks).toHaveLength(1);
        expect(tasks[0].label).toBe('good');
    });

    it('ignores an invalid due (treated as a milestone)', () => {
        const md = `# Plan
- [ ] A @start(2026-01-01) @due(2026-02-30)
`;
        const { tasks } = parseGantt(md);
        expect(tasks[0].isMilestone).toBe(true);
    });

    it('clamps a due earlier than start up to the start day', () => {
        const md = `# Plan
- [ ] A @start(2026-01-10) @due(2026-01-05)
`;
        const { tasks } = parseGantt(md);
        expect(ymd(tasks[0].end)).toBe('2026-01-10');
    });

    it('groups tasks by their parent heading and assigns one colour per section', () => {
        const md = `# Plan
## 분석
- [ ] 요구사항 @start(2026-01-05) @due(2026-01-12)
## 개발
- [ ] 구현 @start(2026-01-21) @due(2026-02-10)
- [ ] 테스트 @start(2026-02-11) @due(2026-02-15)
`;
        const { tasks } = parseGantt(md);
        const bySection = (s: string) => tasks.filter((t) => t.section === s);
        expect(bySection('분석')).toHaveLength(1);
        expect(bySection('개발')).toHaveLength(2);
        // tasks in the same section share a colour; different sections differ.
        expect(bySection('개발')[0].color).toBe(bySection('개발')[1].color);
        expect(bySection('분석')[0].color).not.toBe(bySection('개발')[0].color);
    });

    it('preserves mdLine in full-document coordinates (incl. frontmatter)', () => {
        const md = `---
title: x
---
# Plan
- [ ] A @start(2026-01-01) @due(2026-01-02)
`;
        const { tasks } = parseGantt(md);
        // frontmatter (3 lines) + "# Plan" (line 4) + task on line 5.
        expect(tasks[0].mdLine).toBe(5);
    });

    it('computes the overall date range across all tasks', () => {
        const md = `# Plan
- [ ] A @start(2026-01-10) @due(2026-01-20)
- [ ] B @start(2026-01-05) @due(2026-01-12)
- [ ] C @start(2026-02-01)
`;
        const { rangeStart, rangeEnd } = parseGantt(md);
        expect(ymd(rangeStart!)).toBe('2026-01-05');
        expect(ymd(rangeEnd!)).toBe('2026-02-01');
    });
});
