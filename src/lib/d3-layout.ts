/**
 * Bi-directional mindmap layout (left/right) using d3-flextree.
 *
 * Overlap-proof "fixed MAX slot" strategy: every node is laid out in a uniform
 * MAX_W × MAX_H box, and the card's content is clamped to that box in CSS
 * (label 2 lines, description 3 lines, max-width). Because no card can exceed
 * its slot, columns (spaced by MAX_W + gap) and rows (spaced by MAX_H + gap)
 * can never collide — regardless of how the browser actually wraps the text.
 *
 * flextree gives node.x (breadth → vertical) and node.y (depth → horizontal,
 * cumulative: child.y = parent.y + parent.depthSize). A light per-node size
 * estimate is used ONLY to place the card nicely inside its fixed slot
 * (left-align on the left side, vertical-center) — never for spacing.
 *
 * L1 children are split across the two sides by subtree leaf weight so heavy
 * branches don't pile onto one side.
 */

import { flextree, type FlextreeNode } from 'd3-flextree';
import { MindmapNode } from '../types/mindmap';
import { Node, Edge } from '@xyflow/react';

// ─── Layout constants ───
const MAX_W = 280;          // fixed slot width (cards clamped to this in CSS)
const MAX_H = 124;          // fixed slot height (cards clamped to this in CSS)
const HORIZONTAL_GAP = 56;  // gap between depth columns
const VERTICAL_GAP = 26;    // gap between sibling rows
const CENTER_X = 0;
const CENTER_Y = 0;

const SLOT_W = MAX_W + HORIZONTAL_GAP;
const SLOT_H = MAX_H + VERTICAL_GAP;

const FONT = { root: 16, child: 14 };
const LINE_H = { root: 22, child: 19 };
const DESC_LINE_H = 16;
const PAD_H = 44; // total horizontal padding (matches .mm-node)
const PAD_V = 18; // total vertical padding
const MIN_W = 120;

/** Char-weighted text width (CJK ≈ 1em, ASCII ≈ 0.55em). */
function textWidth(label: string, fontSize: number): number {
    let total = 0;
    for (const ch of label) {
        const code = ch.charCodeAt(0);
        total += (code >= 0xac00 && code <= 0xd7af) || (code >= 0x4e00 && code <= 0x9fff)
            ? fontSize
            : fontSize * 0.55;
    }
    return total;
}

/** Estimate the rendered card size, clamped to the slot. Used for in-slot
 *  placement only (not spacing), so small errors never cause overlap. */
function estimateCard(node: MindmapNode, isRoot: boolean): { w: number; h: number } {
    if (node.kind === 'image' && node.image_width) {
        return {
            w: Math.min(Math.max(node.image_width + 32, MIN_W), MAX_W),
            h: Math.min(Math.max((node.image_height ?? 150) + 24, 60), MAX_H),
        };
    }
    const font = isRoot ? FONT.root : FONT.child;
    const lineH = isRoot ? LINE_H.root : LINE_H.child;
    const tw = textWidth(node.label || ' ', font);
    const w = Math.min(Math.max(tw + PAD_H, MIN_W), MAX_W);
    const textArea = Math.max(40, w - PAD_H);
    const labelLines = Math.min(2, Math.max(1, Math.ceil(tw / textArea)));
    let h = labelLines * lineH + PAD_V;
    const desc = node.description?.trim();
    if (desc) {
        const dw = textWidth(desc.replace(/\s+/g, ' '), font - 3);
        const descLines = Math.min(3, Math.max(1, Math.ceil(dw / textArea)));
        h += descLines * DESC_LINE_H + 4;
    }
    return { w, h: Math.min(h, MAX_H) };
}

export interface LayoutResult {
    nodes: Node[];
    edges: Edge[];
}

// ─── flextree data shape (uniform slot size) ───
interface FData {
    node: MindmapNode;
    /** [breadth, depth] — UNIFORM slot so spacing can't overlap. */
    size: [number, number];
    colorIndex: number;
    children: FData[];
}

function toFData(node: MindmapNode, colorIndex: number): FData {
    return {
        node,
        size: [SLOT_H, SLOT_W],
        colorIndex,
        children: (node.children ?? []).map((c) => toFData(c, colorIndex)),
    };
}

function leafCount(node: MindmapNode): number {
    if (!node.children || node.children.length === 0) return 1;
    return node.children.reduce((sum, c) => sum + leafCount(c), 0);
}

/** Split L1 children into right/left, balancing by subtree leaf weight. */
function balanceSides(children: MindmapNode[]): { right: MindmapNode[]; left: MindmapNode[] } {
    if (children.length <= 1) return { right: children, left: [] };
    const weights = children.map(leafCount);
    const total = weights.reduce((a, b) => a + b, 0);
    let acc = 0;
    let splitIdx = children.length;
    for (let i = 0; i < children.length; i++) {
        acc += weights[i];
        if (acc >= total / 2) {
            splitIdx = i + 1;
            break;
        }
    }
    splitIdx = Math.max(1, Math.min(splitIdx, children.length - 1));
    return { right: children.slice(0, splitIdx), left: children.slice(splitIdx) };
}

function layoutSide(
    rootNode: MindmapNode,
    sideChildren: MindmapNode[],
    colorOf: (child: MindmapNode) => number,
    side: 'left' | 'right',
    onExpand: (node: MindmapNode) => void,
    out: Node[],
): void {
    if (sideChildren.length === 0) return;

    const rootW = estimateCard(rootNode, true).w;
    const virtualRoot: FData = {
        node: rootNode,
        // depth: half the root + gap so L1 hugs the centre root
        size: [SLOT_H, rootW / 2 + HORIZONTAL_GAP],
        colorIndex: -1,
        children: sideChildren.map((c) => toFData(c, colorOf(c))),
    };

    const layout = flextree<FData>({
        children: (d) => d.children,
        nodeSize: (n) => n.data.size,
    });
    const tree = layout.hierarchy(virtualRoot);
    layout(tree);

    tree.each((n: FlextreeNode<FData>) => {
        if (n.data.colorIndex === -1) return; // skip virtual root
        const card = estimateCard(n.data.node, false);
        // node.y = left edge of this node's depth slot; node.x = slot centre (breadth)
        const posX = side === 'right' ? CENTER_X + n.y : CENTER_X - n.y - card.w;
        const posY = CENTER_Y + n.x - card.h / 2;
        out.push(createReactFlowNode(n.data.node, posX, posY, n.depth, side, n.data.colorIndex, onExpand));
    });
}

export function calculateD3Layout(
    rootNode: MindmapNode,
    onExpand: (node: MindmapNode) => void,
): LayoutResult {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    const rootCard = estimateCard(rootNode, true);
    nodes.push(
        createReactFlowNode(rootNode, CENTER_X - rootCard.w / 2, CENTER_Y - rootCard.h / 2, 0, 'center', 0, onExpand),
    );

    if (!rootNode.children || rootNode.children.length === 0) {
        return { nodes, edges };
    }

    const { right, left } = balanceSides(rootNode.children);
    const colorOf = (child: MindmapNode) => rootNode.children.indexOf(child);

    layoutSide(rootNode, right, colorOf, 'right', onExpand, nodes);
    layoutSide(rootNode, left, colorOf, 'left', onExpand, nodes);

    const addChildEdges = (parent: MindmapNode, side: 'left' | 'right') => {
        for (const child of parent.children ?? []) {
            edges.push(createEdge(parent.id, child.id, side));
            addChildEdges(child, side);
        }
    };
    for (const child of right) {
        edges.push(createEdge(rootNode.id, child.id, 'right'));
        addChildEdges(child, 'right');
    }
    for (const child of left) {
        edges.push(createEdge(rootNode.id, child.id, 'left'));
        addChildEdges(child, 'left');
    }

    return { nodes, edges };
}

function createReactFlowNode(
    node: MindmapNode,
    x: number,
    y: number,
    level: number,
    side: 'left' | 'right' | 'center',
    colorIndex: number,
    onExpand: (node: MindmapNode) => void,
): Node {
    return {
        id: node.id,
        type: 'mindmap',
        position: { x, y },
        data: {
            label: node.label,
            node,
            level,
            side,
            colorIndex,
            hasChildren: (node.children?.length ?? 0) > 0,
            childrenCount: node.children?.length ?? 0,
            canExpand: level < 4,
            mdLine: node.mdLine,
            onExpand: () => onExpand(node),
        },
    };
}

function createEdge(sourceId: string, targetId: string, side: 'left' | 'right'): Edge {
    return {
        id: `edge-${sourceId}-${targetId}`,
        source: sourceId,
        target: targetId,
        sourceHandle: side,
        targetHandle: side === 'right' ? 'left' : 'right',
        type: 'bezier',
    };
}
