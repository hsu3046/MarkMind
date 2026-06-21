import { describe, it, expect } from 'vitest';
import { quoteRange } from './quoteMatch';

describe('quoteRange', () => {
    it('단일 줄', () => {
        expect(quoteRange('hello world foo', 'world')).toEqual({ from: 6, to: 11 });
    });
    it('여러 단락 (Rich Text \\n ↔ 마크다운 \\n\\n)', () => {
        expect(quoteRange('para A\n\npara B', 'para A\npara B')).toEqual({ from: 0, to: 14 });
    });
    it('리스트 항목 (마커 제외 plain)', () => {
        expect(quoteRange('- item one\n- item two', 'item one')).toEqual({ from: 2, to: 10 });
    });
    it('괄호 등 특수문자', () => {
        const r = quoteRange('x 직장인 (40대) y', '직장인 (40대)');
        expect(r).toEqual({ from: 2, to: 11 });
    });
    it('못 찾으면 null', () => {
        expect(quoteRange('abc', 'xyz')).toBeNull();
    });
});
