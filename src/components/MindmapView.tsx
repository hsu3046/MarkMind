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
import { MindmapCanvas, type MindmapNodeData } from './MindmapCanvas';
import { calculateD3Layout, type SizeOverride } from '../lib/d3-layout';
import { documentToTree, treeToDocument } from '../lib/markdownTree';
import type { MindmapNode } from '../types/mindmap';

interface MindmapViewProps {
    content: string;
    onChange: (md: string) => void;
    fileName: string;
    /** Drill-in: open a linked document (M2 navigation; M1 may pass a basic opener). */
    onOpenDocument?: (target: string, isWiki: boolean) => void;
    /** Jump to this node's section (source line) in the editor. */
    onJumpToSource?: (line: number) => void;
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

export function MindmapView({ content, onChange, fileName, onOpenDocument, onJumpToSource }: MindmapViewProps) {
    const stem = useMemo(() => stemOf(fileName), [fileName]);

    const initial = useMemo(() => documentToTree(content, stem), []); // mount only
    const [tree, setTree] = useState<MindmapNode>(initial.tree);
    const [frontmatter, setFrontmatter] = useState(initial.frontmatter);
    const [editingId, setEditingId] = useState<string | null>(null);

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

    const openLink = useCallback((node: MindmapNode) => {
        const link = node.links?.[0];
        if (link && onOpenDocument) onOpenDocument(link.target, link.isWiki);
    }, [onOpenDocument]);

    // Real measured node sizes (from React Flow) → re-layout so flextree spaces by
    // actual height. Settles in one pass via the equality guard below.
    const [measuredSizes, setMeasuredSizes] = useState<SizeOverride | undefined>(undefined);
    const handleNodesMeasured = useCallback((sizes: SizeOverride) => {
        setMeasuredSizes((prev) => (sameSizes(prev, sizes) ? prev : sizes));
    }, []);

    const layout = useMemo(() => calculateD3Layout(tree, NOOP, measuredSizes), [tree, measuredSizes]);

    const nodes: Node[] = useMemo(() =>
        layout.nodes.map((n) => {
            const base = n.data as MindmapNodeData;
            const linkCount = base.node?.links?.length ?? 0;
            return {
                ...n,
                data: {
                    ...base,
                    isEditing: n.id === editingId,
                    hasLinks: linkCount > 0,
                    linkCount,
                    canDrill: !!onOpenDocument,
                    onStartEdit: () => setEditingId(n.id),
                    onUpdateLabel: (v: string) => updateLabel(n.id, v),
                    onCancelEdit: () => setEditingId(null),
                    onAddChild: () => addChild(n.id),
                    onDelete: () => deleteNode(n.id),
                    onOpenLink: () => openLink(base.node),
                    onJumpToSource: base.mdLine !== undefined && onJumpToSource
                        ? () => onJumpToSource(base.mdLine as number)
                        : undefined,
                } satisfies MindmapNodeData,
            };
        }),
        [layout, editingId, updateLabel, addChild, deleteNode, openLink, onOpenDocument, onJumpToSource],
    );

    return (
        <div style={{ flex: 1, width: '100%', height: '100%', minWidth: 0, minHeight: 0 }}>
            <MindmapCanvas nodes={nodes} edges={layout.edges} fitKey={stem} onNodesMeasured={handleNodesMeasured} />
        </div>
    );
}

/** Two size maps equal within 1px (avoids a re-layout loop from sub-pixel jitter). */
function sameSizes(a: SizeOverride | undefined, b: SizeOverride): boolean {
    if (!a || a.size !== b.size) return false;
    for (const [id, s] of b) {
        const p = a.get(id);
        if (!p || Math.abs(p.width - s.width) > 1 || Math.abs(p.height - s.height) > 1) return false;
    }
    return true;
}
