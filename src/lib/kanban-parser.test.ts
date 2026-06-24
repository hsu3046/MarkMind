import { describe, it, expect } from 'vitest';
import { parseKanban } from './kanban-parser';

function ymd(d: Date | null): string | null {
    if (!d) return null;
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

describe('parseKanban', () => {
    it('parses explicit status with Gantt-compatible markers', () => {
        const md = `# Plan
## 개발
- [ ] 구현 @status(doing) @start(2026-07-01) @due(2026-07-10) @progress(40) @priority(high)
`;
        const { cards, counts } = parseKanban(md);
        expect(cards).toHaveLength(1);
        expect(cards[0].label).toBe('구현');
        expect(cards[0].section).toBe('개발');
        expect(cards[0].status).toBe('doing');
        expect(cards[0].priority).toBe('high');
        expect(cards[0].order).toBeNull();
        expect(cards[0].progress).toBe(40);
        expect(ymd(cards[0].start)).toBe('2026-07-01');
        expect(ymd(cards[0].due)).toBe('2026-07-10');
        expect(counts.doing).toBe(1);
    });

    it('infers done from checked boxes and progress 100', () => {
        const md = `# Plan
- [x] 릴리스 @start(2026-07-15)
- 문서 정리 @start(2026-07-16) @progress(100)
`;
        const { cards, counts } = parseKanban(md);
        expect(cards.map((c) => c.status)).toEqual(['done', 'done']);
        expect(counts.done).toBe(2);
    });

    it('infers doing from partial progress on a Gantt task without status', () => {
        const md = `# Plan
- API 연결 @start(2026-07-01) @due(2026-07-10) @progress(25)
`;
        const { cards } = parseKanban(md);
        expect(cards).toHaveLength(1);
        expect(cards[0].status).toBe('doing');
    });

    it('keeps plain markdown out of the board', () => {
        const md = `# Plan
## 메모
- 그냥 생각
- 다른 항목
`;
        expect(parseKanban(md).cards).toHaveLength(0);
    });

    it('normalizes status aliases and preserves source line coordinates', () => {
        const md = `---
title: x
---
# Plan
- 리뷰 대기 @status(qa)
- 외부 의존성 @status(blocked)
`;
        const { cards, counts } = parseKanban(md);
        expect(cards[0].status).toBe('review');
        expect(cards[0].mdLine).toBe(5);
        expect(cards[1].status).toBe('blocked');
        expect(counts.review).toBe(1);
        expect(counts.blocked).toBe(1);
    });

    it('normalizes Korean status aliases with spaces', () => {
        const md = `# Plan
- 진행 카드 @status(진행 중)
- 작업 카드 @status(작업 중)
- 검토 카드 @status(검토 중)
- 대기 카드 @status(대기 중)
`;
        const { cards, counts } = parseKanban(md);
        expect(cards.map((c) => c.status)).toEqual(['doing', 'doing', 'review', 'blocked']);
        expect(counts.doing).toBe(2);
        expect(counts.review).toBe(1);
        expect(counts.blocked).toBe(1);
    });

    it('falls back to todo for invalid dates and unknown statuses', () => {
        const md = `# Plan
- 확인 필요 @status(unknown) @due(2026-02-30)
`;
        const { cards } = parseKanban(md);
        expect(cards[0].status).toBe('todo');
        expect(cards[0].due).toBeNull();
    });

    it('parses Kanban-only order markers without keeping them in labels', () => {
        const md = `# Plan
- [ ] 두 번째 @status(todo) @order(2000)
`;
        const { cards } = parseKanban(md);
        expect(cards[0].label).toBe('두 번째');
        expect(cards[0].order).toBe(2000);
    });
});
