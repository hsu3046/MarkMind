/**
 * Lean React Flow mindmap canvas.
 *
 * A slimmed rewrite of MindBusiness's 1000-line canvas: keeps the React Flow
 * setup, the custom 'mindmap' node, bezier edges, and inline label editing —
 * but drops zustand / framer-motion / sonner / hugeicons / IndexedDB images /
 * AI-expand. Editing bubbles to the parent (MindmapView) instead of a store.
 *
 * Nodes are NOT draggable (MVP): markdown is the source of truth and can't store
 * x/y, so layout is always recomputed by d3 (see ../lib/d3-layout.ts).
 */

import { memo, useEffect, useRef, useCallback } from 'react';
import {
    ReactFlow,
    ReactFlowProvider,
    Background,
    Controls,
    Handle,
    Position,
    BezierEdge,
    useReactFlow,
    useNodesInitialized,
    type Node,
    type Edge,
    type NodeProps,
} from '@xyflow/react';
import { Plus, Pencil, Trash2, FileSymlink, SquareArrowOutUpRight } from 'lucide-react';
import type { MindmapNode } from '../types/mindmap';
import '@xyflow/react/dist/style.css';
import './MindmapCanvas.css';

/** Data carried on each React Flow node (produced by d3-layout + augmented by MindmapView). */
export interface MindmapNodeData {
    label: string;
    node: MindmapNode;
    level: number;
    side: 'left' | 'right' | 'center';
    colorIndex: number;
    hasChildren: boolean;
    childrenCount: number;
    /** 1-based source line in the full document (for jump-to-section). */
    mdLine?: number;
    // injected by MindmapView
    isEditing?: boolean;
    hasLinks?: boolean;
    linkCount?: number;
    /** When true the drill-in affordance navigates; otherwise it's a passive indicator (M1). */
    canDrill?: boolean;
    onStartEdit?: () => void;
    onJumpToSource?: () => void;
    onUpdateLabel?: (value: string) => void;
    onCancelEdit?: () => void;
    onAddChild?: () => void;
    onDelete?: () => void;
    onOpenLink?: () => void;
    [key: string]: unknown;
}

const PALETTE = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#14b8a6'];

/** One-line plain-text preview of a node's description (full text on hover). */
function descPreview(s: string): string {
    return s
        .replace(/```[\s\S]*?```/g, '⟨코드⟩')   // collapse fenced code
        .replace(/^\s*\|.*$/gm, '⟨표⟩')          // collapse table rows
        .replace(/^\s*[#>*\-+]+\s*/gm, '')       // strip block markers
        .replace(/[`*_]/g, '')                    // strip inline emphasis
        .replace(/\s+/g, ' ')
        .trim();
}

const MindmapNodeComponent = memo(function MindmapNodeComponent({ data }: NodeProps) {
    const d = data as MindmapNodeData;
    const isRoot = d.level === 0;
    // Branch hue from the L1 colour; level (h1/h2/h3…) shown as background intensity
    // (deeper = lighter tint) via color-mix over the theme background.
    const base = isRoot ? 'var(--accent)' : PALETTE[d.colorIndex % PALETTE.length];
    const tint = isRoot ? 22 : Math.max(6, 24 - d.level * 6); // % of hue mixed into bg
    const accent = base;
    const background = `color-mix(in srgb, ${base} ${tint}%, var(--bg-primary))`;
    const desc = d.node?.description?.trim();

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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [d.isEditing]);

    const commit = useCallback((value: string) => {
        const v = value.trim();
        if (v && v !== d.label) d.onUpdateLabel?.(v);
        else d.onCancelEdit?.();
    }, [d]);

    return (
        <div className={`mm-node${isRoot ? ' mm-root' : ''}`} style={{ borderColor: accent, background }}>
            <Handle
                id="left"
                type={isRoot ? 'source' : d.side === 'left' ? 'source' : 'target'}
                position={Position.Left}
                className="mm-handle"
            />

            {d.isEditing ? (
                // distinct key from the view branch → React remounts instead of
                // reusing the same <div>, which would leave the contentEditable's
                // imperative text node behind and duplicate the label.
                <div
                    key="mm-edit"
                    role="textbox"
                    contentEditable
                    suppressContentEditableWarning
                    ref={editableRef}
                    className="mm-edit nodrag"
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            commit(e.currentTarget.textContent || '');
                        } else if (e.key === 'Escape') {
                            e.preventDefault();
                            d.onCancelEdit?.();
                        }
                    }}
                    onBlur={(e) => commit(e.currentTarget.textContent || '')}
                />
            ) : (
                <div key="mm-view" className="mm-text">
                    <span className="mm-label">{d.label || '(빈 노드)'}</span>
                    {desc && <span className="mm-desc" title={desc}>{descPreview(desc)}</span>}
                </div>
            )}

            {d.hasLinks && !d.isEditing && (
                d.canDrill ? (
                    <button
                        className="mm-drill"
                        title={`연결된 문서 ${d.linkCount ?? 1}개 열기`}
                        onClick={(e) => { e.stopPropagation(); d.onOpenLink?.(); }}
                    >
                        <FileSymlink size={12} />
                    </button>
                ) : (
                    <span className="mm-drill mm-drill-static" title={`연결된 문서 ${d.linkCount ?? 1}개`}>
                        <FileSymlink size={12} />
                    </span>
                )
            )}

            {d.onJumpToSource && !d.isEditing && (
                <button
                    className="mm-jump"
                    title="문서에서 이 섹션으로 이동"
                    style={{ color: accent }}
                    onClick={(e) => { e.stopPropagation(); d.onJumpToSource?.(); }}
                >
                    <SquareArrowOutUpRight size={13} strokeWidth={2.25} />
                </button>
            )}

            <Handle
                id="right"
                type={isRoot ? 'source' : d.side === 'left' ? 'target' : 'source'}
                position={Position.Right}
                className="mm-handle"
            />

            {/* hover toolbar */}
            {!d.isEditing && (
                <div className="mm-toolbar nodrag" onClick={(e) => e.stopPropagation()}>
                    <button title="이름 편집" onClick={(e) => { e.stopPropagation(); d.onStartEdit?.(); }}>
                        <Pencil size={12} />
                    </button>
                    <button title="자식 추가" onClick={(e) => { e.stopPropagation(); d.onAddChild?.(); }}>
                        <Plus size={12} />
                    </button>
                    {!isRoot && (
                        <button title="삭제" onClick={(e) => { e.stopPropagation(); d.onDelete?.(); }}>
                            <Trash2 size={12} />
                        </button>
                    )}
                </div>
            )}
        </div>
    );
});

const nodeTypes = { mindmap: MindmapNodeComponent };
const edgeTypes = { bezier: BezierEdge };

interface MindmapCanvasProps {
    nodes: Node[];
    edges: Edge[];
    /** Re-fit the viewport when this key changes (e.g. document switch). */
    fitKey?: string;
    /** Report real measured node sizes so the parent can re-layout (no overlap). */
    onNodesMeasured?: (sizes: Map<string, { width: number; height: number }>) => void;
}

function MindmapCanvasInner({ nodes, edges, fitKey, onNodesMeasured }: MindmapCanvasProps) {
    const { getNodes } = useReactFlow();
    const initialized = useNodesInitialized();

    // Once React Flow has measured the DOM nodes, report real sizes upward so the
    // layout can be recomputed with actual heights — eliminating overlap from the
    // pre-render size estimate. The parent diffs sizes, so this settles in one pass.
    useEffect(() => {
        if (!initialized || !onNodesMeasured) return;
        const sizes = new Map<string, { width: number; height: number }>();
        for (const n of getNodes()) {
            const w = n.measured?.width;
            const h = n.measured?.height;
            if (w && h) sizes.set(n.id, { width: w, height: h });
        }
        if (sizes.size > 0) onNodesMeasured(sizes);
    }, [initialized, nodes, onNodesMeasured, getNodes]);

    return (
        <ReactFlow
            key={fitKey}
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
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

export function MindmapCanvas(props: MindmapCanvasProps) {
    return (
        <ReactFlowProvider>
            <MindmapCanvasInner {...props} />
        </ReactFlowProvider>
    );
}
