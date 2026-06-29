import { describe, expect, it } from 'vitest';
import type { FlowNodeType } from '../../types/flowchart';
import type { StoredFlowchart } from '../flowchartBlock';
import { flowchartToSvgSnapshot } from './flowchartSvgSnapshot';

function decodeSvg(dataUrl: string): string {
  return decodeURIComponent(dataUrl.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''));
}

describe('flowchartToSvgSnapshot', () => {
  it('renders a print-safe flowchart SVG with intact labels and padding', () => {
    const flowchart: StoredFlowchart = {
      title: '문서 작성 승인 흐름',
      direction: 'LR',
      nodes: [
        { id: 'start', type: 'start', label: 'Draft 작성', position: { x: 0, y: 0 } },
        { id: 'review', type: 'process', label: '리뷰 요청', position: { x: 260, y: 0 } },
        { id: 'approved', type: 'decision', label: '승인?', position: { x: 520, y: 0 } },
        { id: 'revise', type: 'process', label: '수정 반영', position: { x: 520, y: 190 } },
        { id: 'publish', type: 'end', label: '게시', position: { x: 790, y: 0 } },
      ],
      edges: [
        { id: 'e-start-review', source: 'start', target: 'review' },
        { id: 'e-review-approved', source: 'review', target: 'approved' },
        { id: 'e-approved-publish', source: 'approved', target: 'publish', label: 'Yes' },
        { id: 'e-approved-revise', source: 'approved', target: 'revise', label: 'No' },
        { id: 'e-revise-review', source: 'revise', target: 'review', label: '재검토', markerLoop: true },
      ],
    };

    const snapshot = flowchartToSvgSnapshot(flowchart);
    const svg = decodeSvg(snapshot.dataUrl);
    const viewBox = /viewBox="([-.\d]+) ([-.\d]+) ([-.\d]+) ([-.\d]+)"/.exec(svg);

    expect(snapshot.title).toBe('문서 작성 승인 흐름');
    expect(snapshot.width).toBeGreaterThan(900);
    expect(snapshot.height).toBeGreaterThan(260);
    expect(svg).toContain('Draft 작성');
    expect(svg).toContain('승인?');
    expect(svg).toContain('재검토');
    expect(svg).toContain('M 520 42 C 520 98, 520 104, 520 160');
    expect(svg).toContain('marker-end="url(#flowchart-arrow-end)"');
    expect(viewBox?.[3]).toBe(String(snapshot.width));
    expect(viewBox?.[4]).toBe(String(snapshot.height));
  });

  it('renders unknown node types as process nodes instead of throwing', () => {
    const flowchart: StoredFlowchart = {
      title: 'Legacy flow',
      direction: 'LR',
      nodes: [
        { id: 'legacy', type: 'legacy-task' as FlowNodeType, label: 'Legacy task', position: { x: 0, y: 0 } },
      ],
      edges: [],
    };

    const snapshot = flowchartToSvgSnapshot(flowchart);
    const svg = decodeSvg(snapshot.dataUrl);

    expect(svg).toContain('Legacy task');
    expect(svg).toContain('rx="8" fill="#ffffff"');
  });
});
