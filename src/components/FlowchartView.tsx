/**
 * Flowchart view mode (#46 M3).
 *
 * 두 소스를 렌더한다:
 *  1) 저장된 AI 흐름도 — 문서의 ```markmind-flow 코드블록(parseFlowchartBlock).
 *  2) 구조 미러(프리뷰) — 코드블록이 없으면 documentToTree → mindmapToFlowchart.
 *
 * 편집(Phase 1): editMode 는 메인 툴바 토글(App)이 prop 으로 내려준다. 편집(드래그/라벨/
 * 추가/삭제/연결)은 commit→upsert→onChange 로 SSOT(markmind-flow)에 되쓰기. 노드 추가
 * 팔레트는 상단 서브 툴바(리치 텍스트 모드와 동형)로 노출.
 */

import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import {
    ReactFlow,
    ReactFlowProvider,
    Background,
    Controls,
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
import { Trash2, Play, Square, Split, ArrowRightLeft, Merge, CircleStop, Network, type LucideIcon } from 'lucide-react';
import { assignFlowchartEdgeHandles, layoutFlowchart } from '../lib/dagre-layout';
import { parseFlowchartBlock, upsertFlowchartBlock, type StoredFlowchart } from '../lib/flowchartBlock';
import { normalizeFlowNodeType } from '../lib/flowchart-shapes';
import type { FlowchartNode, FlowchartEdge, FlowNodeType } from '../types/flowchart';
import { FlowchartPanel } from './FlowchartPanel';
import '@xyflow/react/dist/style.css';
import './FlowchartView.css';

interface FlowNodeData {
    label: string;
    flowType: string;
    description?: string;
    // 편집 — canEdit 일 때만 주입(displayNodes).
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
            {/* dagre-layout 이 지정하는 source/targetHandle(id) 과 매칭. 평소 숨김, 편집 모드에서만 노출. */}
            <Handle type="source" position={Position.Right} id="right-source" />
            <Handle type="target" position={Position.Right} id="right-target" />
            <Handle type="source" position={Position.Left} id="left-source" />
            <Handle type="target" position={Position.Left} id="left-target" />
            <Handle type="source" position={Position.Top} id="top-source" />
            <Handle type="target" position={Position.Top} id="top-target" />
            <Handle type="source" position={Position.Bottom} id="bottom-source" />
            <Handle type="target" position={Position.Bottom} id="bottom-target" />
            {d.isEditing ? (
                // 편집/표시 분기는 서로 다른 key — contentEditable 잔재로 라벨 중복되는 함정 방지(COMMON_PATTERNS).
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

/** 서브 툴바 노드 추가 팔레트 — image 는 1차 미지원이라 제외. 아이콘은 노드 의미에 맞춤. */
const PALETTE: { type: FlowNodeType; label: string; Icon: LucideIcon }[] = [
    { type: 'start', label: '시작', Icon: Play },
    { type: 'process', label: '단계', Icon: Square },
    { type: 'decision', label: '분기', Icon: Split },
    { type: 'io', label: '입출력', Icon: ArrowRightLeft },
    { type: 'merge', label: '합류', Icon: Merge },
    { type: 'end', label: '종료', Icon: CircleStop },
];

/** FlowchartNode/Edge → React Flow Node/Edge. */
function toReactFlow(nodes: FlowchartNode[], edges: FlowchartEdge[]): { nodes: Node[]; edges: Edge[] } {
    return {
        nodes: nodes.map((n) => ({
            id: n.id,
            type: 'flow',
            position: n.position,
            data: {
                label: n.label,
                flowType: normalizeFlowNodeType(n.type),
                description: n.description,
            },
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
    /** 모달(FlowchartPanel) 열림 — 메인 툴바 "자동 생성" 클릭을 App 이 토글. */
    flowchartPanelOpen?: boolean;
    onCloseFlowchartPanel?: () => void;
}

function FlowchartViewInner({ content, fileName, onChange, flowchartPanelOpen, onCloseFlowchartPanel }: FlowchartViewProps) {
    const stem = useMemo(() => stemOf(fileName), [fileName]);
    const { screenToFlowPosition } = useReactFlow();

    const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node>([]);
    const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const [isAi, setIsAi] = useState(false);
    // 편집 모드는 명시적 버튼 없이 자동: 노드/엣지 클릭 시 ON, 빈 캔버스 클릭 시 OFF(보기).
    const [editMode, setEditMode] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
    const lastEmittedRef = useRef<string | null>(null);

    // 미러(markmind-flow 블록 없음)에선 편집 불가 → editMode 와 isAi 를 AND.
    const canEdit = editMode && isAi;

    // 빈 흐름도(노드 0)는 클릭으로 편집 진입할 노드가 없으니 자동 편집(노드 추가 서브툴바 노출).
    useEffect(() => {
        if (isAi && rfNodes.length === 0) setEditMode(true);
    }, [isAi, rfNodes.length]);

    const syncFromStored = useCallback((stored: StoredFlowchart) => {
        const rankdir = stored.direction ?? 'LR';
        const seeded = stored.nodes.map((n) => ({ ...n, position: n.position ?? { x: 0, y: 0 } }));
        const lo = layoutFlowchart(seeded, stored.edges, { rankdir });
        const merged = lo.nodes.map((n) => {
            const sn = stored.nodes.find((s) => s.id === n.id);
            return sn?.position ? { ...n, position: sn.position } : n;
        });
        const edges = assignFlowchartEdgeHandles(lo.edges, merged, rankdir);
        const rf = toReactFlow(merged, edges);
        setRfNodes(rf.nodes);
        setRfEdges(rf.edges);
    }, [setRfNodes, setRfEdges]);

    useEffect(() => {
        if (content === lastEmittedRef.current) return;
        const stored = parseFlowchartBlock(content);
        if (stored) {
            syncFromStored(stored);
            setIsAi(true);
        } else {
            // markmind-flow 코드블록이 없으면 빈 상태 — 문서 트리 미러링 대신 안내를 보여준다
            // (간트와 동일 — 형식에 맞는 데이터가 없으면 자동 생성을 유도, 플로우차트 아닌 걸 표시 X).
            setRfNodes([]);
            setRfEdges([]);
            setIsAi(false);
            setEditingId(null);
        }
    }, [content, stem, syncFromStored, setRfNodes, setRfEdges]);

    // 편집 모드를 벗어나면(또는 미러로 전환) 선택/편집 상태를 정리.
    useEffect(() => {
        if (!canEdit) { setEditingId(null); setSelectedNodeId(null); setSelectedEdgeId(null); }
    }, [canEdit]);

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

    const commitFlow = useCallback((mutate: (s: StoredFlowchart) => StoredFlowchart) => {
        const stored = parseFlowchartBlock(content);
        if (!stored) return;
        const next = mutate(stored);
        const md = upsertFlowchartBlock(content, next, true);
        lastEmittedRef.current = md;
        syncFromStored(next);
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
            edges: s.edges.filter((e) => e.source !== id && e.target !== id),
        }));
    }, [commitFlow]);

    const deleteEdge = useCallback((id: string) => {
        setSelectedEdgeId(null);
        commitFlow((s) => ({ ...s, edges: s.edges.filter((e) => e.id !== id) }));
    }, [commitFlow]);

    const addNode = useCallback((type: FlowNodeType) => {
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
        setEditingId(id);
    }, [screenToFlowPosition, commitFlow, rfNodes.length]);

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

    // 선택된 edge/노드 Delete 삭제(편집 모드). contentEditable/input 입력 중엔 제외.
    useEffect(() => {
        if (!canEdit) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Delete' && e.key !== 'Backspace') return;
            const t = e.target as HTMLElement | null;
            if (t?.isContentEditable || t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA') return;
            if (selectedEdgeId) { e.preventDefault(); deleteEdge(selectedEdgeId); }
            else if (selectedNodeId) { e.preventDefault(); deleteNode(selectedNodeId); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [canEdit, selectedEdgeId, selectedNodeId, deleteEdge, deleteNode]);

    const displayNodes = useMemo(() => rfNodes.map((n) => ({
        ...n,
        data: {
            ...n.data,
            editMode: canEdit,
            isEditing: n.id === editingId,
            onStartEdit: () => setEditingId(n.id),
            onUpdateLabel: (v: string) => updateLabel(n.id, v),
            onCancelEdit: () => setEditingId(null),
            onDelete: () => deleteNode(n.id),
        },
    })), [rfNodes, canEdit, editingId, updateLabel, deleteNode]);

    const displayEdges = useMemo(() => rfEdges.map((e) => (
        e.id === selectedEdgeId
            ? { ...e, selected: true, style: { stroke: '#4f46e5', strokeWidth: 2 } }
            : e
    )), [rfEdges, selectedEdgeId]);

    return (
        <div className={`flowchart-view${canEdit ? ' is-editing' : ''}`}>
            {canEdit && (
                <div className="flowchart-subtoolbar">
                    {PALETTE.map((p) => {
                        const Icon = p.Icon;
                        return (
                            <button key={p.type} type="button" className="flowchart-subtoolbar-btn" onClick={() => addNode(p.type)} title={`${p.label} 노드 추가`}>
                                <Icon size={13} strokeWidth={1.5} />
                                <span>{p.label}</span>
                            </button>
                        );
                    })}
                </div>
            )}
            <div className="flowchart-canvas">
                {isAi ? (
                <ReactFlow
                    key={`${stem}-${isAi}`}
                    nodes={displayNodes}
                    edges={displayEdges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onNodeDragStop={() => commitPositions(rfNodes)}
                    onConnect={onConnect}
                    onNodeClick={(_e, n) => { setEditMode(true); setSelectedNodeId(n.id); setSelectedEdgeId(null); }}
                    onEdgeClick={(_e, ed) => { setEditMode(true); setSelectedEdgeId(ed.id); setSelectedNodeId(null); }}
                    onPaneClick={() => { setEditMode(false); setSelectedNodeId(null); setSelectedEdgeId(null); }}
                    nodeTypes={nodeTypes}
                    // dagre-layout 이 position 을 노드 '중심' 으로 계산 → nodeOrigin 도 center.
                    nodeOrigin={[0.5, 0.5]}
                    nodesDraggable={canEdit}
                    nodesConnectable={canEdit}
                    elementsSelectable
                    deleteKeyCode={null}
                    fitView
                    fitViewOptions={{ padding: 0.2, maxZoom: 1.2 }}
                    minZoom={0.1}
                    maxZoom={2.5}
                    proOptions={{ hideAttribution: true }}
                >
                    <Background gap={20} size={1} />
                    <Controls showInteractive={false} />
                </ReactFlow>
                ) : (
                    <div className="flowchart-empty">
                        <Network size={48} strokeWidth={1.25} />
                        <p className="flowchart-empty-title">표시할 플로우차트가 없습니다</p>
                        <p className="flowchart-empty-hint">
                            우측 상단 <strong>자동 생성</strong> 으로 문서·주제를 플로우차트로 만들어보세요.
                        </p>
                    </div>
                )}
            </div>
            {flowchartPanelOpen && (
                <FlowchartPanel
                    content={content}
                    onApply={(fc, mode) => onChange(upsertFlowchartBlock(mode === 'replace' ? '' : content, fc))}
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
