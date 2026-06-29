import { assignFlowchartEdgeHandles, layoutFlowchart } from '../dagre-layout';
import type { StoredFlowchart } from '../flowchartBlock';
import { getShapeDimensions, normalizeFlowNodeType } from '../flowchart-shapes';
import type { FlowchartEdge, FlowchartNode, FlowNodeType } from '../../types/flowchart';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SCALE = 2;
const OUTER_PADDING_LEFT = 96;
const OUTER_PADDING_RIGHT = 180;
const OUTER_PADDING_Y = 88;
const LOOP_OFFSET = 72;
const EDGE_COLOR = '#b7bec8';
const TEXT_COLOR = '#1f2937';
const EDGE_LABEL_COLOR = '#475467';
const FONT_FAMILY = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const NODE_FONT_SIZE = 13;
const EDGE_LABEL_FONT_SIZE = 12;
const NODE_LINE_HEIGHT = 18;

interface Size {
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

interface SvgNode {
  node: FlowchartNode;
  size: Size;
  lines: string[];
}

interface EdgeRoute {
  edge: FlowchartEdge;
  path: string;
  label?: {
    text: string;
    x: number;
    y: number;
    width: number;
  };
  points: Point[];
}

export interface FlowchartImageSnapshot {
  dataUrl: string;
  width: number;
  height: number;
  title: string;
}

function estimateTextWidth(text: string, fontSize = NODE_FONT_SIZE): number {
  return Array.from(text).reduce((sum, ch) => {
    const code = ch.codePointAt(0) ?? 0;
    if (/\s/.test(ch)) return sum + fontSize * 0.35;
    if (code >= 0x2e80 || code > 0xffff) return sum + fontSize;
    if (/[A-Z0-9]/.test(ch)) return sum + fontSize * 0.62;
    if (/[a-z]/.test(ch)) return sum + fontSize * 0.54;
    return sum + fontSize * 0.5;
  }, 0);
}

function splitTokenByWidth(token: string, maxWidth: number): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const ch of Array.from(token)) {
    const candidate = current + ch;
    if (current && estimateTextWidth(candidate) > maxWidth) {
      chunks.push(current);
      current = ch;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function wrapText(text: string, maxWidth: number): string[] {
  const normalized = text.replace(/\r/g, '').trim();
  if (!normalized) return [''];

  const lines: string[] = [];
  for (const paragraph of normalized.split('\n')) {
    let current = '';
    const tokens = paragraph.split(/(\s+)/).filter((token) => token.length > 0);

    for (const token of tokens) {
      const candidate = current + token;
      if (!current || estimateTextWidth(candidate) <= maxWidth) {
        current = candidate;
        continue;
      }

      if (current.trim()) lines.push(current.trim());
      current = token.trimStart();

      while (current && estimateTextWidth(current) > maxWidth) {
        const [chunk, ...rest] = splitTokenByWidth(current, maxWidth);
        lines.push(chunk);
        current = rest.join('');
      }
    }

    if (current.trim()) lines.push(current.trim());
  }

  return lines.length > 0 ? lines : [''];
}

function getNodePadding(type: FlowNodeType): { x: number; y: number } {
  if (type === 'decision') return { x: 52, y: 26 };
  if (type === 'merge') return { x: 14, y: 10 };
  return { x: 20, y: 14 };
}

function buildSvgNode(node: FlowchartNode): SvgNode {
  const flowType = normalizeFlowNodeType(node.type);
  const dim = getShapeDimensions(flowType);
  const padding = getNodePadding(flowType);
  const rawTextWidth = estimateTextWidth(node.label);
  const width = Math.ceil(Math.max(
    dim.minWidth,
    Math.min(dim.maxWidth, rawTextWidth + padding.x * 2),
  ));
  const lines = wrapText(node.label, Math.max(24, width - padding.x * 2));
  const height = Math.ceil(Math.max(dim.minHeight, lines.length * NODE_LINE_HEIGHT + padding.y * 2));
  return { node: { ...node, type: flowType }, size: { width, height }, lines };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pointForHandle(node: FlowchartNode, size: Size, handle?: string): Point {
  const x = node.position.x;
  const y = node.position.y;
  if (handle?.startsWith('left')) return { x: x - size.width / 2, y };
  if (handle?.startsWith('right')) return { x: x + size.width / 2, y };
  if (handle?.startsWith('top')) return { x, y: y - size.height / 2 };
  if (handle?.startsWith('bottom')) return { x, y: y + size.height / 2 };
  return { x: x + size.width / 2, y };
}

function sideFromHandle(handle?: string): 'left' | 'right' | 'top' | 'bottom' {
  if (handle?.startsWith('left')) return 'left';
  if (handle?.startsWith('top')) return 'top';
  if (handle?.startsWith('bottom')) return 'bottom';
  return 'right';
}

function normalForSide(side: 'left' | 'right' | 'top' | 'bottom'): Point {
  if (side === 'left') return { x: -1, y: 0 };
  if (side === 'right') return { x: 1, y: 0 };
  if (side === 'top') return { x: 0, y: -1 };
  return { x: 0, y: 1 };
}

function buildEdgeRoute(edge: FlowchartEdge, nodes: Map<string, SvgNode>, direction: 'LR' | 'TB'): EdgeRoute | null {
  const source = nodes.get(edge.source);
  const target = nodes.get(edge.target);
  if (!source || !target) return null;

  const sourceHandle = edge.sourceHandle ?? (direction === 'TB' ? 'bottom-source' : 'right-source');
  const targetHandle = edge.targetHandle ?? (direction === 'TB' ? 'top-target' : 'left-target');
  const start = pointForHandle(source.node, source.size, sourceHandle);
  const end = pointForHandle(target.node, target.size, targetHandle);
  const points = [start, end];
  let path: string;
  let labelPoint: Point = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 - 8 };

  if (edge.markerLoop) {
    if (direction === 'TB') {
      const loopX = Math.min(start.x, end.x) - LOOP_OFFSET;
      path = `M ${start.x} ${start.y} H ${loopX} V ${end.y} H ${end.x}`;
      points.push({ x: loopX, y: start.y }, { x: loopX, y: end.y });
      labelPoint = { x: loopX, y: (start.y + end.y) / 2 - 8 };
    } else {
      const loopY = Math.min(start.y, end.y) - LOOP_OFFSET;
      path = `M ${start.x} ${start.y} V ${loopY} H ${end.x} V ${end.y}`;
      points.push({ x: start.x, y: loopY }, { x: end.x, y: loopY });
      labelPoint = { x: (start.x + end.x) / 2, y: loopY - 10 };
    }
  } else {
    const sourceSide = sideFromHandle(sourceHandle);
    const targetSide = sideFromHandle(targetHandle);
    const sourceNormal = normalForSide(sourceSide);
    const targetNormal = normalForSide(targetSide);
    const distance = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y));
    const control = Math.max(56, Math.min(130, distance * 0.42));
    const c1 = { x: start.x + sourceNormal.x * control, y: start.y + sourceNormal.y * control };
    const c2 = { x: end.x + targetNormal.x * control, y: end.y + targetNormal.y * control };
    path = `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`;
    points.push(c1, c2);
  }

  const label = edge.label?.trim()
    ? {
        text: edge.label.trim(),
        x: labelPoint.x,
        y: labelPoint.y,
        width: Math.ceil(estimateTextWidth(edge.label.trim(), EDGE_LABEL_FONT_SIZE) + 12),
      }
    : undefined;

  if (label) {
    points.push({ x: label.x - label.width / 2, y: label.y - 12 }, { x: label.x + label.width / 2, y: label.y + 6 });
  }

  return { edge, path, label, points };
}

function nodeShape(node: SvgNode): string {
  const { x, y } = node.node.position;
  const { width, height } = node.size;
  const left = x - width / 2;
  const top = y - height / 2;

  if (node.node.type === 'start' || node.node.type === 'end') {
    return `<rect x="${left}" y="${top}" width="${width}" height="${height}" rx="${height / 2}" fill="#dbeafe" stroke="#60a5fa" stroke-width="1.5" />`;
  }

  if (node.node.type === 'decision') {
    const points = `${x},${top} ${left + width},${y} ${x},${top + height} ${left},${y}`;
    return `<polygon points="${points}" fill="#fde68a" />`;
  }

  if (node.node.type === 'merge') {
    const radius = Math.min(width, height) / 2;
    return `<circle cx="${x}" cy="${y}" r="${radius}" fill="#e9d5ff" stroke="#c084fc" stroke-width="1.5" />`;
  }

  if (node.node.type === 'io') {
    const skew = Math.min(22, width * 0.14);
    const points = `${left + skew},${top} ${left + width},${top} ${left + width - skew},${top + height} ${left},${top + height}`;
    return `<polygon points="${points}" fill="#dcfce7" stroke="#4ade80" stroke-width="1.5" />`;
  }

  return `<rect x="${left}" y="${top}" width="${width}" height="${height}" rx="8" fill="#ffffff" stroke="#d7dce2" stroke-width="1.2" />`;
}

function nodeText(node: SvgNode): string {
  const { x, y } = node.node.position;
  const firstY = y - ((node.lines.length - 1) * NODE_LINE_HEIGHT) / 2 + NODE_FONT_SIZE * 0.36;
  const lines = node.lines.map((line, index) => (
    `<tspan x="${x}" y="${firstY + index * NODE_LINE_HEIGHT}">${escapeXml(line)}</tspan>`
  )).join('');
  const weight = node.node.type === 'decision' ? 500 : 400;
  const fill = node.node.type === 'decision' ? '#713f12' : TEXT_COLOR;
  return `<text text-anchor="middle" font-family="${FONT_FAMILY}" font-size="${NODE_FONT_SIZE}" font-weight="${weight}" fill="${fill}">${lines}</text>`;
}

function edgeSvg(route: EdgeRoute): string {
  const markerStart = route.edge.markerStart ? ' marker-start="url(#flowchart-arrow-start)"' : '';
  const markerEnd = route.edge.markerEnd === false ? '' : ' marker-end="url(#flowchart-arrow-end)"';
  const dash = route.edge.markerLoop ? ' stroke-dasharray="6 5"' : '';
  const label = route.label
    ? `<g><rect x="${route.label.x - route.label.width / 2}" y="${route.label.y - 15}" width="${route.label.width}" height="19" rx="4" fill="#ffffff" opacity="0.95" /><text x="${route.label.x}" y="${route.label.y}" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="${EDGE_LABEL_FONT_SIZE}" fill="${EDGE_LABEL_COLOR}">${escapeXml(route.label.text)}</text></g>`
    : '';
  return `<path d="${route.path}" fill="none" stroke="${EDGE_COLOR}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"${dash}${markerStart}${markerEnd} />${label}`;
}

function collectBounds(nodes: SvgNode[], routes: EdgeRoute[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const item of nodes) {
    const { x, y } = item.node.position;
    minX = Math.min(minX, x - item.size.width / 2);
    minY = Math.min(minY, y - item.size.height / 2);
    maxX = Math.max(maxX, x + item.size.width / 2);
    maxY = Math.max(maxY, y + item.size.height / 2);
  }

  for (const route of routes) {
    for (const point of route.points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }

  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return { minX, minY, maxX, maxY };
}

function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function hasPosition(node: FlowchartNode): boolean {
  return Number.isFinite(node.position?.x) && Number.isFinite(node.position?.y);
}

async function svgDataUrlToPng(dataUrl: string, width: number, height: number): Promise<string> {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Flowchart SVG 렌더 실패'));
    image.src = dataUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width * SCALE));
  canvas.height = Math.max(1, Math.ceil(height * SCALE));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d 컨텍스트를 만들 수 없습니다.');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

export function flowchartToSvgSnapshot(flowchart: StoredFlowchart): FlowchartImageSnapshot {
  const direction = flowchart.direction ?? 'LR';
  const baseNodes = flowchart.nodes.map((node) => ({
    ...node,
    position: node.position ?? { x: 0, y: 0 },
  }));
  const initialNodes = new Map(baseNodes.map((node) => [node.id, buildSvgNode(node)]));
  const layouted = layoutFlowchart(baseNodes, flowchart.edges, {
    rankdir: direction,
    getNodeSize: (node) => initialNodes.get(node.id)?.size,
  });
  const mergedNodes = layouted.nodes.map((node) => {
    const stored = flowchart.nodes.find((item) => item.id === node.id);
    return stored && hasPosition(stored) ? { ...node, position: stored.position } : node;
  });
  const routedEdges = assignFlowchartEdgeHandles(layouted.edges, mergedNodes, direction);
  const svgNodes = mergedNodes.map((node) => buildSvgNode(node));
  const nodeMap = new Map(svgNodes.map((item) => [item.node.id, item]));
  const routes = routedEdges
    .map((edge) => buildEdgeRoute(edge, nodeMap, direction))
    .filter((route): route is EdgeRoute => route !== null);
  const bounds = collectBounds(svgNodes, routes);
  const minX = Math.floor(bounds.minX - OUTER_PADDING_LEFT);
  const minY = Math.floor(bounds.minY - OUTER_PADDING_Y);
  const width = Math.ceil(bounds.maxX - bounds.minX + OUTER_PADDING_LEFT + OUTER_PADDING_RIGHT);
  const height = Math.ceil(bounds.maxY - bounds.minY + OUTER_PADDING_Y * 2);
  const title = flowchart.title?.trim() || 'Flowchart';

  const edges = routes.map(edgeSvg).join('');
  const nodes = svgNodes.map((node) => `<g>${nodeShape(node)}${nodeText(node)}</g>`).join('');
  const svg = `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="${minX} ${minY} ${width} ${height}">
<defs>
  <marker id="flowchart-arrow-end" markerWidth="10" markerHeight="10" refX="8.5" refY="5" orient="auto" markerUnits="strokeWidth">
    <path d="M 0 0 L 10 5 L 0 10 z" fill="${EDGE_COLOR}" />
  </marker>
  <marker id="flowchart-arrow-start" markerWidth="10" markerHeight="10" refX="1.5" refY="5" orient="auto-start-reverse" markerUnits="strokeWidth">
    <path d="M 10 0 L 0 5 L 10 10 z" fill="${EDGE_COLOR}" />
  </marker>
</defs>
<rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="#ffffff" />
<g>${edges}</g>
<g>${nodes}</g>
</svg>`;

  return { dataUrl: svgToDataUrl(svg), width, height, title };
}

export async function flowchartToPngSnapshot(flowchart: StoredFlowchart): Promise<FlowchartImageSnapshot> {
  const svg = flowchartToSvgSnapshot(flowchart);
  const dataUrl = await svgDataUrlToPng(svg.dataUrl, svg.width, svg.height);
  return { ...svg, dataUrl };
}
