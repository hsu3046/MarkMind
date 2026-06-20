/**
 * 사고/비즈니스 프레임워크 카탈로그 (MindBusiness `framework_templates.json` 이식).
 *
 * 각 프레임워크는 L1 "슬롯"(heading 라벨 + 가이드 질문)의 집합 = 마인드맵 골격이다.
 * MindBusiness 의 `{ID}_{INTENT}` 4중 폭증(22개)을 **id당 1개 canonical 슬롯셋**으로 축약하고,
 * intent 는 별도 파라미터로 생성 프롬프트의 톤만 조정한다(여기 intent 는 대표값/표시용).
 *
 * MarkMind 는 마크다운=단일 진실이라, 슬롯은 그대로 `## 라벨` 헤딩으로 직렬화되고
 * AI 가 채운 자식은 그 아래 불릿이 된다. semantic_type/importance 는 저장하지 않는다(라운드트립 소실).
 */

import type { MindmapNode } from '../types/mindmap';

export type FrameworkIntent = 'creation' | 'diagnosis' | 'choice' | 'strategy';

export interface FrameworkSlot {
    /** L1 heading 라벨 — `## label` 로 직렬화. */
    label: string;
    /** 가이드 질문(AI 프롬프트 힌트 + 피커 카드 부제). */
    display: string;
}

export interface Framework {
    id: string;
    name: string;
    /** 대표 intent(프롬프트 톤 기본값). */
    intent: FrameworkIntent;
    /** 한 줄 설명(피커 + auto-select 프롬프트). */
    description: string;
    slots: FrameworkSlot[];
    /** true = 범용 사고도구(전면 노출), false = 비즈니스(접기). */
    general: boolean;
}

export const FRAMEWORKS: Record<string, Framework> = {
    // ─── 범용 사고도구 (general: true) ───
    LOGIC: {
        id: 'LOGIC',
        name: '5W1H (육하원칙)',
        intent: 'diagnosis',
        description: '누가·언제·어디서·무엇을·어떻게·왜 — 주제를 육하원칙으로 빠짐없이 분해',
        general: true,
        slots: [
            { label: '누가 (Who)', display: '누가 연관되어 있나?' },
            { label: '언제 (When)', display: '언제 일어나나/끝내나?' },
            { label: '어디서 (Where)', display: '어디서 벌어지나?' },
            { label: '무엇을 (What)', display: '구체적으로 무엇인가?' },
            { label: '어떻게 (How)', display: '어떤 방법으로?' },
            { label: '왜 (Why)', display: '왜 중요/발생하나?' },
        ],
    },
    FIVE_WHYS: {
        id: 'FIVE_WHYS',
        name: '5 Whys (근본 원인)',
        intent: 'diagnosis',
        description: '"왜?"를 다섯 번 물어 표면 증상에서 근본 원인까지 파고든다',
        general: true,
        slots: [
            { label: '1차 왜', display: '왜 그런 문제가 생겼나?' },
            { label: '2차 왜', display: '그건 또 왜 그랬나?' },
            { label: '3차 왜', display: '어디서부터 꼬였나?' },
            { label: '4차 왜', display: '시스템은 왜 못 막았나?' },
            { label: '5차 왜 (근본)', display: '진짜 근본 원인은?' },
        ],
    },
    CAUSE: {
        id: 'CAUSE',
        name: '피쉬본 (특성요인도)',
        intent: 'diagnosis',
        description: '문제의 원인을 사람·방법·환경·자원 네 갈래로 분해',
        general: true,
        slots: [
            { label: '사람 (People)', display: '사람/조직의 문제는?' },
            { label: '방법 (Methods)', display: '프로세스/방식의 문제는?' },
            { label: '환경 (Environment)', display: '환경/분위기의 문제는?' },
            { label: '자원 (Materials)', display: '도구/예산의 문제는?' },
        ],
    },
    PROS_CONS: {
        id: 'PROS_CONS',
        name: '장단점 분석',
        intent: 'choice',
        description: '선택지의 이득·손해·보완책·결론을 정리',
        general: true,
        slots: [
            { label: '장점 (Pros)', display: '선택하면 무엇이 좋은가?' },
            { label: '단점 (Cons)', display: '무엇을 감수해야 하나?' },
            { label: '보완책', display: '단점을 어떻게 줄이나?' },
            { label: '결론', display: '그래서 할 만한가?' },
        ],
    },
    SCAMPER: {
        id: 'SCAMPER',
        name: 'SCAMPER (발상)',
        intent: 'creation',
        description: '대체·결합·응용·변형·전용·제거·역발상으로 아이디어 확장',
        general: true,
        slots: [
            { label: '대체 (Substitute)', display: '무엇을 다른 걸로 바꿀까?' },
            { label: '결합 (Combine)', display: '무엇과 합칠까?' },
            { label: '응용 (Adapt)', display: '어디서 힌트를 빌릴까?' },
            { label: '변형 (Modify)', display: '모양/성질을 비틀면?' },
            { label: '전용 (Put to other use)', display: '다른 용도로 쓰면?' },
            { label: '제거 (Eliminate)', display: '과감히 뺄 것은?' },
            { label: '역발상 (Reverse)', display: '거꾸로/순서를 뒤집으면?' },
        ],
    },
    EISENHOWER: {
        id: 'EISENHOWER',
        name: '아이젠하워 매트릭스',
        intent: 'choice',
        description: '긴급도 × 중요도로 할 일을 4분면으로 분류',
        general: true,
        slots: [
            { label: '즉시 (긴급·중요)', display: '지금 당장 할 일은?' },
            { label: '계획 (중요·여유)', display: '미리 챙길 중요한 일은?' },
            { label: '위임 (긴급·덜 중요)', display: '누구에게 넘길까?' },
            { label: '제거 (덜 긴급·덜 중요)', display: '버릴 일은?' },
        ],
    },
    KPT: {
        id: 'KPT',
        name: 'KPT 회고',
        intent: 'strategy',
        description: '유지할 것 · 문제점 · 새로 시도할 것으로 회고',
        general: true,
        slots: [
            { label: '유지 (Keep)', display: '잘해서 계속할 것은?' },
            { label: '문제 (Problem)', display: '아쉬웠던 것은?' },
            { label: '시도 (Try)', display: '다음에 새로 해볼 것은?' },
        ],
    },
    OKR: {
        id: 'OKR',
        name: 'OKR (목표·핵심결과)',
        intent: 'strategy',
        description: '가슴 뛰는 목표와 그것을 측정할 핵심 결과·실행',
        general: true,
        slots: [
            { label: '목표 (Objective)', display: '도달하고 싶은 정성적 목표는?' },
            { label: '핵심결과 1 (KR)', display: '성공을 보여줄 첫 번째 숫자는?' },
            { label: '핵심결과 2 (KR)', display: '성공을 보여줄 두 번째 숫자는?' },
            { label: '실행 (Initiative)', display: '내일부터 당장 할 일은?' },
        ],
    },
    PERSONA: {
        id: 'PERSONA',
        name: '페르소나',
        intent: 'creation',
        description: '대상 인물의 프로필·니즈·불편·행동·계기를 구체화',
        general: true,
        slots: [
            { label: '프로필 (Profile)', display: '그 사람은 누구인가?' },
            { label: '니즈 (Needs)', display: '간절히 원하는 것은?' },
            { label: '불편 (Pain Points)', display: '무엇이 그를 괴롭히나?' },
            { label: '행동 (Behavior)', display: '정보 습득/소비 습관은?' },
            { label: '계기 (Trigger)', display: '우리를 찾게 되는 순간은?' },
        ],
    },
    DECISION_MATRIX: {
        id: 'DECISION_MATRIX',
        name: '의사결정 매트릭스',
        intent: 'choice',
        description: '선택지를 비용·효과 기준으로 비교 평가',
        general: true,
        slots: [
            { label: '선택지 A', display: '1안의 장점과 평가는?' },
            { label: '선택지 B', display: '2안의 장점과 평가는?' },
            { label: '비용/노력', display: '가성비는 어느 쪽?' },
            { label: '기대 효과', display: '효과가 큰 쪽은?' },
        ],
    },
    PROCESS: {
        id: 'PROCESS',
        name: '프로세스 (PDCA)',
        intent: 'strategy',
        description: '주제를 준비 → 실행 → 점검 → 개선 단계로 분해',
        general: true,
        slots: [
            { label: '준비 (Plan)', display: '무엇을 어떻게 계획하나?' },
            { label: '실행 (Do)', display: '실제로 무엇을 하나?' },
            { label: '점검 (Check)', display: '무엇으로 결과를 확인하나?' },
            { label: '개선 (Act)', display: '무엇을 다음에 고치나?' },
        ],
    },

    // ─── 비즈니스 (general: false, 접기) ───
    SWOT: {
        id: 'SWOT',
        name: 'SWOT 분석',
        intent: 'diagnosis',
        description: '강점·약점·기회·위협 — 내부/외부 요인 진단',
        general: false,
        slots: [
            { label: '강점 (Strengths)', display: '우리의 확실한 무기는?' },
            { label: '약점 (Weaknesses)', display: '부족하거나 취약한 점은?' },
            { label: '기회 (Opportunities)', display: '시장의 빈틈/기회는?' },
            { label: '위협 (Threats)', display: '가장 걱정되는 위협은?' },
        ],
    },
    BMC: {
        id: 'BMC',
        name: '비즈니스 모델 캔버스',
        intent: 'creation',
        description: '9개 블록으로 비즈니스 모델을 한눈에 설계',
        general: false,
        slots: [
            { label: '가치 제안 (Value)', display: '고객에게 줄 핵심 가치는?' },
            { label: '고객 세그먼트', display: '누구를 위한 것인가?' },
            { label: '채널 (Channels)', display: '어디서 고객을 만나나?' },
            { label: '고객 관계', display: '관계를 어떻게 유지하나?' },
            { label: '수익원 (Revenue)', display: '돈을 어떻게 버나?' },
            { label: '핵심 자원', display: '꼭 필요한 자원은?' },
            { label: '핵심 활동', display: '매일 해야 할 일은?' },
            { label: '핵심 파트너', display: '누가 도와주나?' },
            { label: '비용 구조 (Cost)', display: '돈은 어디에 쓰나?' },
        ],
    },
    LEAN: {
        id: 'LEAN',
        name: '린 캔버스',
        intent: 'creation',
        description: '스타트업 아이디어를 9칸으로 빠르게 검증',
        general: false,
        slots: [
            { label: '문제 (Problem)', display: '해결할 진짜 문제 Top 3는?' },
            { label: '고객 세그먼트', display: '누가 가장 힘들어하나?' },
            { label: '가치 제안 (UVP)', display: '한 줄 차별점은?' },
            { label: '해결책 (Solution)', display: '핵심 기능은?' },
            { label: '경쟁 우위', display: '쉽게 못 따라하는 무기는?' },
            { label: '수익원 (Revenue)', display: '수익은 어디서?' },
            { label: '비용 (Cost)', display: '비용은 얼마나?' },
            { label: '핵심 지표', display: '성공을 가르는 숫자는?' },
            { label: '채널 (Channels)', display: '어떻게 알리나?' },
        ],
    },
    PESTEL: {
        id: 'PESTEL',
        name: 'PESTEL 분석',
        intent: 'strategy',
        description: '정치·경제·사회·기술·환경·법 거시환경 분석',
        general: false,
        slots: [
            { label: '정치 (Political)', display: '정책/규제 이슈는?' },
            { label: '경제 (Economic)', display: '경기/시장 상황은?' },
            { label: '사회 (Social)', display: '유행/가치관 변화는?' },
            { label: '기술 (Technological)', display: '기술 변화/구현성은?' },
            { label: '환경 (Environmental)', display: '환경/지속가능성 이슈는?' },
            { label: '법 (Legal)', display: '법적 리스크는?' },
        ],
    },
};

/** 범용 먼저, 그다음 비즈니스 — 카탈로그를 그룹 순서로 나열(피커용). */
export function frameworkList(): Framework[] {
    const all = Object.values(FRAMEWORKS);
    return [...all.filter((f) => f.general), ...all.filter((f) => !f.general)];
}

/**
 * 토픽 + 프레임워크 → 빈 골격 트리(루트=토픽, 슬롯=heading 자식).
 * 생성 결과 조립(generateFrameworkMindmap)·미리보기 공용. 슬롯은 mdOrigin:'heading' →
 * treeToMarkdown 에서 `## 라벨`(부모 H1 아래 H2)로 직렬화된다.
 */
export function frameworkToSkeleton(topic: string, fw: Framework): MindmapNode {
    return {
        id: '',
        label: topic.trim() || fw.name,
        type: 'root',
        mdOrigin: 'root',
        applied_framework_id: fw.id,
        children: fw.slots.map((s) => ({
            id: '',
            label: s.label,
            type: 'sub_branch',
            mdOrigin: 'heading' as const,
            children: [] as MindmapNode[],
        })),
    };
}

/** generateFrameworkMindmap 의 LLM 출력 한 슬롯. */
export interface GeneratedSlot {
    slot_label?: string;
    children?: Array<{ label?: string; description?: string }>;
}

/**
 * LLM 슬롯 출력을 골격 헤딩에 부착(slot_label 매칭, 미매칭 폐기) — 골격이 진실, L1 드리프트 방지.
 * 매칭은 전체 라벨/한글/영문 모두 허용("강점 (Strengths)" ↔ "강점" ↔ "Strengths"). 골격을 변형 후 반환.
 * 자식은 mdOrigin:'list' 로 부착 → 헤딩 슬롯 아래 불릿으로 직렬화. 순수 함수(테스트 가능).
 */
export function attachGeneratedSlots(skeleton: MindmapNode, slots: GeneratedSlot[]): MindmapNode {
    const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '');
    const bySlot = new Map<string, MindmapNode>();
    for (const node of skeleton.children) {
        const full = node.label.trim();
        bySlot.set(key(full), node);
        const m = full.match(/^(.*?)\s*\((.*?)\)\s*$/);
        if (m) {
            if (m[1].trim()) bySlot.set(key(m[1]), node);
            if (m[2].trim()) bySlot.set(key(m[2]), node);
        }
    }
    const lookup = (raw: string): MindmapNode | undefined => {
        if (!raw) return undefined;
        const direct = bySlot.get(key(raw));
        if (direct) return direct;
        const m = raw.match(/^(.*?)\s*\((.*?)\)\s*$/);
        if (m) return bySlot.get(key(m[1])) ?? bySlot.get(key(m[2]));
        return undefined;
    };
    for (const s of slots ?? []) {
        const target = lookup((s.slot_label ?? '').trim());
        if (!target) continue; // 매칭 안 되는 슬롯 폐기(LLM 이 L1 을 개명/추가해도 무시)
        for (const c of s.children ?? []) {
            const label = (c.label ?? '').trim();
            if (!label) continue;
            target.children.push({
                id: '',
                label,
                type: 'sub_branch',
                mdOrigin: 'list',
                description: c.description?.trim() || undefined,
                children: [],
            });
        }
    }
    return skeleton;
}
