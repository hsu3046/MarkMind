/**
 * Mindmap ↔ Flowchart converters.
 *
 * Trade-offs the conversion makes explicit (surfaced as ConversionWarning
 * to the user post-conversion):
 *
 *   mindmap → flowchart:
 *     - root → single `start` node, leaves → `end` nodes
 *     - non-leaf nodes → `process` nodes
 *     - parent→child edges (no decision auto-insertion in v1 — the user
 *       can re-type the relevant node to `decision` after conversion)
 *     - metadata loss: importance / semantic_type / framework_id /
 *       attributes / recommendations (dropped, listed in warning)
 *
 *   flowchart → mindmap:
 *     - `start` (or in-degree 0) → root
 *     - BFS, first parent wins for nodes with multiple incoming edges
 *     - cycle detected → node duplicated with " (반복)" suffix
 *     - decision / merge / io shape info → flattened to a regular node
 *     - edge label → prefixed onto the child label ([Yes] …)
 *
 * Originals are NEVER mutated; both functions return fresh objects.
 */

import type { MindmapNode } from "../types/mindmap"
import {
    type ConversionResult,
    type ConversionWarning,
    type FlowchartDocument,
    type FlowchartEdge,
    type FlowchartNode,
} from "../types/flowchart"
import { layoutFlowchart } from "./dagre-layout"

// ── mindmap → flowchart ─────────────────────────────────────────────────────

interface MindmapToFlowchartOptions {
    /** Default 'LR'. Use 'TB' if the source mindmap reads top-down. */
    rankdir?: "LR" | "TB"
}

export function mindmapToFlowchart(
    root: MindmapNode,
    options: MindmapToFlowchartOptions = {},
): ConversionResult<{
    title: string
    nodes: FlowchartNode[]
    edges: FlowchartEdge[]
}> {
    const warnings: ConversionWarning[] = []
    const nodes: FlowchartNode[] = []
    const edges: FlowchartEdge[] = []
    const lostMeta: string[] = []

    let edgeCounter = 0
    const makeEdgeId = () => `e-conv-${++edgeCounter}`

    // Walk the tree. Each MindmapNode becomes one FlowchartNode with the
    // type chosen by its position:
    //   root   → 'start'
    //   leaf   → 'end'
    //   middle → 'process'
    // Edges are produced from each parent→child relationship.
    const walk = (n: MindmapNode, isRoot: boolean) => {
        const isLeaf = !n.children || n.children.length === 0

        // Image-kind nodes map straight across — they have no BPMN shape
        // semantics, just blob + dimensions. We deliberately ignore the
        // root-vs-leaf rule for image nodes; a root-as-image still becomes
        // 'image', not 'start'.
        if (n.kind === 'image' && n.image_id) {
            nodes.push({
                id: n.id,
                type: 'image',
                label: n.label || '',
                description: n.description,
                position: { x: 0, y: 0 },
                source_mindmap_node_id: n.id,
                image_id: n.image_id,
                image_width: n.image_width,
                image_height: n.image_height,
                image_mime: n.image_mime,
                alt: n.alt,
            })
        } else {
            const type = isRoot ? "start" : isLeaf ? "end" : "process"
            nodes.push({
                id: n.id,
                type,
                label: n.label || "(빈 노드)",
                description: n.description,
                position: { x: 0, y: 0 }, // dagre fills below
                source_mindmap_node_id: n.id,
            })
        }

        // Track any metadata fields that won't survive the round-trip.
        if (n.importance !== undefined && n.importance !== 2) lostMeta.push(`importance(${n.id})`)
        if (n.semantic_type) lostMeta.push(`semantic_type(${n.id})`)
        if (n.applied_framework_id) lostMeta.push(`framework(${n.id})`)
        if (n.attributes && Object.keys(n.attributes).length > 0) lostMeta.push(`attributes(${n.id})`)

        for (const child of n.children || []) {
            edges.push({
                id: makeEdgeId(),
                source: n.id,
                target: child.id,
                // Handles get set by dagre layout below based on rankdir.
                sourceHandle: "right-source",
                targetHandle: "left-target",
                markerEnd: true,
                markerStart: false,
            })
            walk(child, false)
        }
    }
    walk(root, true)

    if (lostMeta.length > 0) {
        warnings.push({
            type: "metadata_lost",
            message: `${lostMeta.length}개 노드의 중요도·카테고리·프레임워크 정보는 플로우차트로 옮겨지지 않아요.`,
            affectedIds: lostMeta.slice(0, 20),
        })
    }

    // dagre auto-layout with the chosen rank direction.
    const { nodes: laidOutNodes, edges: laidOutEdges } = layoutFlowchart(
        nodes,
        edges,
        { rankdir: options.rankdir ?? "LR" },
    )

    return {
        result: {
            title: root.label || "변환된 플로우차트",
            nodes: laidOutNodes,
            edges: laidOutEdges,
        },
        warnings,
    }
}

// ── flowchart → mindmap ─────────────────────────────────────────────────────

/**
 * Pick the entry node for BFS:
 *   1. The first `start` node, if any.
 *   2. Else the first node with **forward** in-degree 0.
 *   3. Else the first node in the array (degenerate cycle).
 *
 * Forward-only counting: the BFS walk below (`build`) already skips
 * `markerLoop` edges, so loop edges shouldn't push their target's
 * in-degree either when we're hunting for an entry node. Without this,
 * a retry-only shape like `input → retry` + `retry → input (loop)`
 * with nodes ordered as `[retry, input]` would see both nodes at
 * in-degree 1 (loop counted into `input`) and fall back to the first
 * array element `retry` — semantically the wrong entry.
 */
function pickEntryNode(doc: FlowchartDocument): FlowchartNode | null {
    if (doc.nodes.length === 0) return null
    const starts = doc.nodes.filter((n) => n.type === "start")
    if (starts.length > 0) return starts[0]
    const inDeg = new Map<string, number>()
    for (const n of doc.nodes) inDeg.set(n.id, 0)
    for (const e of doc.edges) {
        if (e.markerLoop) continue
        inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1)
    }
    const noIncoming = doc.nodes.find((n) => (inDeg.get(n.id) ?? 0) === 0)
    return noIncoming ?? doc.nodes[0]
}

/**
 * Prefix an edge label onto the child label when it's meaningful.
 * "Yes" / "No" / "조건 충족" are short and read naturally as a prefix;
 * we cap at 12 chars so we don't bury the child label.
 */
function joinEdgeLabel(edgeLabel: string | undefined, childLabel: string): string {
    if (!edgeLabel) return childLabel
    const tag = edgeLabel.trim()
    if (!tag) return childLabel
    if (tag.length > 12) return childLabel // skip overly long labels
    return `[${tag}] ${childLabel}`
}

export function flowchartToMindmap(
    doc: FlowchartDocument,
): ConversionResult<MindmapNode> {
    const warnings: ConversionWarning[] = []
    const byId = new Map(doc.nodes.map((n) => [n.id, n]))
    const outgoingBySource = new Map<string, FlowchartEdge[]>()
    for (const e of doc.edges) {
        const list = outgoingBySource.get(e.source) ?? []
        list.push(e)
        outgoingBySource.set(e.source, list)
    }

    const entry = pickEntryNode(doc)
    if (!entry) {
        return {
            result: {
                id: "empty-root",
                label: "(비어 있음)",
                type: "default",
                children: [],
            },
            warnings: [],
        }
    }

    // BFS visit order: first-visit parent wins (shortest path). When we
    // meet a node a second time we DUPLICATE it (suffixed) so the result
    // is a tree even if the source DAG has shared descendants or cycles.
    const visited = new Set<string>()
    const duplicatedIds: string[] = []
    const shapeAssumedIds: string[] = []
    let dupCounter = 0

    const danglingEdgeTargets: string[] = []

    const build = (flowNodeId: string, depth: number, edgeLabel?: string): MindmapNode | null => {
        const flowNode = byId.get(flowNodeId)
        if (!flowNode) {
            // User-supplied JSON (file load) could reference an edge target
            // that doesn't exist in nodes[]. The cache loader only checks
            // for array shape, not graph integrity, so we defend here:
            // skip the dead reference and surface it as a warning instead
            // of throwing.
            danglingEdgeTargets.push(flowNodeId)
            return null
        }
        const alreadyVisited = visited.has(flowNodeId)
        let nodeId = flowNode.id
        if (alreadyVisited) {
            nodeId = `${flowNode.id}-dup-${++dupCounter}`
            duplicatedIds.push(flowNode.id)
        }
        visited.add(flowNodeId)

        // Flag any shape that loses meaning in tree form (decision, merge, io).
        if (
            flowNode.type === "decision" ||
            flowNode.type === "merge" ||
            flowNode.type === "io"
        ) {
            shapeAssumedIds.push(flowNode.id)
        }

        // Edge-label prefix doesn't really fit an image caption, so we drop
        // it for image-kind nodes (the alt/caption already explains the
        // image). For text nodes, prefix as usual.
        const isImage = flowNode.type === 'image'
        const label = isImage
            ? (flowNode.label || '')
            : joinEdgeLabel(edgeLabel, flowNode.label || "(빈 노드)")

        // Don't recurse past duplicates — that's what would re-open the cycle.
        // Filter out nulls from dangling-edge-target rejection.
        //
        // Intentional loopback edges (`markerLoop: true`) are SKIPPED here:
        // a "retry → input" arrow conceptually returns to an earlier step,
        // not a new branch. Following it would clone the loop body into
        // the tree and trigger spurious `multi_parent_duplicated` warnings.
        // The loop intent is preserved in the source flowchart; the mindmap
        // just shows the forward path.
        const children: MindmapNode[] = alreadyVisited
            ? []
            : (outgoingBySource.get(flowNodeId) ?? [])
                  .filter((e) => !e.markerLoop)
                  .map((e) => build(e.target, depth + 1, e.label))
                  .filter((c): c is MindmapNode => c !== null)

        const out: MindmapNode = {
            id: nodeId,
            label,
            type: depth === 0 ? "root" : "sub_branch",
            description: flowNode.description,
            children,
        }
        if (isImage && flowNode.image_id) {
            out.kind = 'image'
            out.image_id = flowNode.image_id
            out.image_width = flowNode.image_width
            out.image_height = flowNode.image_height
            out.image_mime = flowNode.image_mime
            out.alt = flowNode.alt
        }
        return out
    }

    const root = build(entry.id, 0)
    // Entry came from pickEntryNode which only returns nodes that exist,
    // so this is defensive; never observed at runtime.
    if (!root) {
        return {
            result: {
                id: "empty-root",
                label: "(비어 있음)",
                type: "default",
                children: [],
            },
            warnings: [],
        }
    }

    if (danglingEdgeTargets.length > 0) {
        warnings.push({
            type: "metadata_lost",
            message: `존재하지 않는 노드를 가리키는 ${danglingEdgeTargets.length}개 엣지는 변환에서 제외됐어요.`,
            affectedIds: Array.from(new Set(danglingEdgeTargets)).slice(0, 20),
        })
    }

    if (duplicatedIds.length > 0) {
        const unique = Array.from(new Set(duplicatedIds))
        warnings.push({
            type: "multi_parent_duplicated",
            message: `${unique.length}개 노드가 여러 곳에서 참조되어 마인드맵에서는 복제됐어요 (트리는 한 부모만 가질 수 있어요).`,
            affectedIds: unique.slice(0, 20),
        })
    }

    if (shapeAssumedIds.length > 0) {
        warnings.push({
            type: "shape_assumed",
            message: `${shapeAssumedIds.length}개 분기·합류·입출력 노드는 마인드맵에서 일반 가지로 단순화됐어요.`,
            affectedIds: shapeAssumedIds.slice(0, 20),
        })
    }

    // Unvisited nodes = orphans / disconnected components.
    const orphans = doc.nodes.filter((n) => !visited.has(n.id))
    if (orphans.length > 0) {
        warnings.push({
            type: "metadata_lost",
            message: `시작 노드에서 도달할 수 없는 ${orphans.length}개 노드는 변환에서 제외됐어요.`,
            affectedIds: orphans.map((n) => n.id).slice(0, 20),
        })
    }

    return { result: root, warnings }
}
