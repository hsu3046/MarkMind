/**
 * Flowchart view mode (#46 M3) — 마크다운 문서를 플로우차트로 본다.
 *
 * MindmapView 와 같은 단방향 파생: markdown → documentToTree → mindmapToFlowchart
 * (dagre LR 레이아웃) → React Flow 렌더. 1차는 읽기 전용(편집 없음). BPMN 셰이프는
 * type 별 색/기본 모양으로 시작하고, 정교한 다이아몬드/평행사변형은 ④에서.
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
import '@xyflow/react/dist/style.css';
import './FlowchartView.css';

interface FlowNodeData {
    label: string;
    flowType: string;
    description?: string;
    [key: string]: unknown;
}

/** BPMN-lite 노드 — 1차는 LR 단일 핸들(좌 target / 우 source) + type 별 색. */
function FlowNode({ data }: NodeProps) {
    const d = data as FlowNodeData;
    return (
        <div className={`flow-node flow-node--${d.flowType}`} title={d.description || undefined}>
            <Handle type="target" position={Position.Left} />
            <span className="flow-node__label">{d.label}</span>
            <Handle type="source" position={Position.Right} />
        </div>
    );
}

const nodeTypes = { flow: FlowNode };

function stemOf(fileName: string): string {
    return fileName.replace(/\.(md|markdown|mdx|txt)$/i, '').trim() || 'Untitled';
}

interface FlowchartViewProps {
    content: string;
    fileName: string;
}

function FlowchartViewInner({ content, fileName }: FlowchartViewProps) {
    const stem = useMemo(() => stemOf(fileName), [fileName]);

    const { nodes, edges } = useMemo(() => {
        const { tree } = documentToTree(content, stem);
        const fc = mindmapToFlowchart(tree); // dagre 레이아웃까지 적용된 position 포함
        const rfNodes: Node[] = fc.result.nodes.map((n) => ({
            id: n.id,
            type: 'flow',
            position: n.position,
            data: { label: n.label, flowType: n.type, description: n.description },
        }));
        const rfEdges: Edge[] = fc.result.edges.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            label: e.label,
            // 단일 핸들 연결(1차) — converter 의 right-source/left-target 핸들 id 는
            // decision 다중 핸들(④) 도입 시 함께 매칭한다.
            markerEnd: e.markerEnd !== false ? { type: MarkerType.ArrowClosed } : undefined,
        }));
        return { nodes: rfNodes, edges: rfEdges };
    }, [content, stem]);

    return (
        <ReactFlow
            key={stem}
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
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
