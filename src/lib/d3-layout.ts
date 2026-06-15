/**
 * Bi-directional mindmap layout (left/right) using d3-flextree.
 *
 * Why flextree over plain d3.tree (Reingold–Tilford): the tidy-tree algorithm
 * assumes uniform node sizes, so with many variably-sized cards you get wasted
 * gaps or overlaps. d3-flextree generalizes Reingold–Tilford to **variable node
 * bounding boxes**, packing each subtree by its actual extent → compact, never
 * overlapping, even with hundreds of nodes. (Klortho/d3-flextree)
 *
 * On top of that we balance the L1 children across the two sides by **subtree
 * leaf weight** (not raw count), so a few heavy branches don't pile onto one
 * side and leave the other empty.
 *
 * Axis mapping: flextree lays a tree top→down (x = breadth/sibling, y = depth).
 * We rotate it to a horizontal mindmap — depth → horizontal, breadth → vertical.
 */

import { flextree, type FlextreeNode } from 'd3-flextree';
import { MindmapNode } from '../types/mindmap';
import { Node, Edge } from '@xyflow/react';

// ─── Layout constants ───
const HORIZONTAL_GAP = 60; // depth-axis gap between a node and its children
const VERTICAL_GAP = 22;   // breadth-axis gap between sibling cards
const CENTER_X = 0;
const CENTER_Y = 0;

const NODE_WIDTH_CONFIG = {
    root: { min: 200, max: 320, fontSize: 16, padding: 32, lineH: 22, padV: 24 },
    child: { min: 120, max: 280, fontSize: 14, padding: 32, lineH: 19, padV: 20 },
};

// ─── Size cache (invalidates on label change) ───
interface Measure {
    label: string;
    width: number;  // clamped card width
    height: number; // estimated card height (accounts for wrapping)
}
const measureCache = new Map<string, Measure>();

/** Natural (unclamped) text width using CJK=1em, ASCII≈0.55em weights. */
function naturalTextWidth(label: string, fontSize: number, padding: number): number {
    let total = 0;
    for (const ch of label) {
        const code = ch.charCodeAt(0);
        if ((code >= 0xac00 && code <= 0xd7af) || (code >= 0x4e00 && code <= 0x9fff)) {
            total += fontSize; // CJK ~1em
        } else {
            total += fontSize * 0.55; // ASCII/Latin
        }
    }
    return total + padding;
}

function measureNode(node: MindmapNode, isRoot: boolean): Measure {
    const cached = measureCache.get(node.id);
    if (cached && cached.label === node.label) return cached;

    const cfg = isRoot ? NODE_WIDTH_CONFIG.root : NODE_WIDTH_CONFIG.child;

    // image nodes: honour persisted display size
    if (node.kind === 'image' && node.image_width) {
        const m: Measure = {
            label: node.label,
            width: Math.min(Math.max(node.image_width + 32, 120), 520),
            height: Math.min(Math.max((node.image_height ?? 150) + 24, 80), 560),
        };
        measureCache.set(node.id, m);
        return m;
    }

    const natural = naturalTextWidth(node.label || ' ', cfg.fontSize, cfg.padding);
    const width = Math.min(Math.max(natural, cfg.min), cfg.max);
    const lines = Math.max(1, Math.ceil(natural / Math.max(width, 1)));
    const height = lines * cfg.lineH + cfg.padV;

    const m: Measure = { label: node.label, width, height };
    measureCache.set(node.id, m);
    return m;
}

/** Cached clamped node width (kept for backward-compatible callers). */
export function getCachedWidth(id: string, label: string, isRoot = false): number {
    const cached = measureCache.get(id);
    if (cached && cached.label === label) return cached.width;
    return measureNode({ id, label, type: '', children: [] }, isRoot).width;
}

export function clearWidthCache(): void {
    measureCache.clear();
}

export const estimateNodeWidth = (label: string, isRoot: boolean): number =>
    measureNode({ id: `__tmp__:${label}`, label, type: '', children: [] }, isRoot).width;

export interface LayoutResult {
    nodes: Node[];
    edges: Edge[];
}

// ─── flextree data shape ───
interface FData {
    node: MindmapNode;
    /** [breadthExtent, depthExtent] = [cardHeight+gap, cardWidth+gap]. */
    size: [number, number];
    colorIndex: number;
    children: FData[];
}

function toFData(node: MindmapNode, isRoot: boolean, colorIndex: number): FData {
    const m = measureNode(node, isRoot);
    return {
        node,
        size: [m.height + VERTICAL_GAP, m.width + HORIZONTAL_GAP],
        colorIndex,
        children: (node.children ?? []).map((c) => toFData(c, false, colorIndex)),
    };
}

function leafCount(node: MindmapNode): number {
    if (!node.children || node.children.length === 0) return 1;
    return node.children.reduce((sum, c) => sum + leafCount(c), 0);
}

/** Split L1 children into right/left, balancing by subtree leaf weight (order preserved). */
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

    const rootMeasure = measureNode(rootNode, true);
    const virtualRoot: FData = {
        node: rootNode,
        // tighten the gap between the center root and L1 (half root width + gap)
        size: [rootMeasure.height + VERTICAL_GAP, rootMeasure.width / 2 + HORIZONTAL_GAP],
        colorIndex: -1,
        children: sideChildren.map((c) => toFData(c, false, colorOf(c))),
    };

    const layout = flextree<FData>({
        children: (d) => d.children,
        nodeSize: (n) => n.data.size,
    });
    const tree = layout.hierarchy(virtualRoot);
    layout(tree);

    tree.each((n: FlextreeNode<FData>) => {
        if (n.data.colorIndex === -1) return; // skip virtual root
        const m = measureNode(n.data.node, false);
        const depth = n.y; // horizontal offset from center
        const breadth = n.x; // vertical offset (centered)
        const posX = side === 'right' ? CENTER_X + depth : CENTER_X - depth - m.width;
        const posY = CENTER_Y + breadth - m.height / 2;
        out.push(createReactFlowNode(n.data.node, posX, posY, n.depth, side, n.data.colorIndex, onExpand));
    });
}

export function calculateD3Layout(
    rootNode: MindmapNode,
    onExpand: (node: MindmapNode) => void,
): LayoutResult {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    const rootMeasure = measureNode(rootNode, true);
    // center root (React Flow position = top-left → offset by half its box)
    nodes.push(
        createReactFlowNode(rootNode, CENTER_X - rootMeasure.width / 2, CENTER_Y - rootMeasure.height / 2, 0, 'center', 0, onExpand),
    );

    if (!rootNode.children || rootNode.children.length === 0) {
        return { nodes, edges };
    }

    const { right, left } = balanceSides(rootNode.children);
    const colorOf = (child: MindmapNode) => rootNode.children.indexOf(child);

    layoutSide(rootNode, right, colorOf, 'right', onExpand, nodes);
    layoutSide(rootNode, left, colorOf, 'left', onExpand, nodes);

    // edges (independent of geometry)
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
