import { useMemo } from 'react';
import {
  NodeViewContent,
  NodeViewWrapper,
  type NodeViewProps,
} from '@tiptap/react';
import {
  Background,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { assignFlowchartEdgeHandles, layoutFlowchart } from '../lib/dagre-layout';
import type { StoredFlowchart } from '../lib/flowchartBlock';
import { SHAPE_DIMENSIONS } from '../lib/flowchart-shapes';
import type { FlowchartEdge, FlowchartNode } from '../types/flowchart';
import '@xyflow/react/dist/style.css';
import './FlowchartView.css';
import './FlowchartRichBlock.css';

interface FlowNodeData {
  label: string;
  flowType: string;
  description?: string;
  [key: string]: unknown;
}

function RichFlowNode({ data }: NodeProps) {
  const d = data as FlowNodeData;
  return (
    <div
      className={`flow-node flow-node--${d.flowType}`}
      title={d.description || undefined}
    >
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

const richNodeTypes = { flow: RichFlowNode };
const RICH_CANVAS_MIN_HEIGHT = 360;
const RICH_CANVAS_MAX_HEIGHT = 720;
const RICH_CANVAS_VERTICAL_PADDING = 180;

function parseStoredFlowchartJson(code: string): StoredFlowchart | null {
  try {
    const data = JSON.parse(code);
    if (!Array.isArray(data?.nodes) || !Array.isArray(data?.edges)) return null;
    const direction = data.direction === 'TB' ? 'TB' : data.direction === 'LR' ? 'LR' : undefined;
    return {
      title: typeof data.title === 'string' ? data.title : undefined,
      direction,
      nodes: data.nodes as FlowchartNode[],
      edges: data.edges as FlowchartEdge[],
    };
  } catch {
    return null;
  }
}

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
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      type: 'smoothstep',
      pathOptions: e.markerLoop ? { offset: 48 } : undefined,
      label: e.label,
      markerStart: e.markerStart ? { type: MarkerType.ArrowClosed } : undefined,
      markerEnd: e.markerEnd !== false ? { type: MarkerType.ArrowClosed } : undefined,
    })),
  };
}

function buildFlowchartGraph(flowchart: StoredFlowchart): {
  graph: { nodes: Node[]; edges: Edge[] };
  canvasHeight: number;
} {
  const rankdir = flowchart.direction ?? 'LR';
  const seeded = flowchart.nodes.map((node) => ({
    ...node,
    position: node.position ?? { x: 0, y: 0 },
  }));
  const layouted = layoutFlowchart(seeded, flowchart.edges, { rankdir });
  const merged = layouted.nodes.map((node) => {
    const stored = flowchart.nodes.find((item) => item.id === node.id);
    return stored?.position ? { ...node, position: stored.position } : node;
  });
  const edges = assignFlowchartEdgeHandles(layouted.edges, merged, rankdir);
  const canvasHeight = preferredCanvasHeight(merged, edges, rankdir);
  return { graph: toReactFlow(merged, edges), canvasHeight };
}

function preferredCanvasHeight(
  nodes: FlowchartNode[],
  edges: FlowchartEdge[],
  rankdir: 'LR' | 'TB',
): number {
  if (nodes.length === 0) return RICH_CANVAS_MIN_HEIGHT;

  let minY = Infinity;
  let maxY = -Infinity;
  const byId = new Map(nodes.map((node) => [node.id, node]));

  for (const node of nodes) {
    const dim = SHAPE_DIMENSIONS[node.type];
    const height = node.type === 'image'
      ? (node.image_height ?? dim.minHeight)
      : dim.minHeight;
    minY = Math.min(minY, node.position.y - height / 2);
    maxY = Math.max(maxY, node.position.y + height / 2);
  }

  for (const edge of edges) {
    if (!edge.markerLoop || rankdir !== 'LR') continue;
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) continue;
    minY = Math.min(minY, Math.min(source.position.y, target.position.y) - 96);
  }

  const span = Number.isFinite(minY) ? maxY - minY : RICH_CANVAS_MIN_HEIGHT;
  return Math.max(
    RICH_CANVAS_MIN_HEIGHT,
    Math.min(RICH_CANVAS_MAX_HEIGHT, Math.ceil(span + RICH_CANVAS_VERTICAL_PADDING)),
  );
}

function FlowchartPreview({ flowchart }: { flowchart: StoredFlowchart }) {
  const { graph } = useMemo(() => buildFlowchartGraph(flowchart), [flowchart]);

  return (
    <ReactFlowProvider>
      <ReactFlow
        nodes={graph.nodes}
        edges={graph.edges}
        nodeTypes={richNodeTypes}
        nodeOrigin={[0.5, 0.5]}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        fitView
        fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
        minZoom={0.1}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} />
      </ReactFlow>
    </ReactFlowProvider>
  );
}

export function FlowchartCodeBlockNodeView({ node }: NodeViewProps) {
  const language = typeof node.attrs.language === 'string' ? node.attrs.language : '';
  const isFlowchart = language.trim() === 'markmind-flow';
  const code = node.textContent;
  const flowchart = useMemo(
    () => (isFlowchart ? parseStoredFlowchartJson(code) : null),
    [code, isFlowchart],
  );
  const canvasHeight = useMemo(
    () => (flowchart ? buildFlowchartGraph(flowchart).canvasHeight : undefined),
    [flowchart],
  );

  if (!isFlowchart) {
    return (
      <NodeViewWrapper className="rich-code-block">
        <pre className={language ? `hljs language-${language}` : 'hljs'}>
          <NodeViewContent className="rich-code-block__content" />
        </pre>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="rich-flowchart-block" data-flowchart-json={code}>
      <div className="rich-flowchart-block__header" contentEditable={false}>
        <span className="rich-flowchart-block__title">
          {flowchart?.title || 'Flowchart'}
        </span>
      </div>
      <div
        className="rich-flowchart-block__canvas flowchart-view"
        contentEditable={false}
        style={canvasHeight ? { height: canvasHeight } : undefined}
      >
        {flowchart ? (
          <FlowchartPreview flowchart={flowchart} />
        ) : (
          <div className="rich-flowchart-block__error">
            Flowchart JSON을 읽을 수 없습니다. 아래 Source를 열어 원문을 확인하세요.
          </div>
        )}
      </div>
      <NodeViewContent className="rich-flowchart-block__content-host" />
    </NodeViewWrapper>
  );
}
