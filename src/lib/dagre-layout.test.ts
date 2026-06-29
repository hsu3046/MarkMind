import { describe, expect, it } from 'vitest';
import { assignFlowchartEdgeHandles } from './dagre-layout';
import type { FlowchartEdge, FlowchartNode } from '../types/flowchart';

describe('assignFlowchartEdgeHandles', () => {
    it('routes LR branch edges from the nearest vertical side instead of wrapping right-to-left', () => {
        const nodes: FlowchartNode[] = [
            { id: 'start', type: 'start', label: 'Draft 작성', position: { x: 0, y: 0 } },
            { id: 'review', type: 'process', label: '리뷰 요청', position: { x: 260, y: 0 } },
            { id: 'approved', type: 'decision', label: '승인?', position: { x: 520, y: 0 } },
            { id: 'revise', type: 'process', label: '수정 반영', position: { x: 520, y: 190 } },
            { id: 'publish', type: 'end', label: '게시', position: { x: 790, y: 0 } },
        ];
        const edges: FlowchartEdge[] = [
            { id: 'e-start-review', source: 'start', target: 'review' },
            { id: 'e-review-approved', source: 'review', target: 'approved' },
            { id: 'e-approved-publish', source: 'approved', target: 'publish', label: 'Yes' },
            { id: 'e-approved-revise', source: 'approved', target: 'revise', label: 'No' },
            { id: 'e-revise-review', source: 'revise', target: 'review', label: '재검토', markerLoop: true },
        ];

        const routed = assignFlowchartEdgeHandles(edges, nodes, 'LR');
        const byId = new Map(routed.map((edge) => [edge.id, edge]));

        expect(byId.get('e-approved-publish')).toMatchObject({
            sourceHandle: 'right-source',
            targetHandle: 'left-target',
        });
        expect(byId.get('e-approved-revise')).toMatchObject({
            sourceHandle: 'bottom-source',
            targetHandle: 'top-target',
        });
        expect(byId.get('e-revise-review')).toMatchObject({
            sourceHandle: 'top-source',
            targetHandle: 'top-target',
        });
    });
});
