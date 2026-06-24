import { describe, it, expect } from 'vitest';
import { updateKanbanCardLine } from './kanbanEdit';
import { parseKanban } from './kanban-parser';
import { parseGantt } from './gantt-parser';

describe('updateKanbanCardLine', () => {
    it('updates status on a single source line and toggles checkbox state', () => {
        const md = `# Board
- [ ] 구현 @status(todo) @start(2026-07-01) @due(2026-07-05)
- [ ] 리뷰 @status(review)
`;
        const next = updateKanbanCardLine(md, 2, { status: 'done' });
        expect(next.split('\n')[1]).toBe('- [x] 구현 @status(done) @start(2026-07-01) @due(2026-07-05)');
        expect(parseKanban(next).cards[0].status).toBe('done');
        expect(parseGantt(next).tasks[0].progress).toBe(100);
    });

    it('edits the label while preserving known and custom markers', () => {
        const md = `# Board
  - [ ] 초안 @status(qa) @priority(P1) @owner(kim)
`;
        const next = updateKanbanCardLine(md, 2, { label: '최종 검토' });
        expect(next.split('\n')[1]).toBe('  - [ ] 최종 검토 @status(qa) @priority(P1) @owner(kim)');
    });

    it('replaces priority and dates without touching surrounding lines', () => {
        const md = `# Board
- [ ] A @status(todo)
- [ ] B @status(doing) @priority(low) @start(2026-7-1) @due(2026-7-5) @progress(25)
- [ ] C @status(done)
`;
        const next = updateKanbanCardLine(md, 3, {
            priority: 'urgent',
            start: '2026-07-02',
            due: '2026-07-09',
            progress: 40,
        });
        expect(next.split('\n')[1]).toBe('- [ ] A @status(todo)');
        expect(next.split('\n')[2]).toBe('- [ ] B @status(doing) @priority(urgent) @start(2026-07-02) @due(2026-07-09) @progress(40)');
        expect(next.split('\n')[3]).toBe('- [ ] C @status(done)');
    });

    it('removes nullable fields and drops due-before-start', () => {
        const md = `# Board
- [ ] 작업 @status(doing) @priority(high) @start(2026-07-10) @due(2026-07-12) @progress(60)
`;
        const next = updateKanbanCardLine(md, 2, {
            priority: null,
            due: '2026-07-01',
            progress: null,
        });
        expect(next.split('\n')[1]).toBe('- [ ] 작업 @status(doing) @start(2026-07-10)');
    });

    it('returns the original markdown for invalid line coordinates', () => {
        const md = '# Board\n- [ ] 작업 @status(todo)\n';
        expect(updateKanbanCardLine(md, 0, { status: 'done' })).toBe(md);
        expect(updateKanbanCardLine(md, 99, { status: 'done' })).toBe(md);
    });
});
