import { describe, it, expect } from 'vitest';
import { documentToTree, treeToDocument } from './markdownTree';
import { reorderNode, canReorder, type ReorderOp } from './mindmapReorder';
import type { MindmapNode } from '../types/mindmap';

/** Resolve a path-based id (n/0/2) against a tree. */
function nodeById(root: MindmapNode, id: string): MindmapNode | null {
    const parts = id.split('/').slice(1).map(Number);
    let cur: MindmapNode | undefined = root;
    for (const i of parts) {
        cur = cur?.children[i];
        if (!cur) return null;
    }
    return cur ?? null;
}

/** Parse → reorder → serialize → re-parse. Returns the canonical markdown, the
 *  moved node's new id, and the label that id resolves to after the round-trip. */
function apply(md: string, id: string, op: ReorderOp) {
    const { tree } = documentToTree(md, 'Untitled');
    const res = reorderNode(tree, id, op);
    if (!res) return null;
    const out = treeToDocument(res.tree, '', 'Untitled');
    const { tree: reparsed } = documentToTree(out, 'Untitled');
    return { out: out.trim(), newId: res.newId, label: nodeById(reparsed, res.newId)?.label };
}

describe('mindmapReorder — same-level order (up/down)', () => {
    it('moves a heading down among heading siblings', () => {
        const r = apply('# Doc\n## A\n## B', 'n/0', 'down');
        expect(r?.out).toBe('# Doc\n\n## B\n\n## A');
        expect(r?.newId).toBe('n/1');
        expect(r?.label).toBe('A'); // the moved node is still A, now at n/1
    });

    it('moves a heading up among heading siblings', () => {
        const r = apply('# Doc\n## A\n## B', 'n/1', 'up');
        expect(r?.out).toBe('# Doc\n\n## B\n\n## A');
        expect(r?.label).toBe('B');
    });

    it('reorders bullet siblings', () => {
        const r = apply('# Doc\n- a\n- b', 'n/1', 'up');
        expect(r?.out).toBe('# Doc\n- b\n- a');
        expect(r?.label).toBe('b');
    });

    it('blocks moving the first sibling up', () => {
        expect(canReorder(documentToTree('# Doc\n## A\n## B', 'Untitled').tree, 'n/0', 'up')).toBe(false);
        expect(apply('# Doc\n## A\n## B', 'n/0', 'up')).toBeNull();
    });

    it('blocks moving the last sibling down', () => {
        expect(apply('# Doc\n## A\n## B', 'n/1', 'down')).toBeNull();
    });

    it('blocks crossing the list/heading boundary (bullet cannot pass a heading)', () => {
        const tree = documentToTree('# Doc\n- a\n## B', 'Untitled').tree;
        expect(canReorder(tree, 'n/0', 'down')).toBe(false); // bullet a can't go below heading B
        expect(canReorder(tree, 'n/1', 'up')).toBe(false);   // heading B can't go above bullet a
        expect(apply('# Doc\n- a\n## B', 'n/0', 'down')).toBeNull();
    });
});

describe('mindmapReorder — cross-level (indent/outdent)', () => {
    it('demotes a heading under its previous heading sibling (re-levels ##→###)', () => {
        const r = apply('# Doc\n## A\n## B', 'n/1', 'indent');
        expect(r?.out).toBe('# Doc\n\n## A\n\n### B');
        expect(r?.newId).toBe('n/0/0');
        expect(r?.label).toBe('B');
    });

    it('outdents a heading to its grandparent (###→##)', () => {
        const r = apply('# Doc\n## A\n### B', 'n/0/0', 'outdent');
        expect(r?.out).toBe('# Doc\n\n## A\n\n## B');
        expect(r?.newId).toBe('n/1');
        expect(r?.label).toBe('B');
    });

    it('demotes a heading under a bullet → coerced to a sub-bullet (invariant A)', () => {
        const r = apply('# Doc\n- a\n## B', 'n/1', 'indent');
        expect(r?.out).toBe('# Doc\n- a\n  - B');
        expect(r?.newId).toBe('n/0/0');
        expect(r?.label).toBe('B');
    });

    it('demotes a bullet under its previous bullet', () => {
        const r = apply('# Doc\n- a\n- b', 'n/1', 'indent');
        expect(r?.out).toBe('# Doc\n- a\n  - b');
        expect(r?.label).toBe('b');
    });

    it('carries the moved subtree with the node (demote re-levels descendants)', () => {
        const r = apply('# Doc\n## A\n## B\n### C', 'n/1', 'indent');
        // B (with child C) becomes a child of A: B ##→###, C ###→####
        expect(r?.out).toBe('# Doc\n\n## A\n\n### B\n\n#### C');
        expect(r?.label).toBe('B');
    });

    it('blocks indenting the first child (no previous sibling)', () => {
        expect(canReorder(documentToTree('# Doc\n## A\n## B', 'Untitled').tree, 'n/0', 'indent')).toBe(false);
        expect(apply('# Doc\n## A\n## B', 'n/0', 'indent')).toBeNull();
    });

    it('blocks outdenting a direct child of the root', () => {
        expect(canReorder(documentToTree('# Doc\n## A', 'Untitled').tree, 'n/0', 'outdent')).toBe(false);
        expect(apply('# Doc\n## A', 'n/0', 'outdent')).toBeNull();
    });

    it('keeps the lists-before-headings invariant when inserting a bullet', () => {
        // Section A holds a bullet then a sub-heading; outdent the deep bullet so
        // it lands in A's list group (before the sub-heading), not after it.
        const src = '# Doc\n## A\n- x\n### Sub\n- y';
        // locate y: A=n/0; A children = [x(list n/0/0), Sub(heading n/0/1)]; y under Sub = n/0/1/0
        const r = apply(src, 'n/0/1/0', 'outdent');
        // y promotes to be A's child; as a list it must precede Sub → re-parses cleanly
        expect(r?.label).toBe('y');
        // round-trip stable: re-serialize equals the parsed output (no drift)
        const reparsed = documentToTree(r!.out + '\n', 'Untitled').tree;
        expect(treeToDocument(reparsed, '', 'Untitled').trim()).toBe(r?.out);
    });
});

describe('mindmapReorder — round-trip stability', () => {
    it('every op output re-serializes idempotently', () => {
        const cases: Array<[string, string, ReorderOp]> = [
            ['# Doc\n## A\n## B', 'n/0', 'down'],
            ['# Doc\n## A\n## B', 'n/1', 'indent'],
            ['# Doc\n## A\n### B', 'n/0/0', 'outdent'],
            ['# Doc\n- a\n## B', 'n/1', 'indent'],
        ];
        for (const [md, id, op] of cases) {
            const r = apply(md, id, op)!;
            const reparsed = documentToTree(r.out + '\n', 'Untitled').tree;
            expect(treeToDocument(reparsed, '', 'Untitled').trim()).toBe(r.out);
        }
    });
});
