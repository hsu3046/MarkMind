import { describe, it, expect } from 'vitest';
import { FRAMEWORKS, frameworkToSkeleton, attachGeneratedSlots, frameworkList } from './frameworks';
import { treeToMarkdown, documentToTree } from './markdownTree';

describe('frameworks 카탈로그', () => {
    it('frameworkList — 기본(basic) 먼저, 고급 나중', () => {
        const list = frameworkList();
        const basicIdx = list.map((f, i) => (f.basic ? i : -1)).filter((i) => i >= 0);
        const advIdx = list.map((f, i) => (!f.basic ? i : -1)).filter((i) => i >= 0);
        expect(Math.max(...basicIdx)).toBeLessThan(Math.min(...advIdx));
    });

    it('모든 프레임워크 — 1개 이상 슬롯 + 슬롯 라벨 고유', () => {
        for (const fw of Object.values(FRAMEWORKS)) {
            expect(fw.slots.length).toBeGreaterThan(0);
            const labels = fw.slots.map((s) => s.label);
            expect(new Set(labels).size).toBe(labels.length);
        }
    });
});

describe('frameworkToSkeleton', () => {
    it('루트=토픽, 슬롯=heading 자식 → `# 토픽` + `## 슬롯`', () => {
        const sk = frameworkToSkeleton('카페 창업', FRAMEWORKS.SWOT);
        expect(sk.label).toBe('카페 창업');
        expect(sk.children).toHaveLength(4);
        const md = treeToMarkdown(sk);
        expect(md).toContain('# 카페 창업');
        expect(md).toContain('## 강점 (Strengths)');
    });

    it('빈 토픽 → 프레임워크 이름으로 폴백', () => {
        const sk = frameworkToSkeleton('   ', FRAMEWORKS.SWOT);
        expect(sk.label).toBe(FRAMEWORKS.SWOT.name);
    });
});

describe('attachGeneratedSlots — slot_label 매칭(L1 드리프트 방지)', () => {
    it('전체/한글/영문 라벨 모두 매칭 + 자식을 list origin 으로 부착', () => {
        const sk = frameworkToSkeleton('테스트', FRAMEWORKS.SWOT);
        attachGeneratedSlots(sk, [
            { slot_label: '강점 (Strengths)', children: [{ label: '브랜드 인지도' }] }, // 전체
            { slot_label: '약점', children: [{ label: '자본 부족' }] }, // 한글만
            { slot_label: 'Opportunities', children: [{ label: '신규 시장' }] }, // 영문만
        ]);
        const byLabel = (l: string) => sk.children.find((c) => c.label.startsWith(l))!;
        expect(byLabel('강점').children.map((c) => c.label)).toEqual(['브랜드 인지도']);
        expect(byLabel('약점').children.map((c) => c.label)).toEqual(['자본 부족']);
        expect(byLabel('기회').children.map((c) => c.label)).toEqual(['신규 시장']);
        expect(byLabel('강점').children[0].mdOrigin).toBe('list');
    });

    it('매칭 안 되는 슬롯·빈 라벨 자식은 폐기', () => {
        const sk = frameworkToSkeleton('테스트', FRAMEWORKS.SWOT);
        attachGeneratedSlots(sk, [
            { slot_label: '존재하지 않는 슬롯', children: [{ label: 'x' }] },
            { slot_label: '강점 (Strengths)', children: [{ label: '  ' }, { label: '유효' }] },
        ]);
        const strengths = sk.children.find((c) => c.label.startsWith('강점'))!;
        expect(strengths.children.map((c) => c.label)).toEqual(['유효']); // 빈 라벨 제외
        // 매칭 안 된 슬롯은 아무 노드에도 안 붙음
        expect(sk.children.filter((c) => !c.label.startsWith('강점')).every((c) => c.children.length === 0)).toBe(true);
    });
});

describe('생성 결과 마크다운 라운드트립(SSOT 계약)', () => {
    it('채운 골격 → treeToMarkdown → documentToTree → treeToMarkdown 멱등(1회 정규화 후)', () => {
        const sk = frameworkToSkeleton('신규 기능', FRAMEWORKS.FIVE_WHYS);
        attachGeneratedSlots(
            sk,
            FRAMEWORKS.FIVE_WHYS.slots.map((s) => ({
                slot_label: s.label,
                children: [{ label: `${s.label} 원인`, description: '한 줄 설명' }],
            })),
        );
        const doc1 = treeToMarkdown(sk);
        const t2 = documentToTree(doc1).tree;
        const doc2 = treeToMarkdown(t2);
        const t3 = documentToTree(doc2).tree;
        expect(treeToMarkdown(t3)).toBe(doc2); // 안정점 도달
    });

    it('메타데이터(applied_framework_id)는 라운드트립에서 소실 — 의도된 계약(결정 2)', () => {
        const sk = frameworkToSkeleton('x', FRAMEWORKS.SWOT);
        expect(sk.applied_framework_id).toBe('SWOT');
        const tree = documentToTree(treeToMarkdown(sk)).tree;
        expect(tree.applied_framework_id).toBeUndefined();
    });
});
