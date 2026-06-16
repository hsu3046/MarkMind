/**
 * Flow Chart data model — BPMN-lite DAG (Directed Acyclic Graph).
 *
 * Distinct from the mindmap's recursive `MindmapNode` tree because flowcharts
 * need: (a) multiple parents per node, (b) branch / merge semantics,
 * (c) node shape varying by role (Start, End, Process, Decision, Merge),
 * (d) labeled edges (Yes/No on decisions).
 *
 * The graph is stored flat — `nodes[]` + `edges[]` — and laid out via dagre
 * (LR rankdir) on demand. Positions are persisted so a saved chart re-opens
 * in the same shape the user arranged it.
 *
 * MindBusiness 에서 이식(#46 M3). MarkMind 는 1차에서 image 노드를 미지원하나
 * 타입은 그대로 보존(optional)해 후속 통합 시 라운드트립 호환을 유지한다.
 */

/**
 * BPMN-lite node types.
 *  - start/end: lifecycle terminators (rounded pill)
 *  - process:   normal step (rectangle)
 *  - decision:  branch / gateway (diamond)
 *  - merge:     join / convergence (circle)
 *  - io:        input or output data (parallelogram)
 *  - image:     arbitrary user-attached image (width/height from image_*).
 */
export type FlowNodeType = 'start' | 'end' | 'process' | 'decision' | 'merge' | 'io' | 'image';

export interface FlowchartNode {
    id: string;
    type: FlowNodeType;
    label: string;
    description?: string;
    /** dagre-computed or user-dragged position (React Flow top-left coords). */
    position: { x: number; y: number };
    /**
     * When this node originated from a mindmap → flowchart conversion, keep
     * the source MindmapNode.id so a round-trip back to mindmap can restore
     * metadata (importance, semantic_type) we don't otherwise carry here.
     */
    source_mindmap_node_id?: string;

    // ── image-only fields (meaningful when type === 'image') ────────────────
    image_id?: string;
    image_width?: number;
    image_height?: number;
    image_mime?: 'image/webp';
    /** Accessibility alt text (rendered as <img title>/aria-label). */
    alt?: string;
}

export interface FlowchartEdge {
    id: string;
    source: string;
    target: string;
    /**
     * For decision nodes specifically: 'yes' | 'no' identifies which branch
     * the edge leaves from. Other node types use `undefined` (single source handle).
     */
    sourceHandle?: string;
    targetHandle?: string;
    /** Human-readable label rendered on the edge (e.g. "Yes", "No", "조건 충족"). */
    label?: string;
    type?: 'default' | 'conditional';
    /** Arrow head placement. Undefined = defaults (markerEnd: true, markerStart: false). */
    markerStart?: boolean;
    markerEnd?: boolean;
    /** 의도적 loop/retry 경로 — 점선 + 낮은 dagre rank weight. */
    markerLoop?: boolean;
}

/** Four arrow direction modes — exposed in the edge selection toolbar. */
export type ArrowDirection = 'forward' | 'backward' | 'bidirectional' | 'none';

/** Map an ArrowDirection to the boolean pair persisted on FlowchartEdge. */
export function arrowDirectionToMarkers(d: ArrowDirection): { markerStart: boolean; markerEnd: boolean } {
    switch (d) {
        case 'forward':       return { markerStart: false, markerEnd: true };
        case 'backward':      return { markerStart: true,  markerEnd: false };
        case 'bidirectional': return { markerStart: true,  markerEnd: true };
        case 'none':          return { markerStart: false, markerEnd: false };
    }
}

/** Reverse mapping — derive the direction mode from stored marker booleans. */
export function markersToArrowDirection(e: Pick<FlowchartEdge, 'markerStart' | 'markerEnd'>): ArrowDirection {
    const start = e.markerStart === true;
    const end = e.markerEnd !== false; // undefined treated as true
    if (start && end) return 'bidirectional';
    if (start && !end) return 'backward';
    if (!start && end) return 'forward';
    return 'none';
}

export interface FlowchartDocument {
    id: string;
    title: string;
    nodes: FlowchartNode[];
    edges: FlowchartEdge[];
    source_mindmap_id?: string;
    created_at: number;
    updated_at: number;
}

/**
 * Warnings produced by mindmap ↔ flowchart conversion. Surfaced to the user
 * after a conversion so they understand which information was approximated/dropped.
 */
export interface ConversionWarning {
    type:
        | 'metadata_lost'
        | 'multi_parent_duplicated'
        | 'cycle_broken'
        | 'shape_assumed'
        | 'edge_label_lost';
    message: string;
    affectedIds: string[];
}

export interface ConversionResult<T> {
    result: T;
    warnings: ConversionWarning[];
}
