/**
 * BPMN-lite 노드 type 별 박스 크기(#46 M3). dagre 레이아웃이 노드 공간을 할당할 때와
 * 노드 컴포넌트 렌더가 공유한다. MindBusiness flow-node-base 에서 상수만 추출.
 *
 * minHeight=60 통일 — 가로 행에 섞인 셰이프가 깔끔히 정렬되도록.
 */
import type { FlowNodeType } from '../types/flowchart';

export interface ShapeDimensions {
    minWidth: number;
    minHeight: number;
    maxWidth: number;
}

export const DEFAULT_FLOW_NODE_TYPE: FlowNodeType = 'process';

export const SHAPE_DIMENSIONS: Record<FlowNodeType, ShapeDimensions> = {
    start: { minWidth: 120, minHeight: 60, maxWidth: 240 },
    end: { minWidth: 120, minHeight: 60, maxWidth: 240 },
    process: { minWidth: 160, minHeight: 60, maxWidth: 320 },
    decision: { minWidth: 200, minHeight: 84, maxWidth: 320 },
    merge: { minWidth: 60, minHeight: 60, maxWidth: 160 },
    io: { minWidth: 160, minHeight: 60, maxWidth: 320 },
    // image: 캔버스 최소 footprint. 실제 크기는 image_width/height 로 결정.
    image: { minWidth: 80, minHeight: 60, maxWidth: 800 },
};

export function isFlowNodeType(value: unknown): value is FlowNodeType {
    return typeof value === 'string'
        && Object.prototype.hasOwnProperty.call(SHAPE_DIMENSIONS, value);
}

export function normalizeFlowNodeType(value: unknown): FlowNodeType {
    return isFlowNodeType(value) ? value : DEFAULT_FLOW_NODE_TYPE;
}

export function getShapeDimensions(value: unknown): ShapeDimensions {
    return SHAPE_DIMENSIONS[normalizeFlowNodeType(value)];
}
