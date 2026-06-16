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

import { useMemo, useState } from 'react';
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
import { Sparkles, Loader2 } from 'lucide-react';
import { documentToTree } from '../lib/markdownTree';
import { mindmapToFlowchart } from '../lib/flowchart-converter';
import { layoutFlowchart } from '../lib/dagre-layout';
import { parseFlowchartBlock, upsertFlowchartBlock } from '../lib/flowchartBlock';
import { generateFlowchart } from '../services/aiService';
import type { FlowchartNode, FlowchartEdge } from '../types/flowchart';
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
            <Handle type="target" position={Position.Left} />
            <span className="flow-node__label">{d.label}</span>
            <Handle type="source" position={Position.Right} />
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
}

function FlowchartViewInner({ content, fileName, onChange }: FlowchartViewProps) {
    const stem = useMemo(() => stemOf(fileName), [fileName]);
    const [generating, setGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const { nodes, edges, isAi } = useMemo(() => {
        const stored = parseFlowchartBlock(content);
        if (stored) {
            // 저장된 AI 흐름도 — position 없으니 dagre LR 재계산
            const seeded = stored.nodes.map((n) => ({ ...n, position: n.position ?? { x: 0, y: 0 } }));
            const lo = layoutFlowchart(seeded, stored.edges, { rankdir: 'LR' });
            return { ...toReactFlow(lo.nodes, lo.edges), isAi: true };
        }
        // 구조 미러 프리뷰
        const { tree } = documentToTree(content, stem);
        const fc = mindmapToFlowchart(tree);
        return { ...toReactFlow(fc.result.nodes, fc.result.edges), isAi: false };
    }, [content, stem]);

    const handleGenerate = async () => {
        setGenerating(true);
        setError(null);
        try {
            const fc = await generateFlowchart(content);
            onChange(upsertFlowchartBlock(content, fc)); // MD 에 저장 → 재파싱되어 AI 흐름도로 표시
        } catch (e) {
            setError(e instanceof Error ? e.message : '플로우차트 생성에 실패했습니다.');
        } finally {
            setGenerating(false);
        }
    };

    return (
        <div className="flowchart-view">
            <div className="flowchart-toolbar">
                <span className="flowchart-mode">
                    {isAi ? '🔀 AI 생성 흐름도' : '⊟ 구조 미러 (마인드맵과 동형 프리뷰)'}
                </span>
                <button className="flowchart-gen-btn" onClick={handleGenerate} disabled={generating}>
                    {generating ? <Loader2 size={14} className="spinning" /> : <Sparkles size={14} />}
                    {generating ? '생성 중…' : isAi ? 'AI 재생성' : 'AI 로 흐름도 생성'}
                </button>
            </div>
            {error && <div className="flowchart-error">{error}</div>}
            <div className="flowchart-canvas">
                <ReactFlow
                    key={`${stem}-${isAi}`}
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
            </div>
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
