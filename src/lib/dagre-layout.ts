/**
 * Dagre-based auto layout for flowcharts.
 *
 * Takes raw nodes + edges (no positions assumed) and assigns each node a
 * center position so the graph reads left-to-right (or top-to-bottom). Each
 * node's box size is taken from `SHAPE_DIMENSIONS` so dagre allocates the
 * right gap; centers are snapped to the canvas grid afterwards so the
 * result lines up with the dotted background.
 *
 * Used after LLM generation (Phase C) and on the "재정렬" button.
 */

import dagre from 'dagre'
import { FlowchartEdge, FlowchartNode, FlowNodeType } from '../types/flowchart'
import { SHAPE_DIMENSIONS } from './flowchart-shapes'

/** Canvas snap grid step — must match GRID_SIZE in flowchart-canvas. */
const GRID_SIZE = 20

export interface LayoutOptions {
    /** Flow direction. 'LR' = left→right (default), 'TB' = top→bottom. */
    rankdir?: 'LR' | 'TB'
    /** Spacing between sibling nodes (same rank). Default 60. */
    nodesep?: number
    /** Spacing between adjacent ranks. Default 100. */
    ranksep?: number
}

export interface LayoutResult {
    nodes: FlowchartNode[]
    edges: FlowchartEdge[]
}

/**
 * Compute new positions for every node AND rewrite each edge's source/target
 * handle to match the flow direction:
 *   LR → source = right, target = left   (horizontal flow)
 *   TB → source = bottom, target = top   (vertical flow)
 *
 * This is what fixes the "edges zigzag when you switch to vertical" problem:
 * dagre repositions nodes top↓bottom but if the edges still leave each node
 * from `right-source`, every line wraps awkwardly around to the next node's
 * left side. Rewriting handles makes the path go straight down.
 *
 * Other edge fields (id, label, marker, …) are preserved.
 */
export function layoutFlowchart(
    nodes: FlowchartNode[],
    edges: FlowchartEdge[],
    options: LayoutOptions = {},
): LayoutResult {
    if (nodes.length === 0) return { nodes, edges }

    const rankdir = options.rankdir ?? 'LR'

    const g = new dagre.graphlib.Graph()
    g.setGraph({
        rankdir,
        nodesep: options.nodesep ?? 60,
        ranksep: options.ranksep ?? 100,
        marginx: 40,
        marginy: 40,
        // `acyclicer: 'greedy'` tells dagre to break any cycle it finds by
        // temporarily reversing edges, lay out as a DAG, then restore the
        // direction. Without this, an accidental cycle (e.g. user drew a
        // forward edge that happens to close a loop) crashes dagre with
        // "Cannot set properties of undefined (setting 'points')" deep
        // inside its order-and-position pass.
        acyclicer: 'greedy',
    })
    g.setDefaultEdgeLabel(() => ({}))

    // Build a connectivity index so isolated nodes (no incoming AND no
    // outgoing edges) can opt out of dagre's layout pass entirely.
    // Loose reference images placed by the user belong here — auto-align
    // shouldn't drag them out of position into a default top-left slot.
    const connectedIds = new Set<string>()
    for (const e of edges) {
        connectedIds.add(e.source)
        connectedIds.add(e.target)
    }

    for (const n of nodes) {
        if (!connectedIds.has(n.id)) continue   // isolated → keep original pos
        // Image nodes carry their actual rendered dimensions on the node
        // itself (set when the file is dropped + adjusted by NodeResizer).
        // Falling through to SHAPE_DIMENSIONS would give them the same
        // floor as a tiny BPMN shape (80×60) regardless of the image's
        // true size, so two image nodes next to each other in an LR layout
        // would overlap. Use the persisted display size + the caption row
        // so dagre allocates a slot the user can read.
        if (n.type === 'image') {
            const captionRow = n.label ? 26 : 0   // keep in sync with image-node.tsx
            g.setNode(n.id, {
                width: n.image_width ?? 200,
                height: (n.image_height ?? 150) + captionRow,
            })
            continue
        }
        const dim = SHAPE_DIMENSIONS[n.type as FlowNodeType]
        g.setNode(n.id, {
            width: dim?.minWidth ?? 160,
            height: dim?.minHeight ?? 60,
        })
    }
    for (const e of edges) {
        // dagre quietly ignores edges with unknown endpoints, but skip
        // defensively so a bad LLM output doesn't blow up the layout call.
        if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue
        // Loopback edges are SKIPPED entirely — they are by definition
        // back-edges and shouldn't participate in dagre's ranking. Feeding
        // them in (even with low weight) creates a true cycle that dagre's
        // ordering pass can't always resolve, leading to a crash deep in
        // its internals. We don't lose anything: React Flow draws the
        // smoothstep path from the two node positions + handles directly,
        // so dagre's edge `points` aren't consumed downstream anyway.
        if (e.markerLoop) continue
        g.setEdge(e.source, e.target)
    }

    // dagre.layout mutates the graph in place — fills each node entry's
    // x/y. There's no useful return value; we read positions back via
    // g.node(id) below.
    dagre.layout(g)

    // dagre yields each node's center (x, y). Our canvas uses
    // nodeOrigin=[0.5, 0.5] so position is also a center → assign directly.
    // Read all positions first so the centering pass below can reference
    // them before we apply grid snap.
    const rawPos = new Map<string, { x: number; y: number }>()
    for (const n of nodes) {
        const d = g.node(n.id)
        if (d) rawPos.set(n.id, { x: d.x, y: d.y })
    }

    // ─── Branch/merge centering pass ───────────────────────────────────────
    //
    // dagre's default Brandes-Köpf placement balances four alignments and
    // can leave a branching node anchored to its (single, often tall)
    // predecessor instead of the median of its multiple successors. The
    // common visual symptom: a decision with three child images stacks the
    // children vertically but pins the decision to the top child's y
    // because the upstream image dominates the anchor calculation.
    //
    // Fix: for every node whose effective fan (≥2 outgoing OR ≥2 incoming
    // non-loop edges) exceeds 1, override its cross-axis position to the
    // median of its branch neighbors. The fork/merge node ends up visually
    // centered between its branches; upstream chains keep dagre's
    // ranking and just bend their connecting edge.
    const outBranches = new Map<string, string[]>()
    const inBranches = new Map<string, string[]>()
    for (const e of edges) {
        if (e.markerLoop) continue
        const outs = outBranches.get(e.source) ?? []
        outs.push(e.target)
        outBranches.set(e.source, outs)
        const ins = inBranches.get(e.target) ?? []
        ins.push(e.source)
        inBranches.set(e.target, ins)
    }

    const adjusted = new Map(rawPos)
    // Cross-axis = the axis perpendicular to the flow direction. For LR we
    // re-center y; for TB we re-center x. The flow-axis position (the rank
    // column / row) stays untouched so the node remains in the right rank.
    const crossAxis: 'x' | 'y' = rankdir === 'TB' ? 'x' : 'y'

    for (const n of nodes) {
        const outs = outBranches.get(n.id) ?? []
        const ins = inBranches.get(n.id) ?? []
        const fanOut = outs.length
        const fanIn = ins.length
        if (fanOut < 2 && fanIn < 2) continue
        // Pick the side with more branches — that's the "fan" side that
        // visually defines where the join should sit.
        const neighborIds = fanOut >= fanIn ? outs : ins
        const vals: number[] = []
        for (const id of neighborIds) {
            const p = rawPos.get(id)
            if (p) vals.push(p[crossAxis])
        }
        if (vals.length === 0) continue
        vals.sort((a, b) => a - b)
        // Even-count fan (the most common case: decision with Yes/No,
        // merge with two branches) — `vals[floor(n/2)]` would pick the
        // *second* of the two middle elements, dropping the fork node
        // onto one branch instead of midway between them. Average the
        // two middles to get the true geometric midpoint; for odd
        // counts, the floor index is already the true median.
        const median = vals.length % 2 === 0
            ? (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2
            : vals[Math.floor(vals.length / 2)]
        const cur = adjusted.get(n.id)
        if (!cur) continue
        adjusted.set(n.id, crossAxis === 'y' ? { x: cur.x, y: median } : { x: median, y: cur.y })
    }

    // Snap to the grid so dots line up with node centers (as in manual drag).
    // Isolated nodes (no edges) were never added to dagre — `adjusted` won't
    // have them, so the map fallback keeps their existing position untouched.
    const snap = (v: number) => Math.round(v / GRID_SIZE) * GRID_SIZE
    const newNodes = nodes.map(n => {
        const d = adjusted.get(n.id)
        if (!d) return n   // isolated node → keep original position
        return {
            ...n,
            position: { x: snap(d.x), y: snap(d.y) },
        }
    })

    // Handle assignment matches the flow direction so smoothstep edges go
    // straight along the rank axis instead of doubling back.
    //
    // Loop edges get the PERPENDICULAR side so the path arcs over (LR) /
    // beside (TB) the main flow body instead of looking like a forward
    // edge that happens to be dashed. Without this branch, a "retry →
    // input" loop in an LR layout would still leave from the source's
    // right side and enter the target's left side — visually identical
    // to a normal arrow.
    const fwdSource = rankdir === 'TB' ? 'bottom-source' : 'right-source'
    const fwdTarget = rankdir === 'TB' ? 'top-target'    : 'left-target'
    const loopSource = rankdir === 'TB' ? 'left-source'  : 'top-source'
    const loopTarget = rankdir === 'TB' ? 'left-target'  : 'top-target'
    const newEdges = edges.map(e => e.markerLoop
        ? { ...e, sourceHandle: loopSource, targetHandle: loopTarget }
        : { ...e, sourceHandle: fwdSource, targetHandle: fwdTarget }
    )

    return { nodes: newNodes, edges: newEdges }
}
