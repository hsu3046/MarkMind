import { describe, it, expect } from 'vitest';
import { splitIntoSlides, DEFAULT_SLIDESHOW_SETTINGS, type SlideshowSettings } from './slideSplit';

const opts = (o: Partial<SlideshowSettings> = {}): SlideshowSettings => ({
    ...DEFAULT_SLIDESHOW_SETTINGS,
    ...o,
});

describe('splitIntoSlides — 분할 기준', () => {
    it('--- 수평선에서 분할(구분선 자체는 슬라이드에 미포함)', () => {
        expect(splitIntoSlides('A\n\n---\n\nB', opts())).toEqual(['A', 'B']);
    });

    it('H1 헤딩에서 분할(헤딩은 새 슬라이드 제목으로 포함)', () => {
        expect(splitIntoSlides('# One\ntext1\n# Two\ntext2', opts())).toEqual([
            '# One\ntext1',
            '# Two\ntext2',
        ]);
    });

    it('H2 기본 OFF — ## 에서는 안 나뉨', () => {
        expect(splitIntoSlides('## A\nx\n## B\ny', opts())).toEqual(['## A\nx\n## B\ny']);
    });

    it('H2 ON — ## 에서 나뉨', () => {
        expect(splitIntoSlides('## A\nx\n## B\ny', opts({ splitOnH2: true }))).toEqual([
            '## A\nx',
            '## B\ny',
        ]);
    });

    it('분할 기준 모두 OFF → 전체 1장', () => {
        const md = '# A\n---\n# B';
        expect(splitIntoSlides(md, opts({ splitOnHr: false, splitOnH1: false }))).toEqual([md]);
    });
});

describe('splitIntoSlides — 함정 처리', () => {
    it('코드블록 안의 ---/# 는 경계로 보지 않음', () => {
        const md = '# A\n```\n---\n# not a heading\n```\nbody';
        expect(splitIntoSlides(md, opts())).toEqual([md]);
    });

    it('frontmatter 의 --- 는 분할/내용에서 제외', () => {
        expect(splitIntoSlides('---\ntitle: X\n---\n# A\nbody', opts())).toEqual(['# A\nbody']);
    });

    it('빈 문서 → 빈 슬라이드 1장', () => {
        expect(splitIntoSlides('', opts())).toEqual(['']);
    });

    it('공백만 있는 세그먼트는 버림(연속 ---)', () => {
        expect(splitIntoSlides('A\n---\n---\nB', opts())).toEqual(['A', 'B']);
    });

    it('HR + H1 동시 — 둘 다 경계', () => {
        expect(splitIntoSlides('# A\nx\n---\n# B\ny', opts())).toEqual(['# A\nx', '# B\ny']);
    });
});

describe('splitIntoSlides — 빈 슬라이드 스킵(A) + skip 마커(C)', () => {
    it('%%skip%% 마커(라운드트립 안전) 슬라이드 제외', () => {
        expect(
            splitIntoSlides('A\n\n---\n\n%%skip%%\n숨길 내용\n\n---\n\nB', opts()),
        ).toEqual(['A', 'B']);
    });

    it('구형 <!-- skip --> 마커도 하위호환 인식', () => {
        expect(
            splitIntoSlides('A\n\n---\n\n<!-- skip -->\n숨길 내용\n\n---\n\nB', opts()),
        ).toEqual(['A', 'B']);
    });

    it('라운드트립으로 깨진 &lt;!-- skip --&gt; 도 인식', () => {
        expect(
            splitIntoSlides('A\n\n---\n\n&lt;!-- skip --&gt;\n숨길 내용\n\n---\n\nB', opts()),
        ).toEqual(['A', 'B']);
    });

    it('코드블록만 + hideCodeBlock → 빈 슬라이드 스킵', () => {
        const md = 'A\n\n---\n\n```\ncode\n```\n\n---\n\nB';
        expect(splitIntoSlides(md, opts({ hideCodeBlock: true }))).toEqual(['A', 'B']);
    });

    it('hideCodeBlock 꺼짐이면 코드 슬라이드 유지', () => {
        const md = 'A\n\n---\n\n```\ncode\n```\n\n---\n\nB';
        expect(splitIntoSlides(md, opts())).toEqual(['A', '```\ncode\n```', 'B']);
    });

    it('헤딩+코드 슬라이드는 hideCodeBlock 후에도 유지(제목 슬라이드)', () => {
        const md = '## 제목\n```\ncode\n```';
        expect(splitIntoSlides(md, opts({ hideCodeBlock: true }))).toEqual([md]);
    });

    it('이미지만 + hideImage → 빈 스킵', () => {
        const md = 'A\n\n---\n\n![alt](x.png)\n\n---\n\nB';
        expect(splitIntoSlides(md, opts({ hideImage: true }))).toEqual(['A', 'B']);
    });

    it('전부 빈/스킵이면 빈 1장', () => {
        expect(splitIntoSlides('```\ncode\n```', opts({ hideCodeBlock: true }))).toEqual(['']);
    });
});
