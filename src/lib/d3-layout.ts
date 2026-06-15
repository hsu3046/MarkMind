/**
 * Bi-directional Tree Layout using d3-hierarchy
 *
 * Ported from the MindBusiness project (only the import path changed). Strategy:
 * 1. Split L1 children into Left/Right teams
 * 2. Run d3.tree() separately for each team
 * 3. Flip left team's X coordinates (x *= -1)
 * 4. Merge with Root at center
 */

import { hierarchy, tree, HierarchyPointNode } from 'd3-hierarchy'
import { MindmapNode } from '../types/mindmap'
import { Node, Edge } from '@xyflow/react'

// ─── Layout Constants ───
const HORIZONTAL_GAP = 50    // Gap between node edges
const VERTICAL_GAP = 80      // Min gap between sibling nodes

// Center position for the mindmap
const CENTER_X = 600
const CENTER_Y = 400

// Node width constraints per level
const NODE_WIDTH_CONFIG = {
    root: { min: 200, max: 320, fontSize: 16, padding: 32 },
    child: { min: 120, max: 400, fontSize: 14, padding: 32 },
}

// ─── Width Cache ───
// Stores calculated widths to avoid recalculation on every render
const widthCache = new Map<string, { label: string; width: number }>()

/**
 * Get cached node width, or calculate and cache if not found
 * Cache invalidates automatically when label changes
 */
export function getCachedWidth(id: string, label: string, isRoot: boolean = false): number {
    const cached = widthCache.get(id)
    if (cached && cached.label === label) {
        return cached.width  // Cache hit!
    }
    // Cache miss → calculate and store
    const width = calculateWidth(label, isRoot)
    widthCache.set(id, { label, width })
    return width
}

/**
 * Clear width cache (call when resetting mindmap)
 */
export function clearWidthCache(): void {
    widthCache.clear()
}

/**
 * Calculate node width based on label text (internal)
 * Uses character count with different weights for Korean/ASCII
 */
// 편집 모드 input 너비: min-w-[100px] + 부모 카드 px-4(32) + 버퍼 = 152
// 빈 라벨 노드는 input이 렌더되므로 이 값을 floor로 사용해야 좌측 레이아웃에서
// 부모와 겹치지 않음. (X 좌표가 estimatedWidth 기준으로 계산되므로 실제 너비
// > 추정 너비면 좌측 노드는 부모 쪽으로 침범함.)
const EDITING_INPUT_WIDTH = 152

function calculateWidth(label: string, isRoot: boolean): number {
    const config = isRoot ? NODE_WIDTH_CONFIG.root : NODE_WIDTH_CONFIG.child

    // 빈 라벨(편집 모드일 가능성 높음): input 렌더 너비를 floor로
    if (!isRoot && !label.trim()) {
        return Math.max(config.min, EDITING_INPUT_WIDTH)
    }

    // Count Korean (CJK) vs ASCII characters
    let totalWidth = 0
    for (const char of label) {
        const code = char.charCodeAt(0)
        if (code >= 0xAC00 && code <= 0xD7AF) {
            // Korean syllable: roughly 1em width
            totalWidth += config.fontSize
        } else if (code >= 0x4E00 && code <= 0x9FFF) {
            // CJK ideograph: roughly 1em width
            totalWidth += config.fontSize
        } else {
            // ASCII/Latin: roughly 0.5-0.6em width
            totalWidth += config.fontSize * 0.55
        }
    }

    // Add padding (px-4 = 16px each side = 32px)
    const estimatedWidth = totalWidth + config.padding

    // Clamp to min/max
    return Math.min(Math.max(estimatedWidth, config.min), config.max)
}

// Backward compatibility export
export const estimateNodeWidth = calculateWidth

export interface LayoutResult {
    nodes: Node[]
    edges: Edge[]
}

interface TreeNode {
    id: string
    label: string
    originalNode: MindmapNode
    estimatedWidth: number  // Pre-calculated width
    children?: TreeNode[]
}

/**
 * Compute the width d3 should treat this node as occupying.
 * For image-kind nodes we honour the persisted display width (clamped to
 * a sensible canvas range) so the tree layout doesn't put siblings on
 * top of a large screenshot.
 */
function effectiveEstimatedWidth(node: MindmapNode, isRoot: boolean): number {
    if (node.kind === 'image' && node.image_width) {
        // Clamp so a tiny icon doesn't collapse the column and a huge image
        // doesn't push the whole subtree off-screen. The padding (32) lines
        // up with the text-node padding so columns balance.
        const w = node.image_width + 32
        return Math.min(Math.max(w, 120), 520)
    }
    return getCachedWidth(node.id, node.label, isRoot)
}

/**
 * Convert MindmapNode to TreeNode structure for d3
 */
function toTreeNode(node: MindmapNode, level: number = 1): TreeNode {
    const isRoot = level === 0
    return {
        id: node.id,
        label: node.label,
        originalNode: node,
        estimatedWidth: effectiveEstimatedWidth(node, isRoot),
        children: node.children?.map(child => toTreeNode(child, level + 1)) || []
    }
}

/**
 * Calculate mindmap layout using Bi-directional Tree algorithm
 */
export function calculateD3Layout(
    rootNode: MindmapNode,
    onExpand: (node: MindmapNode) => void,
    _expectedL2Counts?: Record<string, number>
): LayoutResult {
    const nodes: Node[] = []
    const edges: Edge[] = []

    // No children - just return root
    if (!rootNode.children || rootNode.children.length === 0) {
        nodes.push(createReactFlowNode(rootNode, CENTER_X, CENTER_Y, 0, 'center', 0, onExpand))
        return { nodes, edges }
    }

    // ─── Step 1: Split children into Left/Right teams ───
    const l1Count = rootNode.children.length
    const rightCount = Math.ceil(l1Count / 2)
    const rightChildren = rootNode.children.slice(0, rightCount)
    const leftChildren = rootNode.children.slice(rightCount)

    // ─── Step 2: Create virtual root for each side and run d3.tree() ───
    const SEP_MARGIN_PX = 20
    const imageHeightOf = (n: TreeNode): number => {
        const orig = n.originalNode
        return orig.kind === 'image' && typeof orig.image_height === 'number'
            ? orig.image_height
            : 0
    }
    const treeLayout = tree<TreeNode>()
        .nodeSize([VERTICAL_GAP, HORIZONTAL_GAP])
        .separation((a, b) => {
            const baseSep = a.parent === b.parent ? 1 : 2
            const maxImgH = Math.max(imageHeightOf(a.data), imageHeightOf(b.data))
            if (maxImgH === 0) return baseSep
            const desiredGap = Math.max(VERTICAL_GAP, maxImgH + SEP_MARGIN_PX)
            return baseSep * (desiredGap / VERTICAL_GAP)
        })

    // Process Right side
    const rightNodes: Array<{ node: MindmapNode; x: number; y: number; level: number; colorIndex: number; estimatedWidth: number }> = []
    if (rightChildren.length > 0) {
        const rightTreeData: TreeNode = {
            id: 'virtual-right-root',
            label: rootNode.label,
            originalNode: rootNode,
            estimatedWidth: estimateNodeWidth(rootNode.label, true),
            children: rightChildren.map(child => toTreeNode(child, 1))
        }
        const rightHierarchy = treeLayout(hierarchy(rightTreeData))

        rightHierarchy.each((d: HierarchyPointNode<TreeNode>) => {
            if (d.data.id === 'virtual-right-root') return // Skip virtual root

            let cumulativeX = 0
            const ancestors = d.ancestors().reverse() // from root to node

            for (let i = 0; i < ancestors.length - 1; i++) {
                const parent = ancestors[i]
                cumulativeX += parent.data.estimatedWidth + HORIZONTAL_GAP
            }

            rightNodes.push({
                node: d.data.originalNode,
                x: cumulativeX,
                y: d.x,
                level: d.depth,
                colorIndex: getColorIndex(d, rightChildren),
                estimatedWidth: d.data.estimatedWidth
            })
        })
    }

    // Process Left side
    const leftNodes: Array<{ node: MindmapNode; x: number; y: number; level: number; colorIndex: number; estimatedWidth: number }> = []
    if (leftChildren.length > 0) {
        const leftTreeData: TreeNode = {
            id: 'virtual-left-root',
            label: rootNode.label,
            originalNode: rootNode,
            estimatedWidth: estimateNodeWidth(rootNode.label, true),
            children: leftChildren.map(child => toTreeNode(child, 1))
        }
        const leftHierarchy = treeLayout(hierarchy(leftTreeData))

        leftHierarchy.each((d: HierarchyPointNode<TreeNode>) => {
            if (d.data.id === 'virtual-left-root') return // Skip virtual root

            let cumulativeX = HORIZONTAL_GAP + d.data.estimatedWidth
            const ancestors = d.ancestors().reverse() // from root to node

            for (let i = 1; i < ancestors.length - 1; i++) {
                const ancestor = ancestors[i]
                cumulativeX += ancestor.data.estimatedWidth + HORIZONTAL_GAP
            }

            leftNodes.push({
                node: d.data.originalNode,
                x: -cumulativeX,
                y: d.x,
                level: d.depth,
                colorIndex: rightCount + getColorIndex(d, leftChildren),
                estimatedWidth: d.data.estimatedWidth
            })
        })
    }

    // ─── Step 3: Add Root node at center ───
    nodes.push(createReactFlowNode(rootNode, CENTER_X, CENTER_Y, 0, 'center', 0, onExpand))

    // ─── Step 4: Add all positioned nodes with offset ───
    const allPositioned = [...rightNodes, ...leftNodes]

    allPositioned.forEach(({ node, x, y, level, colorIndex }) => {
        const side = x > 0 ? 'right' : 'left'
        const finalX = CENTER_X + x
        const finalY = CENTER_Y + y

        nodes.push(createReactFlowNode(node, finalX, finalY, level, side, colorIndex, onExpand))
    })

    // ─── Step 5: Create edges ───
    rightChildren.forEach((child) => {
        edges.push(createEdge(rootNode.id, child.id, 'right'))
    })
    leftChildren.forEach((child) => {
        edges.push(createEdge(rootNode.id, child.id, 'left'))
    })

    function addChildEdges(parent: MindmapNode, side: 'left' | 'right') {
        if (!parent.children) return
        parent.children.forEach(child => {
            edges.push(createEdge(parent.id, child.id, side))
            addChildEdges(child, side)
        })
    }

    rightChildren.forEach(child => addChildEdges(child, 'right'))
    leftChildren.forEach(child => addChildEdges(child, 'left'))

    return { nodes, edges }
}

/**
 * Get color index for a node based on its L1 ancestor
 */
function getColorIndex(
    d: HierarchyPointNode<TreeNode>,
    l1Children: MindmapNode[]
): number {
    let current = d
    while (current.depth > 1 && current.parent) {
        current = current.parent
    }
    const l1Id = current.data.id
    const idx = l1Children.findIndex(c => c.id === l1Id)
    return idx >= 0 ? idx : 0
}

/**
 * Create a React Flow node
 */
function createReactFlowNode(
    node: MindmapNode,
    x: number,
    y: number,
    level: number,
    side: 'left' | 'right' | 'center',
    colorIndex: number,
    onExpand: (node: MindmapNode) => void
): Node {
    return {
        id: node.id,
        type: 'mindmap',
        position: { x, y },
        data: {
            label: node.label,
            node: node,
            level,
            side,
            colorIndex,
            hasChildren: (node.children?.length ?? 0) > 0,
            childrenCount: node.children?.length ?? 0,
            canExpand: level < 4,
            onExpand: () => onExpand(node),
        },
    }
}

/**
 * Create an edge between two nodes
 */
function createEdge(sourceId: string, targetId: string, side: 'left' | 'right'): Edge {
    return {
        id: `edge-${sourceId}-${targetId}`,
        source: sourceId,
        target: targetId,
        sourceHandle: side,
        targetHandle: side === 'right' ? 'left' : 'right',
        type: 'bezier',
    }
}
