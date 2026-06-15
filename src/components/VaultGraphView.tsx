/**
 * Vault graph view (M2) — the Obsidian-style document graph.
 *
 * Scans the current document's folder (vault root), builds a graph where nodes
 * are markdown files (+ ghost nodes for unresolved `[[links]]`) and edges are
 * links, lays it out force-directed with d3-force, and renders it with React
 * Flow. Clicking a file node opens it (drill-in); clicking a ghost creates it.
 *
 * d3-force runs to convergence ONCE (synchronously) then positions are frozen —
 * no per-tick setState, no persistence (the graph is derived from the vault).
 */

import { memo, useEffect, useMemo, useState } from 'react';
import {
    ReactFlow,
    ReactFlowProvider,
    Background,
    Controls,
    Handle,
    Position,
    type Node,
    type Edge,
    type NodeProps,
} from '@xyflow/react';
import {
    forceSimulation,
    forceLink,
    forceManyBody,
    forceCenter,
    forceCollide,
    type SimulationNodeDatum,
} from 'd3-force';
import { FileText, FilePlus2 } from 'lucide-react';
import { buildGraph, type VaultFile, type GraphNode } from '../lib/vault';
import '@xyflow/react/dist/style.css';
import './MindmapCanvas.css';
import './VaultGraphView.css';

interface VaultGraphViewProps {
    /** Current document absolute path; its folder is the vault root. */
    filePath: string | null;
    /** Open a real vault file (drill-in). */
    onOpenFile: (absPath: string, content: string, fileName: string) => void;
    /** Create + open an unresolved (ghost) link target. */
    onOpenGhost: (name: string) => void;
}

interface VaultNodeData {
    label: string;
    ghost: boolean;
    current: boolean;
    onOpen: () => void;
    [key: string]: unknown;
}

interface SimNode extends SimulationNodeDatum {
    id: string;
}

const VaultNodeComponent = memo(function VaultNodeComponent({ data }: NodeProps) {
    const d = data as VaultNodeData;
    const cls = `vg-node${d.ghost ? ' vg-ghost' : ''}${d.current ? ' vg-current' : ''}`;
    return (
        <div className={cls} onClick={(e) => { e.stopPropagation(); d.onOpen(); }} title={d.label}>
            <Handle id="t" type="target" position={Position.Top} className="mm-handle" />
            <Handle id="s" type="source" position={Position.Bottom} className="mm-handle" />
            {d.ghost ? <FilePlus2 size={13} /> : <FileText size={13} />}
            <span className="vg-label">{d.label}</span>
        </div>
    );
});

const nodeTypes = { vault: VaultNodeComponent };

/** Run d3-force to convergence and return a Map of node id → {x,y}. */
function computeLayout(nodeIds: string[], edges: { source: string; target: string }[]): Map<string, { x: number; y: number }> {
    const sim: SimNode[] = nodeIds.map((id) => ({ id }));
    const links = edges.map((e) => ({ source: e.source, target: e.target }));
    const simulation = forceSimulation(sim)
        .force('link', forceLink(links).id((n) => (n as SimNode).id).distance(120).strength(0.5))
        .force('charge', forceManyBody().strength(-320))
        .force('center', forceCenter(0, 0))
        .force('collide', forceCollide(60))
        .stop();
    // synchronous convergence (alpha decay default ~0.0228 → ~300 ticks)
    const ticks = Math.min(400, Math.max(120, nodeIds.length * 4));
    for (let i = 0; i < ticks; i++) simulation.tick();
    const pos = new Map<string, { x: number; y: number }>();
    for (const n of sim) pos.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
    return pos;
}

function VaultGraphInner({ filePath, onOpenFile, onOpenGhost }: VaultGraphViewProps) {
    const [files, setFiles] = useState<VaultFile[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    const root = filePath ? filePath.slice(0, filePath.lastIndexOf('/')) : null;
    const currentRel = filePath && root ? filePath.slice(root.length + 1) : null;

    useEffect(() => {
        let cancelled = false;
        if (!root) { setFiles(null); return; }
        (async () => {
            try {
                const { invoke } = await import('@tauri-apps/api/core');
                const scanned = await invoke<VaultFile[]>('scan_vault', { root });
                if (!cancelled) { setFiles(scanned); setError(null); }
            } catch (err) {
                if (!cancelled) setError(String(err));
            }
        })();
        return () => { cancelled = true; };
    }, [root]);

    const graph = useMemo(() => (files ? buildGraph(files) : { nodes: [], edges: [] }), [files]);

    const { nodes, edges } = useMemo(() => {
        const pos = computeLayout(graph.nodes.map((n) => n.id), graph.edges);
        const fileByPath = new Map((files ?? []).map((f) => [f.path, f]));
        const rfNodes: Node[] = graph.nodes.map((n: GraphNode) => {
            const p = pos.get(n.id) ?? { x: 0, y: 0 };
            const isCurrent = !n.ghost && n.path === currentRel;
            return {
                id: n.id,
                type: 'vault',
                position: p,
                data: {
                    label: n.label,
                    ghost: n.ghost,
                    current: isCurrent,
                    onOpen: () => {
                        if (n.ghost) {
                            onOpenGhost(n.label);
                        } else if (n.path && root) {
                            const f = fileByPath.get(n.path);
                            onOpenFile(`${root}/${n.path}`, f?.content ?? '', n.path.split('/').pop() ?? n.path);
                        }
                    },
                } satisfies VaultNodeData,
            };
        });
        const rfEdges: Edge[] = graph.edges.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            type: 'default',
        }));
        return { nodes: rfNodes, edges: rfEdges };
    }, [graph, files, currentRel, root, onOpenFile, onOpenGhost]);

    if (!filePath) {
        return <div className="vg-empty">문서를 먼저 저장하면 vault 그래프를 볼 수 있어요.</div>;
    }
    if (error) {
        return <div className="vg-empty">vault 스캔 실패: {error}</div>;
    }
    if (!files) {
        return <div className="vg-empty">vault 스캔 중…</div>;
    }
    if (graph.nodes.length === 0) {
        return <div className="vg-empty">이 폴더에 마크다운 문서가 없어요.</div>;
    }

    return (
        <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.25, maxZoom: 1.2 }}
            minZoom={0.05}
            maxZoom={2.5}
            proOptions={{ hideAttribution: true }}
        >
            <Background gap={24} size={1} />
            <Controls showInteractive={false} />
        </ReactFlow>
    );
}

export function VaultGraphView(props: VaultGraphViewProps) {
    return (
        <ReactFlowProvider>
            <div style={{ flex: 1, width: '100%', height: '100%', minWidth: 0, minHeight: 0 }}>
                <VaultGraphInner {...props} />
            </div>
        </ReactFlowProvider>
    );
}
