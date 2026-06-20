/**
 * Flowchart view mode (#46 M3).
 *
 * 두 소스를 렌더한다:
 *  1) 저장된 AI 흐름도 — 문서의 ```markmind-flow 코드블록(parseFlowchartBlock).
 *     LLM 이 프로세스(절차)로 재해석한 BPMN-lite. position 은 없으니 dagre 재계산.
 *  2) 구조 미러(프리뷰) — 코드블록이 없으면 documentToTree → mindmapToFlowchart.
 *     마인드맵과 동형(트리). "AI 로 흐름도 생성" 으로 1)을 만들 수 있다.
 *
 * 'AI 생성' 은 generateFlowchart → upsertFlowchartBlock → onChange 로 MD 에 저장한다
 * (MD 단일 SSOT). 렌더는 읽기 전용(노드 드래그/편집은 후속).
 */

import { useMemo } from 'react';
import {
    ReactFlow,
    ReactFlowProvider,
    Background,
    Controls,
    Handle,
    Position,
    MarkerType,
    type Node,
    type Edge,
    type NodeProps,
} from '@xyflow/react';
import { documentToTree } from '../lib/markdownTree';
import { mindmapToFlowchart } from '../lib/flowchart-converter';
import { layoutFlowchart } from '../lib/dagre-layout';
import { parseFlowchartBlock, upsertFlowchartBlock } from '../lib/flowchartBlock';
import type { FlowchartNode, FlowchartEdge } from '../types/flowchart';
import { FlowchartPanel } from './FlowchartPanel';
import '@xyflow/react/dist/style.css';
import './FlowchartView.css';

interface FlowNodeData {
    label: string;
    flowType: string;
    description?: string;
    [key: string]: unknown;
}

function FlowNode({ data }: NodeProps) {
    const d = data as FlowNodeData;
    return (
        <div className={`flow-node flow-node--${d.flowType}`} title={d.description || undefined}>
            {/* dagre-layout 이 지정하는 source/targetHandle(id) 과 매칭 — forward(LR=right/left, TB=bottom/top)
                + loop(LR=top, TB=left). markerLoop(retry)가 top handle 로 위로 빠져나가 명확한 arc 가 된다. */}
            <Handle type="source" position={Position.Right} id="right-source" />
            <Handle type="target" position={Position.Right} id="right-target" />
            <Handle type="source" position={Position.Left} id="left-source" />
            <Handle type="target" position={Position.Left} id="left-target" />
            <Handle type="source" position={Position.Top} id="top-source" />
            <Handle type="target" position={Position.Top} id="top-target" />
            <Handle type="source" position={Position.Bottom} id="bottom-source" />
            <Handle type="target" position={Position.Bottom} id="bottom-target" />
            <span className="flow-node__label">{d.label}</span>
        </div>
    );
}

const nodeTypes = { flow: FlowNode };

/** FlowchartNode/Edge → React Flow Node/Edge. */
function toReactFlow(nodes: FlowchartNode[], edges: FlowchartEdge[]): { nodes: Node[]; edges: Edge[] } {
    return {
        nodes: nodes.map((n) => ({
            id: n.id,
            type: 'flow',
            position: n.position,
            data: { label: n.label, flowType: n.type, description: n.description },
        })),
        edges: edges.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            // dagre-layout 이 방향(forward=right/left, loop=top/left)에 맞춰 지정한 handle id —
            // 이걸 넘겨야 markerLoop(retry)가 노드 위쪽 handle 로 빠져 arc 가 된다.
            // (누락하면 React Flow 가 기본 handle 로 떨어져 메인 흐름과 겹쳐 직선처럼 보임)
            sourceHandle: e.sourceHandle,
            targetHandle: e.targetHandle,
            // smoothstep: 같은 높이(일직선 구간)는 곧은 직선, 높이가 다르면(분기·loop) 직각 ㄷ 자.
            // → forward 일직선=직선, decision 분기·markerLoop(retry)=직각으로 통일(bezier 곡선 제거).
            type: 'smoothstep',
            // markerLoop(retry)는 메인 흐름 위를 가로지르는 ㄷ자라 offset(노드 top↔첫 꺾임
            // 거리)을 키워 위로 더 띄운다. 기본 20 은 노드 윗변에 바싹 붙어 답답하다.
            pathOptions: e.markerLoop ? { offset: 48 } : undefined,
            label: e.label,
            markerEnd: e.markerEnd !== false ? { type: MarkerType.ArrowClosed } : undefined,
        })),
    };
}

function stemOf(fileName: string): string {
    return fileName.replace(/\.(md|markdown|mdx|txt)$/i, '').trim() || 'Untitled';
}

interface FlowchartViewProps {
    content: string;
    fileName: string;
    onChange: (md: string) => void;
    /** 모달(FlowchartPanel) 열림 — 메인 툴바 "플로우차트 생성" 클릭을 App 이 토글. */
    flowchartPanelOpen?: boolean;
    onCloseFlowchartPanel?: () => void;
}

function FlowchartViewInner({ content, fileName, onChange, flowchartPanelOpen, onCloseFlowchartPanel }: FlowchartViewProps) {
    const stem = useMemo(() => stemOf(fileName), [fileName]);

    const { nodes, edges, isAi } = useMemo(() => {
        const stored = parseFlowchartBlock(content);
        if (stored) {
            // 저장된 AI 흐름도 — position 없으니 dagre LR 재계산
            const seeded = stored.nodes.map((n) => ({ ...n, position: n.position ?? { x: 0, y: 0 } }));
            const lo = layoutFlowchart(seeded, stored.edges, { rankdir: stored.direction ?? 'LR' });
            return { ...toReactFlow(lo.nodes, lo.edges), isAi: true };
        }
        // 구조 미러 프리뷰
        const { tree } = documentToTree(content, stem);
        const fc = mindmapToFlowchart(tree);
        return { ...toReactFlow(fc.result.nodes, fc.result.edges), isAi: false };
    }, [content, stem]);

    return (
        <div className="flowchart-view">
            <div className="flowchart-canvas">
                <ReactFlow
                    key={`${stem}-${isAi}`}
                    nodes={nodes}
                    edges={edges}
                    nodeTypes={nodeTypes}
                    // dagre-layout 이 position 을 노드 '중심' 으로 계산하므로 nodeOrigin 도
                    // center 여야 한다. 누락 시 React Flow 가 기본 [0,0](top-left)로 해석해
                    // 노드 높이가 다른 연결(process↔decision)에서 handle y 가 어긋나 edge 가
                    // 직선이 아니라 꺾인다(같은 높이끼리는 안 어긋나 못 알아챘던 버그).
                    nodeOrigin={[0.5, 0.5]}
                    nodesDraggable={false}
                    nodesConnectable={false}
                    elementsSelectable
                    fitView
                    fitViewOptions={{ padding: 0.2, maxZoom: 1.2 }}
                    minZoom={0.1}
                    maxZoom={2.5}
                    proOptions={{ hideAttribution: true }}
                >
                    <Background gap={20} size={1} />
                    <Controls showInteractive={false} />
                </ReactFlow>
            </div>
            {flowchartPanelOpen && (
                <FlowchartPanel
                    content={content}
                    onApply={(fc) => onChange(upsertFlowchartBlock(content, fc))}
                    onClose={() => onCloseFlowchartPanel?.()}
                />
            )}
        </div>
    );
}

export function FlowchartView(props: FlowchartViewProps) {
    return (
        <div style={{ flex: 1, width: '100%', height: '100%', minWidth: 0, minHeight: 0 }}>
            <ReactFlowProvider>
                <FlowchartViewInner {...props} />
            </ReactFlowProvider>
        </div>
    );
}
