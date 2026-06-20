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
import { X } from 'lucide-react';
import { MindmapCanvas, type MindmapNodeData } from './MindmapCanvas';
import { FrameworkPanel } from './FrameworkPanel';
import { calculateD3Layout } from '../lib/d3-layout';
import { documentToTree, treeToDocument, treeToMarkdown } from '../lib/markdownTree';
import { reorderNode, canReorder, type ReorderOp } from '../lib/mindmapReorder';
import { expandNode, type ExpandContext } from '../services/aiService';
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
    /** 프레임워크 생성 패널 열림 상태 — 메인 툴바 버튼이 트리거, App 이 소유(#60 통합). */
    frameworkOpen?: boolean;
    onCloseFramework?: () => void;
    /** Split 비활성 패인의 미러 — 편집 액션(이동/추가/삭제/이름편집/AI확장) 비표시. 보기/팬/줌만. (이슈 #64) */
    readOnly?: boolean;
}

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

/** AI 확장에 필요한 맥락을 메모리 트리에서 도출(path-id 기반 조상·형제·기존자식·깊이). */
function collectExpandContext(root: MindmapNode, id: string, language = 'Korean'): ExpandContext | null {
    const target = findNodeById(root, id);
    if (!target) return null;
    const parts = id.split('/').slice(1).map(Number);
    const ancestorLabels: string[] = [root.label];
    let cur: MindmapNode | undefined = root;
    for (const i of parts) {
        cur = cur?.children[i];
        if (!cur) break;
        ancestorLabels.push(cur.label);
    }
    const { parent } = findParentById(root, id);
    const siblingLabels = parent ? parent.children.filter((c) => c.id !== id).map((c) => c.label) : [];
    return {
        rootTopic: root.label,
        ancestorLabels,
        targetLabel: target.label,
        targetDescription: target.description,
        siblingLabels,
        existingChildLabels: (target.children ?? []).map((c) => c.label),
        depth: parts.length,
        language,
    };
}

/** 맥락 부족 시 AI 가 던진 질문에 한 줄 답을 받는 작은 카드(중앙 오버레이, 좌표 계산 없음). */
function ClarifyCard({
    question,
    onSubmit,
    onCancel,
}: {
    question: string;
    onSubmit: (answer: string) => void;
    onCancel: () => void;
}) {
    const [val, setVal] = useState('');
    return (
        <div className="mm-clarify-backdrop" onClick={onCancel} aria-hidden>
            <div className="mm-clarify" role="dialog" aria-modal onClick={(e) => e.stopPropagation()}>
                <div className="mm-clarify-q">{question}</div>
                <input
                    className="mm-clarify-input"
                    autoFocus
                    value={val}
                    onChange={(e) => setVal(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && val.trim()) {
                            e.preventDefault();
                            onSubmit(val.trim());
                        } else if (e.key === 'Escape') {
                            e.preventDefault();
                            onCancel();
                        }
                    }}
                    placeholder="답을 입력하고 Enter…"
                />
                <div className="mm-clarify-actions">
                    <button onClick={onCancel}>취소</button>
                    <button className="mm-clarify-go" disabled={!val.trim()} onClick={() => onSubmit(val.trim())}>
                        확장
                    </button>
                </div>
            </div>
        </div>
    );
}

export function MindmapView({ content, onChange, fileName, onJumpToSource, frameworkOpen, onCloseFramework, readOnly = false }: MindmapViewProps) {
    const stem = useMemo(() => stemOf(fileName), [fileName]);
    const charCount = content.trim().length;

    const initial = useMemo(() => documentToTree(content, stem), []); // mount only
    const [tree, setTree] = useState<MindmapNode>(initial.tree);
    const [frontmatter, setFrontmatter] = useState(initial.frontmatter);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [expandingId, setExpandingId] = useState<string | null>(null);
    const [clarify, setClarify] = useState<{ nodeId: string; question: string } | null>(null);
    const [expandError, setExpandError] = useState<string | null>(null);
    const expandingRef = useRef(false);

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

    /** AI 노드 확장 — 맥락 수집 → expandNode → 자식 삽입(commitTree). clarification 시 카드 노출.
     *  undo 는 commitTree→onChange→문서 undo 스택으로 자동. 동시 확장은 expandingRef 로 차단. */
    const runExpand = useCallback(async (nodeId: string, clarificationAnswer?: string) => {
        if (expandingRef.current) return;
        const ctx = collectExpandContext(treeRef.current, nodeId);
        if (!ctx) return;
        if (clarificationAnswer) ctx.clarificationAnswer = clarificationAnswer;
        expandingRef.current = true;
        setExpandError(null);
        setClarify(null);
        setExpandingId(nodeId);
        try {
            const res = await expandNode(ctx);
            if ('needs_clarification' in res) {
                setClarify({ nodeId, question: res.clarifying_question });
                return;
            }
            if (res.children.length === 0) {
                setExpandError('생성된 자식 아이디어가 없습니다. 노드를 더 구체화한 뒤 다시 시도해보세요.');
                return;
            }
            const clone = structuredClone(treeRef.current);
            const parent = findNodeById(clone, nodeId);
            if (!parent) return;
            // 삽입 자식의 origin — 부모가 heading 자식을 가지면 heading(append 시 마지막 heading 에
            // 오결합 방지, 불변식 B), 그 외(빈/list 부모)는 list. list 부모는 절대 heading 자식 X(불변식 A).
            const childOrigin: 'heading' | 'list' =
                parent.mdOrigin !== 'list' && parent.children.some((c) => c.mdOrigin === 'heading')
                    ? 'heading'
                    : 'list';
            for (const c of res.children) {
                parent.children.push({
                    id: '',
                    label: c.label,
                    type: 'sub_branch',
                    mdOrigin: childOrigin,
                    description: c.description,
                    children: [],
                });
            }
            commitTree(clone);
            setSelectedId(nodeId);
        } catch (e) {
            setExpandError(e instanceof Error ? e.message : 'AI 확장에 실패했습니다.');
        } finally {
            expandingRef.current = false;
            setExpandingId(null);
        }
    }, [commitTree]);

    const handleExpand = useCallback((node: MindmapNode) => { void runExpand(node.id); }, [runExpand]);

    /** 프레임워크 생성 결과 적용 — 교체(commitTree) 또는 이어붙이기(마크다운 병합 후 재파싱).
     *  둘 다 onChange 경유라 문서 undo 스택에 잡힘(⌘Z 되돌림). SSOT 보존. */
    const applyFramework = useCallback((genTree: MindmapNode, mode: 'replace' | 'append') => {
        setEditingId(null);
        setSelectedId(null);
        if (mode === 'append') {
            const body = treeToMarkdown(genTree);
            const base = content.trimEnd();
            const merged = base ? `${base}\n\n${body}` : body;
            lastEmittedRef.current = merged;
            const reparsed = documentToTree(merged, stemRef.current);
            setFrontmatter(reparsed.frontmatter);
            setTree(reparsed.tree);
            onChange(merged);
        } else {
            commitTree(genTree);
        }
    }, [content, onChange, commitTree]);

    const layout = useMemo(() => calculateD3Layout(tree, handleExpand), [tree, handleExpand]);

    const nodes: Node[] = useMemo(() =>
        layout.nodes.map((n) => {
            const base = n.data as MindmapNodeData;
            return {
                ...n,
                data: {
                    ...base,
                    readOnly,
                    isEditing: n.id === editingId,
                    isSelected: n.id === selectedId,
                    isExpanding: n.id === expandingId,
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
        [layout, tree, editingId, selectedId, expandingId, updateLabel, addChild, deleteNode, moveNode, onJumpToSource, readOnly],
    );

    return (
        <div className="mindmap-view">
            <div className="mindmap-canvas-wrap">
                <MindmapCanvas
                    nodes={nodes}
                    edges={layout.edges}
                    fitKey={stem}
                    selectedId={selectedId}
                    editing={editingId !== null}
                    onSelect={setSelectedId}
                    onReorder={readOnly ? undefined : moveNode}
                />
            </div>
            {expandError && (
                <div className="mm-expand-error" role="alert">
                    <span>{expandError}</span>
                    <button onClick={() => setExpandError(null)} title="닫기">
                        <X size={13} />
                    </button>
                </div>
            )}
            {clarify && (
                <ClarifyCard
                    question={clarify.question}
                    onSubmit={(answer) => { void runExpand(clarify.nodeId, answer); }}
                    onCancel={() => setClarify(null)}
                />
            )}
            {frameworkOpen && (
                <FrameworkPanel
                    initialTopic={(treeRef.current.label || stem).trim()}
                    docNonEmpty={charCount >= MIN_CHARS}
                    onApply={applyFramework}
                    onClose={() => onCloseFramework?.()}
                />
            )}
        </div>
    );
}
