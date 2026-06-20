/**
 * MD 내 ```markmind-flow 코드블록 read/write (#46 M3-A2).
 *
 * MarkMind 는 MD 단일 파일이 SSOT 라, LLM 으로 생성한 플로우차트(비결정적·편집 대상)를
 * 같은 문서 안 fenced code block 에 JSON 으로 보존한다. 표준 코드블록이라 다른 MD
 * 뷰어에서 열어도 렌더만 안 될 뿐 깨지지 않는다(graceful).
 *
 * 위치(position)는 저장하지 않는다 — dagre 가 매번 재계산하므로 블록을 가볍게 유지하고
 * 노드 추가/삭제만 diff 에 남긴다.
 */
import type { FlowchartNode, FlowchartEdge } from '../types/flowchart';

/** 코드블록 1개를 잡는다. info-string 은 markmind-flow 고정(flowchart.js 등과 충돌 회피). */
const FLOW_BLOCK_RE = /```markmind-flow[ \t]*\n([\s\S]*?)\n```/;

export interface StoredFlowchart {
    title?: string;
    /** 레이아웃 방향 — dagre rankdir(LR 가로 / TB 세로). 기본 LR. */
    direction?: 'LR' | 'TB';
    nodes: FlowchartNode[];
    edges: FlowchartEdge[];
}

/** 문서에서 저장된 플로우차트를 읽는다. 없거나 깨졌으면 null(결정적 프리뷰로 폴백). */
export function parseFlowchartBlock(md: string): StoredFlowchart | null {
    const m = md.match(FLOW_BLOCK_RE);
    if (!m) return null;
    try {
        const data = JSON.parse(m[1]);
        if (!Array.isArray(data?.nodes) || !Array.isArray(data?.edges)) return null;
        const direction = data.direction === 'TB' ? 'TB' : data.direction === 'LR' ? 'LR' : undefined;
        return { title: data.title, direction, nodes: data.nodes, edges: data.edges };
    } catch {
        return null;
    }
}

/** markmind-flow 블록 존재 여부 (read-only 뷰의 흐름도 데이터 토글 표시 판단용). */
export function hasFlowchartBlock(md: string): boolean {
    return FLOW_BLOCK_RE.test(md);
}

/**
 * 문서에 플로우차트 블록을 삽입/교체한다.
 * @param keepPosition true 면 노드 position 을 저장(사용자가 드래그로 배치한 자유
 *   레이아웃 보존, Phase 1 편집). 기본 false — AI 생성 직후엔 dagre 가 매번 재계산하도록
 *   블록을 가볍게 유지(position 제외).
 */
export function upsertFlowchartBlock(md: string, fc: StoredFlowchart, keepPosition = false): string {
    const stripped = {
        title: fc.title,
        direction: fc.direction,
        // 나머지(type/label/description/image_* 등)는 항상 보존.
        nodes: keepPosition
            ? fc.nodes
            : fc.nodes.map(({ position: _omit, ...rest }) => rest),
        edges: fc.edges,
    };
    const block = '```markmind-flow\n' + JSON.stringify(stripped, null, 2) + '\n```';
    if (FLOW_BLOCK_RE.test(md)) {
        return md.replace(FLOW_BLOCK_RE, block);
    }
    return md.trimEnd() + '\n\n' + block + '\n';
}

/** 문서에서 플로우차트 블록을 제거(되돌리기/재생성 전 정리용). */
export function removeFlowchartBlock(md: string): string {
    return md.replace(FLOW_BLOCK_RE, '').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
