/**
 * Outliner-style node reorder for the mindmap (markdown↔tree bridge aware).
 *
 * The mindmap is a derived view of markdown, so "moving a node" really means
 * restructuring the underlying document. These four operations mirror an
 * outliner (Obsidian outline / Workflowy):
 *
 *   up / down  — reorder among same-level siblings (same heading/list group)
 *   indent     — demote: become the last child of the previous sibling
 *   outdent    — promote: become a sibling of the parent (after it)
 *
 * The serializer (markdownTree.ts `serializeNode`) is structural + clamped:
 *   - list nesting depth is computed from tree depth (no stored level),
 *   - heading level = clamp(wanted, parentHeadingLevel+1, 6).
 * So after a move we only have to keep the tree VALID; the serializer fixes
 * levels. "Valid" means two invariants the markdown round-trip relies on:
 *
 *   (A) origin compatibility — a `list` node may only hold `list` children
 *       (you cannot nest a heading inside a bullet in CommonMark). So when a
 *       node lands under a list parent we coerce the whole moved subtree to
 *       the list family.
 *   (B) sibling ordering — within any parent, all `list` children precede all
 *       `heading` children (the parser attaches bullets to a heading until a
 *       sub-heading appears, then later bullets bind to that sub-heading). So
 *       inserts are clamped into the node's own origin group.
 *
 * Heading-family moves additionally drop `mdLevel` on the moved subtree so the
 * serializer re-levels it structurally (no skipped `##`→`####`). All functions
 * are pure: `reorderNode` clones the input and returns a fresh tree.
 *
 * IDs are path-based (`n/0/2`) and regenerate on re-parse, so each op also
 * returns the moved node's NEW id (computed from the stable new-parent path)
 * for the view to re-select after commit.
 */

import type { MindmapNode } from '../types/mindmap';

export type ReorderOp = 'up' | 'down' | 'indent' | 'outdent';

interface Located {
    node: MindmapNode;
    parent: MindmapNode;
    index: number;
    grandparent: MindmapNode | null;
    /** Index of `parent` within `grandparent` (−1 when parent is the root). */
    parentIndex: number;
}

/** Effective origin family: 'root' / undefined behave as the heading family. */
function effOrigin(n: MindmapNode): 'heading' | 'list' {
    return n.mdOrigin === 'list' ? 'list' : 'heading';
}

function nodeAtPath(root: MindmapNode, parts: number[]): MindmapNode | null {
    let cur: MindmapNode | undefined = root;
    for (const i of parts) {
        cur = cur?.children[i];
        if (!cur) return null;
    }
    return cur ?? null;
}

/** Resolve a path-based id to the node plus its parent/grandparent context. */
function locate(root: MindmapNode, id: string): Located | null {
    const parts = id.split('/').slice(1).map(Number);
    if (parts.length === 0) return null; // the root itself cannot be moved
    const index = parts[parts.length - 1];
    const parentParts = parts.slice(0, -1);
    const parent = nodeAtPath(root, parentParts);
    if (!parent) return null;
    const node = parent.children[index];
    if (!node) return null;
    const grandparent = parentParts.length === 0 ? null : nodeAtPath(root, parentParts.slice(0, -1));
    const parentIndex = parentParts.length === 0 ? -1 : parentParts[parentParts.length - 1];
    return { node, parent, index, grandparent, parentIndex };
}

/** Invariant (A): a node under a list parent — and its whole subtree — must be
 *  list-origin. Drop levels too (lists carry no heading level). */
function coerceListFamily(n: MindmapNode): void {
    n.mdOrigin = 'list';
    delete n.mdLevel;
    for (const c of n.children) coerceListFamily(c);
}

/** Heading-family move: re-level structurally by dropping stored heading levels
 *  on the moved subtree (origins kept, so headings stay headings, lists lists). */
function stripLevels(n: MindmapNode): void {
    delete n.mdLevel;
    for (const c of n.children) stripLevels(c);
}

/** Index where the heading group starts (= end of the list group). */
function firstHeadingIndex(children: MindmapNode[]): number {
    const i = children.findIndex((c) => effOrigin(c) === 'heading');
    return i === -1 ? children.length : i;
}

/** Insert `node` into `parent.children` at `preferred`, clamped to keep
 *  invariant (B): lists before headings. Returns the actual insert index. */
function insertOrdered(parent: MindmapNode, node: MindmapNode, preferred: number): number {
    const fh = firstHeadingIndex(parent.children);
    const [lo, hi] = effOrigin(node) === 'list' ? [0, fh] : [fh, parent.children.length];
    const idx = Math.max(lo, Math.min(preferred, hi));
    parent.children.splice(idx, 0, node);
    return idx;
}

/** Whether `op` is allowed for the node `id` (drives button enable/disable). */
export function canReorder(root: MindmapNode, id: string, op: ReorderOp): boolean {
    const loc = locate(root, id);
    if (!loc) return false;
    const { node, parent, index, grandparent } = loc;
    switch (op) {
        case 'up':
            return index > 0 && effOrigin(parent.children[index - 1]) === effOrigin(node);
        case 'down':
            return index < parent.children.length - 1 && effOrigin(parent.children[index + 1]) === effOrigin(node);
        case 'indent':
            return index > 0; // needs a previous sibling to nest under
        case 'outdent':
            return !!grandparent; // a direct child of the root cannot promote
    }
}

/**
 * Apply a reorder op. Returns a fresh mutated tree + the moved node's new id,
 * or null when the op is not allowed (mirrors `canReorder`).
 */
export function reorderNode(
    root: MindmapNode,
    id: string,
    op: ReorderOp,
): { tree: MindmapNode; newId: string } | null {
    const tree = structuredClone(root);
    const loc = locate(tree, id);
    if (!loc) return null;
    const { node, parent, index, grandparent, parentIndex } = loc;

    if (op === 'up' || op === 'down') {
        const j = op === 'up' ? index - 1 : index + 1;
        if (j < 0 || j >= parent.children.length) return null;
        if (effOrigin(parent.children[j]) !== effOrigin(node)) return null; // group boundary
        [parent.children[index], parent.children[j]] = [parent.children[j], parent.children[index]];
        return { tree, newId: `${parent.id}/${j}` };
    }

    if (op === 'indent') {
        if (index === 0) return null;
        const target = parent.children[index - 1]; // previous sibling (stays at index−1)
        parent.children.splice(index, 1);
        if (effOrigin(target) === 'list') coerceListFamily(node);
        else stripLevels(node);
        const insertIdx = insertOrdered(target, node, target.children.length);
        return { tree, newId: `${target.id}/${insertIdx}` };
    }

    // outdent
    if (!grandparent) return null;
    parent.children.splice(index, 1);
    if (effOrigin(grandparent) === 'list') coerceListFamily(node);
    else stripLevels(node);
    const insertIdx = insertOrdered(grandparent, node, parentIndex + 1);
    return { tree, newId: `${grandparent.id}/${insertIdx}` };
}
