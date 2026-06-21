import { describe, it, expect } from 'vitest';
import { ganttToMarkdown } from './ganttSerialize';
import { parseGantt } from './gantt-parser';

/** Local-midnight date as YYYY-MM-DD (avoids UTC drift in assertions). */
function ymd(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

describe('ganttToMarkdown', () => {
    it('round-trips generated tasks through parseGantt (section/start/due/progress)', () => {
        const md = ganttToMarkdown({
            title: '프로젝트 일정',
            tasks: [
                { name: '요구사항 정의', section: '기획', start: '2026-07-01', due: '2026-07-05', progress: 60 },
                { name: '백엔드 API', section: '개발', start: '2026-07-11', due: '2026-07-25' },
            ],
        });
        const { tasks } = parseGantt(md);
        expect(tasks).toHaveLength(2);
        expect(tasks[0].label).toBe('요구사항 정의');
        expect(tasks[0].section).toBe('기획');
        expect(ymd(tasks[0].start)).toBe('2026-07-01');
        expect(ymd(tasks[0].end)).toBe('2026-07-05');
        expect(tasks[0].progress).toBe(60);
        expect(tasks[1].section).toBe('개발');
        expect(tasks[1].isMilestone).toBe(false);
    });

    it('omits @due for a milestone (no due) and parses as a milestone', () => {
        const md = ganttToMarkdown({ tasks: [{ name: '정식 출시', start: '2026-08-23' }] });
        expect(md).not.toMatch(/@due\(/);
        const { tasks } = parseGantt(md);
        expect(tasks[0].isMilestone).toBe(true);
    });

    it('zero-pads dates and drops tasks with an invalid start', () => {
        const md = ganttToMarkdown({
            tasks: [
                { name: 'ok', start: '2026-7-1', due: '2026-7-9' },   // unpadded → padded
                { name: 'bad', start: '2026-13-40' },                  // impossible → dropped
                { name: 'none', start: 'not-a-date' },                 // invalid → dropped
            ],
        });
        expect(md).toContain('@start(2026-07-01)');
        expect(md).toContain('@due(2026-07-09)');
        const { tasks } = parseGantt(md);
        expect(tasks).toHaveLength(1);
        expect(tasks[0].label).toBe('ok');
    });

    it('treats a due-before-start as a milestone', () => {
        const md = ganttToMarkdown({ tasks: [{ name: 'x', start: '2026-07-10', due: '2026-07-01' }] });
        expect(md).not.toMatch(/@due\(/);
        const { tasks } = parseGantt(md);
        expect(tasks[0].isMilestone).toBe(true);
    });

    it("strips markers/checkbox from the task name so it can't corrupt parsing", () => {
        const md = ganttToMarkdown({
            tasks: [{ name: '- [x] 해킹 @start(1999-01-01)', start: '2026-07-01', due: '2026-07-02' }],
        });
        const { tasks } = parseGantt(md);
        expect(tasks).toHaveLength(1);
        expect(tasks[0].label).toBe('해킹');
        expect(ymd(tasks[0].start)).toBe('2026-07-01'); // not the injected 1999 date
    });

    it('omits @progress when 0 or absent, clamps out-of-range', () => {
        const zero = ganttToMarkdown({ tasks: [{ name: 'a', start: '2026-07-01', due: '2026-07-02', progress: 0 }] });
        expect(zero).not.toMatch(/@progress\(/);
        const over = ganttToMarkdown({ tasks: [{ name: 'b', start: '2026-07-01', due: '2026-07-02', progress: 150 }] });
        expect(over).toContain('@progress(100)');
    });

    it('defaults the title when missing', () => {
        const md = ganttToMarkdown({ tasks: [{ name: 'a', start: '2026-07-01' }] });
        expect(md.startsWith('# 프로젝트 일정')).toBe(true);
    });
});
