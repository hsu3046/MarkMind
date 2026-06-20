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

import { memo, useEffect, useRef, useCallback, type CSSProperties } from 'react';
import {
    ReactFlow,
    ReactFlowProvider,
    Background,
    Controls,
    Handle,
    Position,
    BezierEdge,
    type Node,
    type Edge,
    type NodeProps,
} from '@xyflow/react';
import { Plus, Pencil, Trash2, SquareArrowOutUpRight, ChevronUp, ChevronDown, IndentIncrease, IndentDecrease, Sparkles, Loader2 } from 'lucide-react';
import type { MindmapNode } from '../types/mindmap';
import type { ReorderOp } from '../lib/mindmapReorder';
import { PALETTE } from '../lib/d3-layout';
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
    isSelected?: boolean;
    /** 미러(read-only) — 편집 액션 버튼 영역 비표시. (이슈 #64) */
    readOnly?: boolean;
    /** Reorder affordances — enabled per the markdown-bridge rules (see mindmapReorder). */
    canUp?: boolean;
    canDown?: boolean;
    canIndent?: boolean;
    canOutdent?: boolean;
    onMove?: (op: ReorderOp) => void;
    onStartEdit?: () => void;
    onJumpToSource?: () => void;
    onUpdateLabel?: (value: string) => void;
    onCancelEdit?: () => void;
    onAddChild?: () => void;
    onDelete?: () => void;
    /** AI 확장 — d3-layout 에서 주입(canExpand=level<4), onExpand→MindmapView.handleExpand. */
    canExpand?: boolean;
    isExpanding?: boolean;
    onExpand?: () => void;
    [key: string]: unknown;
}

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
    // Branch hue from the L1 colour. Level (h1/h2/h3…) is shown two ways, deeper = lighter:
    //   - the left stripe (띠) — the primary, clearly-stepped level cue
    //   - the card background tint
    const base = isRoot ? 'var(--accent)' : PALETTE[d.colorIndex % PALETTE.length];
    const bgPct = isRoot ? 26 : Math.max(8, 30 - d.level * 7);    // background intensity
    const stripePct = Math.max(36, 100 - d.level * 18);           // 띠 농도 (얕을수록 진함)
    const accent = base;                                          // branch hue (jump icon)
    const background = `color-mix(in srgb, ${base} ${bgPct}%, var(--bg-primary))`;
    const stripe = `color-mix(in srgb, ${base} ${stripePct}%, var(--bg-primary))`;
    const thinBorder = `color-mix(in srgb, ${base} 28%, var(--bg-primary))`;
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
        <div className={`mm-node${isRoot ? ' mm-root' : ''}${d.isSelected ? ' mm-selected' : ''}`} style={{ borderColor: thinBorder, background, '--mm-stripe': stripe } as CSSProperties}>
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

            {/* hover toolbar — 미러(readOnly)에선 편집 액션 비표시. (이슈 #64) */}
            {!d.isEditing && !d.readOnly && (
                <div className="mm-toolbar nodrag" onClick={(e) => e.stopPropagation()}>
                    {!isRoot && (
                        <>
                            <button title="위로 이동 (↑)" disabled={!d.canUp} onClick={(e) => { e.stopPropagation(); d.onMove?.('up'); }}>
                                <ChevronUp size={12} />
                            </button>
                            <button title="아래로 이동 (↓)" disabled={!d.canDown} onClick={(e) => { e.stopPropagation(); d.onMove?.('down'); }}>
                                <ChevronDown size={12} />
                            </button>
                            <button title="들여쓰기 (Tab)" disabled={!d.canIndent} onClick={(e) => { e.stopPropagation(); d.onMove?.('indent'); }}>
                                <IndentIncrease size={12} />
                            </button>
                            <button title="내어쓰기 (⇧Tab)" disabled={!d.canOutdent} onClick={(e) => { e.stopPropagation(); d.onMove?.('outdent'); }}>
                                <IndentDecrease size={12} />
                            </button>
                            <span className="mm-toolbar-sep" aria-hidden="true" />
                        </>
                    )}
                    <button title="이름 편집" onClick={(e) => { e.stopPropagation(); d.onStartEdit?.(); }}>
                        <Pencil size={12} />
                    </button>
                    <button title="자식 추가" onClick={(e) => { e.stopPropagation(); d.onAddChild?.(); }}>
                        <Plus size={12} />
                    </button>
                    {d.canExpand && (
                        <button
                            title="AI로 확장"
                            disabled={d.isExpanding}
                            onClick={(e) => { e.stopPropagation(); d.onExpand?.(); }}
                        >
                            {d.isExpanding ? <Loader2 size={12} className="spinning" /> : <Sparkles size={12} />}
                        </button>
                    )}
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
    /** Currently selected node id (for keyboard reorder + highlight). */
    selectedId?: string | null;
    /** True while a label is being edited — suppresses reorder keyboard. */
    editing?: boolean;
    onSelect?: (id: string | null) => void;
    onReorder?: (id: string, op: ReorderOp) => void;
}

function MindmapCanvasInner({ nodes, edges, fitKey, selectedId, editing, onSelect, onReorder }: MindmapCanvasProps) {
    // Refs so the once-bound document listener always sees fresh values.
    const selRef = useRef(selectedId);
    selRef.current = selectedId;
    const editingRef = useRef(editing);
    editingRef.current = editing;
    const reorderRef = useRef(onReorder);
    reorderRef.current = onReorder;

    // Outliner keyboard: ↑/↓ reorder siblings, Tab/⇧Tab indent/outdent the
    // selected node. Ignored while editing, when an input is focused, or with a
    // modifier held (those belong to the app's global shortcuts).
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const id = selRef.current;
            if (!id || editingRef.current) return;
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            const t = e.target as HTMLElement | null;
            if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
            let op: ReorderOp | null = null;
            if (e.key === 'ArrowUp') op = 'up';
            else if (e.key === 'ArrowDown') op = 'down';
            else if (e.key === 'Tab') op = e.shiftKey ? 'outdent' : 'indent';
            if (!op) return;
            e.preventDefault();
            reorderRef.current?.(id, op);
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, []);

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
            onNodeClick={(_, node) => onSelect?.(node.id)}
            onPaneClick={() => onSelect?.(null)}
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
