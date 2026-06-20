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
    // Snap HERE (before centering) so the branch-centering median below is the
    // exact midpoint of already-snapped children → symmetric branch stems.
    // (Snapping again after the median would re-round it off the true center,
    //  e.g. children at 300/400 → median 350 → snap 360 → stems 60 vs 40.)
    const snap = (v: number) => Math.round(v / GRID_SIZE) * GRID_SIZE
    const rawPos = new Map<string, { x: number; y: number }>()
    for (const n of nodes) {
        const d = g.node(n.id)
        if (d) rawPos.set(n.id, { x: snap(d.x), y: snap(d.y) })
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

    // ─── Forward chain alignment ───────────────────────────────────────────
    // 단일 forward(out=1 & in=1)로 이어진 노드는 같은 cross-axis 값이어야
    // smoothstep 이 곧은 직선이 된다. 위 branch centering 이 분기 노드(decision)를
    // 자식 중앙으로 옮기면 그 노드로 들어오는 메인 체인(…→decision)이 어긋나
    // 지그재그가 생긴다. 그래서 분기/merge anchor 의 cross 값을 단일 forward 로
    // 이어진 체인에 BFS 전파해 메인 흐름을 직선으로 맞춘다. 분기 자식 edge 는
    // source 의 fanOut≥2 라 단일 링크가 아니어서 건드리지 않는다(분기 모양 보존).
    const fanOutOf = (id: string) => (outBranches.get(id) ?? []).length
    const fanInOf = (id: string) => (inBranches.get(id) ?? []).length
    const getCross = (p: { x: number; y: number }) => (crossAxis === 'y' ? p.y : p.x)
    const setCross = (p: { x: number; y: number }, v: number) =>
        crossAxis === 'y' ? { x: p.x, y: v } : { x: v, y: p.y }
    const isAnchor = (id: string) => fanOutOf(id) >= 2 || fanInOf(id) >= 2
    const aligned = new Set<string>()
    const queue: string[] = []
    // 시작점 ①: 분기/merge anchor — branch centering 으로 자리가 고정된 기준.
    for (const n of nodes) if (isAnchor(n.id) && adjusted.has(n.id)) { queue.push(n.id); aligned.add(n.id) }
    // 시작점 ②: source(forward-in 0). decision 의 분기가 'forward 1개 + markerLoop'
    // 면(예: 달성→배포 + 미달성→재시도 loop) 그 decision 은 fanOut=1 이라 anchor 가
    // 아니다. 이런 순수 선형 체인은 ①만으론 정렬이 안 돼 지그재그가 남으므로,
    // source(forward 진입 0)에서 forward 전파해 한 줄로 맞춘다. anchor 인접 체인은
    // 위에서 이미 점유(aligned)돼 안전(중복 정렬·진동 없음).
    for (const n of nodes) if (!aligned.has(n.id) && fanInOf(n.id) === 0 && adjusted.has(n.id)) { queue.push(n.id); aligned.add(n.id) }
    while (queue.length) {
        const id = queue.shift() as string
        const base = adjusted.get(id)
        if (!base) continue
        for (const e of edges) {
            if (e.markerLoop) continue
            let other: string | null = null
            // id 와 단일 forward(양끝 모두 fan=1 인 링크)로 이어진 이웃만 정렬
            if (e.target === id && fanOutOf(e.source) === 1 && fanInOf(id) === 1) other = e.source
            else if (e.source === id && fanInOf(e.target) === 1 && fanOutOf(id) === 1) other = e.target
            if (!other || aligned.has(other)) continue
            const op = adjusted.get(other)
            if (op) adjusted.set(other, setCross(op, getCross(base)))
            aligned.add(other)
            queue.push(other)
        }
    }

    // adjusted 는 이미 grid-snap 됨(분기 노드만 자식-중앙이라 약간 off-grid).
    // Isolated nodes (no edges) were never added to dagre — `adjusted` won't
    // have them, so the fallback keeps their existing position untouched.
    const newNodes = nodes.map(n => {
        const d = adjusted.get(n.id)
        if (!d) return n   // isolated node → keep original position
        return { ...n, position: d }
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
