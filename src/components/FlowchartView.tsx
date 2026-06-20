/**
 * Flowchart view mode (#46 M3).
 *
 * 두 소스를 렌더한다:
 *  1) 저장된 AI 흐름도 — 문서의 ```markmind-flow 코드블록(parseFlowchartBlock).
 *  2) 구조 미러(프리뷰) — 코드블록이 없으면 documentToTree → mindmapToFlowchart.
 *
 * 편집(Phase 1): content→nodes/edges 단방향 동기화 + 편집(드래그/라벨/추가/삭제/연결)은
 * commit→upsert→onChange 로 SSOT(markmind-flow)에 되쓰기. 자기 편집이 일으킨 content
 * 변경은 lastEmittedRef 로 재동기화를 건너뛰고, commit 시 setRf*로 즉시 반영(MindmapView 패턴).
 */

import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import {
    ReactFlow,
    ReactFlowProvider,
    Background,
    Controls,
    Panel,
    Handle,
    Position,
    MarkerType,
    useNodesState,
    useEdgesState,
    useReactFlow,
    type Node,
    type Edge,
    type NodeProps,
    type Connection,
} from '@xyflow/react';
import { Pencil, Check, Trash2 } from 'lucide-react';
import { documentToTree } from '../lib/markdownTree';
import { mindmapToFlowchart } from '../lib/flowchart-converter';
import { layoutFlowchart } from '../lib/dagre-layout';
import { parseFlowchartBlock, upsertFlowchartBlock, type StoredFlowchart } from '../lib/flowchartBlock';
import type { FlowchartNode, FlowchartEdge, FlowNodeType } from '../types/flowchart';
import { FlowchartPanel } from './FlowchartPanel';
import '@xyflow/react/dist/style.css';
import './FlowchartView.css';

interface FlowNodeData {
    label: string;
    flowType: string;
    description?: string;
    // 편집(Phase 1) — editMode 일 때만 주입(displayNodes).
    editMode?: boolean;
    isEditing?: boolean;
    onStartEdit?: () => void;
    onUpdateLabel?: (v: string) => void;
    onCancelEdit?: () => void;
    onDelete?: () => void;
    [key: string]: unknown;
}

function FlowNode({ data }: NodeProps) {
    const d = data as FlowNodeData;
    const editableRef = useRef<HTMLDivElement>(null);

    // 편집 진입 시 contentEditable 에 현재 라벨 주입 + 포커스/전체선택.
    // 50ms defer 는 React Flow 노드 포지셔닝 완료를 기다린다(MindBusiness 패턴).
    useEffect(() => {
        if (!d.isEditing) return;
        const el = editableRef.current;
        if (!el) return;
        if (el.textContent !== d.label) el.textContent = d.label;
        const t = setTimeout(() => {
            el.focus({ preventScroll: true });
            const sel = window.getSelection();
            if (!sel) return;
            const range = document.createRange();
            range.selectNodeContents(el);
            sel.removeAllRanges();
            sel.addRange(range);
        }, 50);
        return () => clearTimeout(t);
    }, [d.isEditing, d.label]);

    const commit = (value: string) => {
        const v = value.trim();
        if (v) d.onUpdateLabel?.(v);
        else d.onCancelEdit?.();
    };

    return (
        <div
            className={`flow-node flow-node--${d.flowType}${d.editMode ? ' is-editable' : ''}`}
            title={d.description || undefined}
            onDoubleClick={d.editMode ? (e) => { e.stopPropagation(); d.onStartEdit?.(); } : undefined}
        >
            {/* dagre-layout 이 지정하는 source/targetHandle(id) 과 매칭 — forward(LR=right/left)
                + loop(top). markerLoop(retry)가 top handle 로 위로 빠져나가 arc 가 된다.
                평소엔 CSS 로 숨기고(연결 위치만), 편집 모드(is-editing)에서만 점을 노출한다. */}
            <Handle type="source" position={Position.Right} id="right-source" />
            <Handle type="target" position={Position.Right} id="right-target" />
            <Handle type="source" position={Position.Left} id="left-source" />
            <Handle type="target" position={Position.Left} id="left-target" />
            <Handle type="source" position={Position.Top} id="top-source" />
            <Handle type="target" position={Position.Top} id="top-target" />
            <Handle type="source" position={Position.Bottom} id="bottom-source" />
            <Handle type="target" position={Position.Bottom} id="bottom-target" />
            {d.isEditing ? (
                // 편집/표시 분기는 서로 다른 key — 같은 div 재사용 시 contentEditable 의 명령형
                // textContent 잔재가 남아 라벨이 중복되는 React 재조정 함정 방지(COMMON_PATTERNS).
                <div
                    key="edit"
                    contentEditable
                    suppressContentEditableWarning
                    ref={editableRef}
                    className="flow-node__edit nodrag"
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(e.currentTarget.textContent || ''); }
                        else if (e.key === 'Escape') { e.preventDefault(); d.onCancelEdit?.(); }
                    }}
                    onBlur={(e) => commit(e.currentTarget.textContent || '')}
                />
            ) : (
                <span key="view" className="flow-node__label">{d.label}</span>
            )}
            {d.editMode && !d.isEditing && (
                <button
                    type="button"
                    className="flow-node__del nodrag"
                    onClick={(e) => { e.stopPropagation(); d.onDelete?.(); }}
                    title="삭제"
                >
                    <Trash2 size={11} />
                </button>
            )}
        </div>
    );
}

const nodeTypes = { flow: FlowNode };

/** 노드 타입별 기본 라벨(추가 시). */
function defaultLabelFor(type: FlowNodeType): string {
    switch (type) {
        case 'start': return '시작';
        case 'end': return '종료';
        case 'decision': return '조건?';
        case 'io': return '입출력';
        case 'merge': return '합류';
        default: return '새 단계';
    }
}

/** 팔레트(노드 추가) — image 는 1차 미지원이라 제외. */
const PALETTE: { type: FlowNodeType; label: string }[] = [
    { type: 'start', label: '시작' },
    { type: 'process', label: '단계' },
    { type: 'decision', label: '분기' },
    { type: 'io', label: '입출력' },
    { type: 'merge', label: '합류' },
    { type: 'end', label: '종료' },
];

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
            // dagre-layout 이 방향에 맞춰 지정한 handle id 를 넘겨야 markerLoop(retry)가 위쪽
            // handle 로 빠져 arc 가 된다(누락 시 기본 handle 로 떨어져 메인과 겹침).
            sourceHandle: e.sourceHandle,
            targetHandle: e.targetHandle,
            // smoothstep: 일직선=직선, 분기·loop=직각 ㄷ 자(bezier 곡선 제거).
            type: 'smoothstep',
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
    const { screenToFlowPosition } = useReactFlow();

    const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node>([]);
    const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const [isAi, setIsAi] = useState(false);
    const [editMode, setEditMode] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
    const lastEmittedRef = useRef<string | null>(null);

    // stored 흐름도 → React Flow nodes/edges. dagre 로 handle/배치 계산 후, 수동 저장된
    // position 이 있으면 그걸로 override(자유 배치 보존). effect·commit 양쪽에서 재사용.
    const syncFromStored = useCallback((stored: StoredFlowchart) => {
        const seeded = stored.nodes.map((n) => ({ ...n, position: n.position ?? { x: 0, y: 0 } }));
        const lo = layoutFlowchart(seeded, stored.edges, { rankdir: stored.direction ?? 'LR' });
        const merged = lo.nodes.map((n) => {
            const sn = stored.nodes.find((s) => s.id === n.id);
            return sn?.position ? { ...n, position: sn.position } : n;
        });
        const rf = toReactFlow(merged, lo.edges);
        setRfNodes(rf.nodes);
        setRfEdges(rf.edges);
    }, [setRfNodes, setRfEdges]);

    useEffect(() => {
        if (content === lastEmittedRef.current) return; // 자기 편집 echo skip
        const stored = parseFlowchartBlock(content);
        if (stored) {
            syncFromStored(stored);
            setIsAi(true);
        } else {
            const { tree } = documentToTree(content, stem);
            const fc = mindmapToFlowchart(tree);
            const rf = toReactFlow(fc.result.nodes, fc.result.edges);
            setRfNodes(rf.nodes);
            setRfEdges(rf.edges);
            setIsAi(false);
            setEditMode(false); // 미러(블록 없음)는 편집 대상 아님
            setEditingId(null);
        }
    }, [content, stem, syncFromStored, setRfNodes, setRfEdges]);

    // 드래그 종료 → 위치만 저장(자유 배치 보존). stored 기반이라 type/label/edge 보존.
    const commitPositions = useCallback((nodes: Node[]) => {
        const stored = parseFlowchartBlock(content);
        if (!stored) return;
        const fc: StoredFlowchart = {
            ...stored,
            nodes: stored.nodes.map((sn) => {
                const rf = nodes.find((n) => n.id === sn.id);
                return rf ? { ...sn, position: rf.position } : sn;
            }),
        };
        const md = upsertFlowchartBlock(content, fc, true);
        lastEmittedRef.current = md;
        onChange(md);
    }, [content, onChange]);

    // 구조 편집(라벨/삭제/추가/연결) — stored 변형 → upsert(keepPosition) → 즉시 setRf* 반영.
    const commitFlow = useCallback((mutate: (s: StoredFlowchart) => StoredFlowchart) => {
        const stored = parseFlowchartBlock(content);
        if (!stored) return;
        const next = mutate(stored);
        const md = upsertFlowchartBlock(content, next, true);
        lastEmittedRef.current = md;
        syncFromStored(next); // effect 는 echo skip 되므로 여기서 즉시 반영
        onChange(md);
    }, [content, onChange, syncFromStored]);

    const updateLabel = useCallback((id: string, label: string) => {
        setEditingId(null);
        commitFlow((s) => ({ ...s, nodes: s.nodes.map((n) => (n.id === id ? { ...n, label } : n)) }));
    }, [commitFlow]);

    const deleteNode = useCallback((id: string) => {
        setEditingId(null);
        setSelectedNodeId(null);
        commitFlow((s) => ({
            ...s,
            nodes: s.nodes.filter((n) => n.id !== id),
            edges: s.edges.filter((e) => e.source !== id && e.target !== id), // 연결된 edge 동반 삭제
        }));
    }, [commitFlow]);

    const deleteEdge = useCallback((id: string) => {
        setSelectedEdgeId(null);
        commitFlow((s) => ({ ...s, edges: s.edges.filter((e) => e.id !== id) }));
    }, [commitFlow]);

    const addNode = useCallback((type: FlowNodeType) => {
        // 캔버스 중심에 배치(겹침 방지 jitter). edge 없는 isolated 라 dagre 가 위치 유지.
        const wrap = document.querySelector('.flowchart-canvas');
        let center = { x: 0, y: 0 };
        if (wrap) {
            const r = wrap.getBoundingClientRect();
            center = screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
        }
        const snap = (v: number) => Math.round(v / 20) * 20;
        const jitter = 20 * (rfNodes.length % 6);
        const id = `n${Date.now().toString(36)}-${rfNodes.length}`;
        commitFlow((s) => ({
            ...s,
            nodes: [...s.nodes, { id, type, label: defaultLabelFor(type), position: { x: snap(center.x + jitter), y: snap(center.y + jitter) } }],
        }));
        setEditingId(id); // 추가 직후 바로 라벨 편집
    }, [screenToFlowPosition, commitFlow, rfNodes.length]);

    // handle 드래그로 노드 연결 → edge 추가. handle id(방향)도 보존.
    const onConnect = useCallback((conn: Connection) => {
        if (!conn.source || !conn.target) return;
        const id = `e${Date.now().toString(36)}-${rfEdges.length}`;
        commitFlow((s) => ({
            ...s,
            edges: [...s.edges, {
                id,
                source: conn.source as string,
                target: conn.target as string,
                sourceHandle: conn.sourceHandle ?? undefined,
                targetHandle: conn.targetHandle ?? undefined,
            }],
        }));
    }, [commitFlow, rfEdges.length]);

    // 선택된 edge/노드 Delete 삭제(편집 모드). contentEditable/input 입력 중엔 제외해
    // 라벨 편집 중 Backspace 가 노드를 지우지 않게 한다(MindBusiness 패턴).
    useEffect(() => {
        if (!editMode) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Delete' && e.key !== 'Backspace') return;
            const t = e.target as HTMLElement | null;
            if (t?.isContentEditable || t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA') return;
            if (selectedEdgeId) { e.preventDefault(); deleteEdge(selectedEdgeId); }
            else if (selectedNodeId) { e.preventDefault(); deleteNode(selectedNodeId); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [editMode, selectedEdgeId, selectedNodeId, deleteEdge, deleteNode]);

    // editMode/편집 콜백을 노드 data 에 덧입힌다(렌더 직전). 드래그용 rfNodes 는 그대로.
    const displayNodes = useMemo(() => rfNodes.map((n) => ({
        ...n,
        data: {
            ...n.data,
            editMode,
            isEditing: n.id === editingId,
            onStartEdit: () => setEditingId(n.id),
            onUpdateLabel: (v: string) => updateLabel(n.id, v),
            onCancelEdit: () => setEditingId(null),
            onDelete: () => deleteNode(n.id),
        },
    })), [rfNodes, editMode, editingId, updateLabel, deleteNode]);

    // 선택된 edge 강조(편집 시각 피드백).
    const displayEdges = useMemo(() => rfEdges.map((e) => (
        e.id === selectedEdgeId
            ? { ...e, selected: true, style: { stroke: '#4f46e5', strokeWidth: 2 } }
            : e
    )), [rfEdges, selectedEdgeId]);

    return (
        <div className={`flowchart-view${editMode ? ' is-editing' : ''}`}>
            <div className="flowchart-canvas">
                <ReactFlow
                    key={`${stem}-${isAi}`}
                    nodes={displayNodes}
                    edges={displayEdges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onNodeDragStop={() => commitPositions(rfNodes)}
                    onConnect={onConnect}
                    onNodeClick={(_e, n) => { setSelectedNodeId(n.id); setSelectedEdgeId(null); }}
                    onEdgeClick={(_e, ed) => { setSelectedEdgeId(ed.id); setSelectedNodeId(null); }}
                    onPaneClick={() => { setSelectedNodeId(null); setSelectedEdgeId(null); }}
                    nodeTypes={nodeTypes}
                    // dagre-layout 이 position 을 노드 '중심' 으로 계산 → nodeOrigin 도 center.
                    // 누락 시 노드 높이 다른 연결(process↔decision)에서 handle y 어긋나 edge 가 꺾인다.
                    nodeOrigin={[0.5, 0.5]}
                    nodesDraggable={editMode}
                    nodesConnectable={editMode}
                    elementsSelectable
                    deleteKeyCode={null} // 삭제는 위 자체 핸들러(contentEditable 가드 포함)로 처리
                    fitView
                    fitViewOptions={{ padding: 0.2, maxZoom: 1.2 }}
                    minZoom={0.1}
                    maxZoom={2.5}
                    proOptions={{ hideAttribution: true }}
                >
                    <Background gap={20} size={1} />
                    <Controls showInteractive={false} />
                    {isAi && (
                        <Panel position="top-left">
                            <button
                                type="button"
                                className={`flow-edit-toggle${editMode ? ' is-active' : ''}`}
                                onClick={() => { setEditMode((v) => !v); setEditingId(null); setSelectedNodeId(null); setSelectedEdgeId(null); }}
                                title={editMode ? '편집 완료' : '노드 편집'}
                            >
                                {editMode ? <Check size={14} /> : <Pencil size={14} />}
                                {editMode ? '편집 완료' : '편집'}
                            </button>
                        </Panel>
                    )}
                    {isAi && editMode && (
                        <Panel position="top-right">
                            <div className="flow-palette">
                                <span className="flow-palette-title">노드 추가</span>
                                {PALETTE.map((p) => (
                                    <button key={p.type} type="button" className="flow-palette-btn" onClick={() => addNode(p.type)}>
                                        {p.label}
                                    </button>
                                ))}
                            </div>
                        </Panel>
                    )}
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
