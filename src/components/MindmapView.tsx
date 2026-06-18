/**
 * Mindmap view mode — a derived, editable view of the markdown document.
 *
 * Markdown `content` is the single source of truth: it is parsed into a tree
 * (documentToTree), laid out by d3 (calculateD3Layout), and rendered by
 * MindmapCanvas. Edits mutate an in-memory tree, re-serialize to canonical
 * markdown (treeToDocument), and flow back through `onChange` — the same write
 * path Editor/Preview use. A self-echo guard prevents our own emit from
 * re-parsing and resetting edit state.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Node } from '@xyflow/react';
import { Loader2, ListTree } from 'lucide-react';
import { MindmapCanvas, type MindmapNodeData } from './MindmapCanvas';
import { calculateD3Layout } from '../lib/d3-layout';
import { documentToTree, treeToDocument } from '../lib/markdownTree';
import { reorderNode, canReorder, type ReorderOp } from '../lib/mindmapReorder';
import type { MindmapNode } from '../types/mindmap';
import './MindmapView.css';

/** 정리하기엔 너무 짧은 문서 가드(플로우차트 뷰와 동일 정신). */
const MIN_CHARS = 40;

interface MindmapViewProps {
    content: string;
    onChange: (md: string) => void;
    fileName: string;
    /** Jump to this node's section (source line) in the editor. */
    onJumpToSource?: (line: number) => void;
    /** 마인드맵 정리(structurize) — 현재 문서를 계층 아웃라인으로 재구성(#60). */
    onStructurize?: () => void;
    /** 정리 진행 중(AI 로딩). */
    structurizing?: boolean;
}

const NOOP = () => {};

function stemOf(fileName: string): string {
    return fileName.replace(/\.(md|markdown|mdx|txt)$/i, '').trim() || 'Untitled';
}

function findNodeById(root: MindmapNode, id: string): MindmapNode | null {
    if (id === root.id) return root;
    const parts = id.split('/').slice(1).map(Number);
    let cur: MindmapNode | undefined = root;
    for (const i of parts) {
        cur = cur.children[i];
        if (!cur) return null;
    }
    return cur ?? null;
}

function findParentById(root: MindmapNode, id: string): { parent: MindmapNode | null; index: number } {
    const parts = id.split('/').slice(1).map(Number);
    if (parts.length === 0) return { parent: null, index: -1 };
    const index = parts[parts.length - 1];
    let cur: MindmapNode | undefined = root;
    for (let k = 0; k < parts.length - 1; k++) {
        cur = cur.children[parts[k]];
        if (!cur) return { parent: null, index: -1 };
    }
    return { parent: cur ?? null, index };
}

export function MindmapView({ content, onChange, fileName, onJumpToSource, onStructurize, structurizing }: MindmapViewProps) {
    const stem = useMemo(() => stemOf(fileName), [fileName]);
    const charCount = content.trim().length;

    const initial = useMemo(() => documentToTree(content, stem), []); // mount only
    const [tree, setTree] = useState<MindmapNode>(initial.tree);
    const [frontmatter, setFrontmatter] = useState(initial.frontmatter);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);

    // refs for stable handlers + self-echo suppression
    const treeRef = useRef(tree);
    treeRef.current = tree;
    const fmRef = useRef(frontmatter);
    fmRef.current = frontmatter;
    const stemRef = useRef(stem);
    stemRef.current = stem;
    const lastEmittedRef = useRef<string>(content);

    // External content change (editor edit, file open) → re-parse. Skip our own echo.
    useEffect(() => {
        if (content === lastEmittedRef.current) return;
        const { frontmatter: fm, tree: t } = documentToTree(content, stemRef.current);
        setFrontmatter(fm);
        setTree(t);
        setEditingId(null);
    }, [content]);

    /** Apply a mutated tree: serialize → emit → re-parse to canonical form. */
    const commitTree = useCallback((mutated: MindmapNode): MindmapNode => {
        const md = treeToDocument(mutated, fmRef.current, stemRef.current);
        lastEmittedRef.current = md;
        const reparsed = documentToTree(md, stemRef.current);
        setFrontmatter(reparsed.frontmatter);
        setTree(reparsed.tree);
        onChange(md);
        return reparsed.tree;
    }, [onChange]);

    const updateLabel = useCallback((id: string, value: string) => {
        const clone = structuredClone(treeRef.current);
        const node = findNodeById(clone, id);
        if (node) node.label = value;
        setEditingId(null);
        commitTree(clone);
    }, [commitTree]);

    const addChild = useCallback((id: string) => {
        const clone = structuredClone(treeRef.current);
        const parent = findNodeById(clone, id);
        if (!parent) return;
        const idx = parent.children.length;
        parent.children.push({ id: '', label: '새 아이디어', type: 'sub_branch', children: [] });
        const newTree = commitTree(clone);
        const newId = `${id}/${idx}`;
        if (findNodeById(newTree, newId)) setEditingId(newId);
    }, [commitTree]);

    const deleteNode = useCallback((id: string) => {
        const clone = structuredClone(treeRef.current);
        const { parent, index } = findParentById(clone, id);
        if (!parent || index < 0) return;
        parent.children.splice(index, 1);
        setEditingId(null);
        commitTree(clone);
    }, [commitTree]);

    /** Outliner reorder (up/down/indent/outdent). Re-selects the moved node by
     *  its new path-based id so highlight/keyboard stay on it after re-parse. */
    const moveNode = useCallback((id: string, op: ReorderOp) => {
        const res = reorderNode(treeRef.current, id, op);
        if (!res) return;
        setEditingId(null);
        const newTree = commitTree(res.tree);
        if (findNodeById(newTree, res.newId)) setSelectedId(res.newId);
    }, [commitTree]);

    const layout = useMemo(() => calculateD3Layout(tree, NOOP), [tree]);

    const nodes: Node[] = useMemo(() =>
        layout.nodes.map((n) => {
            const base = n.data as MindmapNodeData;
            return {
                ...n,
                data: {
                    ...base,
                    isEditing: n.id === editingId,
                    isSelected: n.id === selectedId,
                    canUp: canReorder(tree, n.id, 'up'),
                    canDown: canReorder(tree, n.id, 'down'),
                    canIndent: canReorder(tree, n.id, 'indent'),
                    canOutdent: canReorder(tree, n.id, 'outdent'),
                    onMove: (op: ReorderOp) => moveNode(n.id, op),
                    onStartEdit: () => setEditingId(n.id),
                    onUpdateLabel: (v: string) => updateLabel(n.id, v),
                    onCancelEdit: () => setEditingId(null),
                    onAddChild: () => addChild(n.id),
                    onDelete: () => deleteNode(n.id),
                    onJumpToSource: base.mdLine !== undefined && onJumpToSource
                        ? () => onJumpToSource(base.mdLine as number)
                        : undefined,
                } satisfies MindmapNodeData,
            };
        }),
        [layout, tree, editingId, selectedId, updateLabel, addChild, deleteNode, moveNode, onJumpToSource],
    );

    return (
        <div className="mindmap-view">
            {onStructurize && (
                <div className="mindmap-toolbar">
                    <span className="mindmap-mode">
                        마인드맵{' · '}
                        <span className={charCount < MIN_CHARS ? 'mindmap-count-warn' : undefined}>
                            {charCount.toLocaleString()}자
                        </span>
                    </span>
                    <button
                        className="mindmap-gen-btn"
                        onClick={onStructurize}
                        disabled={structurizing || charCount < MIN_CHARS}
                        title={charCount < MIN_CHARS ? '정리하기엔 내용이 너무 짧습니다' : '문서를 계층 구조로 정리합니다'}
                    >
                        {structurizing ? <Loader2 size={14} className="spinning" /> : <ListTree size={14} />}
                        {structurizing ? '정리 중…' : '마인드맵 정리'}
                    </button>
                </div>
            )}
            <div className="mindmap-canvas-wrap">
                <MindmapCanvas
                    nodes={nodes}
                    edges={layout.edges}
                    fitKey={stem}
                    selectedId={selectedId}
                    editing={editingId !== null}
                    onSelect={setSelectedId}
                    onReorder={moveNode}
                />
            </div>
        </div>
    );
}
