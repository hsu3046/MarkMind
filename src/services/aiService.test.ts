import { describe, it, expect } from 'vitest';
import { generateDiff } from './aiService';

// #36 — generateDiff 의 paragraph/word LCS 는 O(m·n) DP 라 대형 입력에서 메인 스레드를
// 막는다. 일정 규모(LCS_CELL_LIMIT = 200만 셀) 초과 시 "전체 교체"로 폴백하는 가드를 검증.
describe('generateDiff 대형 문서 가드(#36)', () => {
    it('일반 크기는 정밀 diff — 공통 문단을 unchanged 로 보존', () => {
        const orig = 'keep\n\nold\n\nkeep2';
        const mod = 'keep\n\nnew\n\nkeep2';
        const chunks = generateDiff(orig, mod);
        const unchanged = chunks
            .filter((c) => c.type === 'unchanged' && c.content)
            .map((c) => c.content);
        expect(unchanged).toContain('keep');
        expect(unchanged).toContain('keep2');
        // 변경 문단은 removed/added 로 표현
        expect(chunks.some((c) => c.type === 'removed')).toBe(true);
        expect(chunks.some((c) => c.type === 'added')).toBe(true);
    });

    it('문단 수가 임계를 넘으면 전체 교체로 폴백 — 공통 문단도 unchanged 로 잡히지 않음', () => {
        // 앞 1500 문단은 양쪽 동일. 정밀 diff 라면 전부 unchanged 로 보존됐을 것.
        const common = Array.from({ length: 1500 }, (_, i) => `c${i}`);
        const orig = [...common, 'tail-o'].join('\n\n'); // 1501 문단
        const mod = [...common, 'tail-m'].join('\n\n'); // 1501 문단 → 1501² ≈ 225만 > 200만
        const chunks = generateDiff(orig, mod);
        const unchanged = chunks.filter((c) => c.type === 'unchanged' && c.content);
        // 폴백이면 공통 문단(c0..c1499)도 unchanged 가 아니라 removed/added 로 나뉜다.
        expect(unchanged).toHaveLength(0);
        expect(chunks.some((c) => c.type === 'removed')).toBe(true);
        expect(chunks.some((c) => c.type === 'added')).toBe(true);
    });

    it('줄바꿈 없는 초대형 단일 문단도 가드로 처리(word LCS 폭발 방지)', () => {
        // 한 문단 안 토큰 수가 커서 wordDiff 의 토큰 LCS 가 폭발할 입력.
        const orig = Array.from({ length: 3000 }, (_, i) => `wo${i}`).join(' ');
        const mod = Array.from({ length: 3000 }, (_, i) => `wm${i}`).join(' ');
        // 단일 문단 쌍이므로 generateDiff 진입 가드(문단 1×1)는 통과 → wordDiff 가드가 받음.
        const chunks = generateDiff(orig, mod);
        // 예외 없이 removed/added 가 생성되면 통과(폭발 시 행/크래시 발생).
        expect(chunks.some((c) => c.type === 'removed')).toBe(true);
        expect(chunks.some((c) => c.type === 'added')).toBe(true);
    });
});
