import { describe, it, expect } from 'vitest';
import { kanbanToMarkdown } from './kanbanSerialize';
import { parseKanban } from './kanban-parser';
import { parseGantt } from './gantt-parser';

function ymd(d: Date | null): string | null {
    if (!d) return null;
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

describe('kanbanToMarkdown', () => {
    it('round-trips generated cards through parseKanban', () => {
        const md = kanbanToMarkdown({
            title: '출시 칸반',
            cards: [
                {
                    name: '요구사항 정리',
                    section: '기획',
                    status: 'todo',
                    priority: 'high',
                    start: '2026-07-01',
                    due: '2026-07-03',
                },
                {
                    name: 'API 구현',
                    section: '개발',
                    status: 'doing',
                    priority: 'urgent',
                    start: '2026-07-04',
                    due: '2026-07-12',
                    progress: 35,
                },
            ],
        });
        const { cards, counts } = parseKanban(md);
        expect(cards).toHaveLength(2);
        expect(cards[0].label).toBe('요구사항 정리');
        expect(cards[0].section).toBe('기획');
        expect(cards[0].status).toBe('todo');
        expect(cards[0].priority).toBe('high');
        expect(ymd(cards[0].start)).toBe('2026-07-01');
        expect(ymd(cards[0].due)).toBe('2026-07-03');
        expect(cards[1].status).toBe('doing');
        expect(cards[1].priority).toBe('urgent');
        expect(cards[1].progress).toBe(35);
        expect(counts.todo).toBe(1);
        expect(counts.doing).toBe(1);
    });

    it('keeps generated markdown compatible with parseGantt when dates exist', () => {
        const md = kanbanToMarkdown({
            cards: [
                { name: '진행 작업', status: 'doing', start: '2026-07-01', due: '2026-07-05', progress: 50 },
                { name: '완료 작업', status: 'done', start: '2026-07-06', due: '2026-07-08', progress: 100 },
            ],
        });
        const { tasks } = parseGantt(md);
        expect(tasks).toHaveLength(2);
        expect(tasks[0].label).toBe('진행 작업');
        expect(tasks[0].progress).toBe(50);
        expect(tasks[1].label).toBe('완료 작업');
        expect(tasks[1].progress).toBe(100);
    });

    it('normalizes aliases, zero-pads dates, and drops invalid fields', () => {
        const md = kanbanToMarkdown({
            cards: [
                {
                    name: '- [x] 리뷰 @status(done)',
                    section: '## QA',
                    status: 'qa',
                    priority: 'P2',
                    start: '2026-7-1',
                    due: '2026-13-40',
                },
                { name: '알 수 없음', status: 'mystery', priority: 'p9', start: 'bad' },
            ],
        });
        expect(md).toContain('@status(review)');
        expect(md).toContain('@priority(medium)');
        expect(md).toContain('@start(2026-07-01)');
        expect(md).not.toContain('2026-13-40');
        const { cards } = parseKanban(md);
        expect(cards[0].label).toBe('리뷰');
        expect(cards[0].section).toBe('QA');
        expect(cards[0].status).toBe('review');
        expect(cards[1].status).toBe('todo');
        expect(cards[1].priority).toBeNull();
    });

    it('normalizes Korean status aliases with spaces from generated JSON', () => {
        const md = kanbanToMarkdown({
            cards: [
                { name: '진행 카드', status: '진행 중' },
                { name: '검토 카드', status: '검토 중' },
                { name: '대기 카드', status: '대기 중' },
                { name: '완료 카드', status: '완료 됨' },
            ],
        });
        expect(md).toContain('진행 카드 @status(doing)');
        expect(md).toContain('검토 카드 @status(review)');
        expect(md).toContain('대기 카드 @status(blocked)');
        expect(md).toContain('- [x] 완료 카드 @status(done)');
        const { cards } = parseKanban(md);
        expect(cards.map((c) => c.status)).toEqual(['doing', 'review', 'blocked', 'done']);
    });

    it('treats due-before-start as no due date', () => {
        const md = kanbanToMarkdown({
            cards: [{ name: '일정 오류', status: 'todo', start: '2026-07-10', due: '2026-07-01' }],
        });
        expect(md).not.toMatch(/@due\(/);
        const { cards } = parseKanban(md);
        expect(ymd(cards[0].start)).toBe('2026-07-10');
        expect(cards[0].due).toBeNull();
    });

    it('does not serialize Kanban status names as section headings', () => {
        const md = kanbanToMarkdown({
            cards: [
                { name: 'API 구현', section: '진행 중', status: 'doing' },
                { name: '카피 검수', section: 'Review', status: 'review' },
                { name: '결제 정책', section: '결제', status: 'todo' },
            ],
        });
        expect(md).not.toContain('## 진행 중');
        expect(md).not.toContain('## Review');
        expect(md).toContain('## 결제');
        const { cards } = parseKanban(md);
        expect(cards[0].section).toBe('');
        expect(cards[1].section).toBe('');
        expect(cards[2].section).toBe('결제');
    });

    it('defaults the title and skips empty card names', () => {
        const md = kanbanToMarkdown({ cards: [{ name: '   ', status: 'todo' }, { name: '작업', status: 'todo' }] });
        expect(md.startsWith('# 칸반 보드')).toBe(true);
        expect(parseKanban(md).cards).toHaveLength(1);
    });
});
