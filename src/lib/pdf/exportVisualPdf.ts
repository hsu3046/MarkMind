/**
 * 시각 뷰(간트·마인드맵·플로우차트) PDF export — 하이브리드 전략의 "시각 = 캡처" 경로.
 * 텍스트(rich text)는 별도 NSPrint(@media print) 경로(App.handleExportPdf).
 *
 * 핵심 설계:
 * - **간트(자체 SVG)** 는 SVG 네이티브 직렬화로 캡처(html-to-image 로 SVG 를 직접 캡처하면
 *   foreignObject 로 감싸져 느리고 배경/색이 깨짐). computed 스타일 inline + 흰 배경 rect.
 * - **마인드맵/플로우차트(React Flow = HTML div)** 는 html-to-image. 단 엣지는 SVG path 라
 *   CSS 클래스 stroke 가 누락돼 선이 안 보임 → 캡처 직전 computed stroke 를 inline 주입.
 * - 색이 전부 CSS 변수라 다크모드면 배경이 검정 → 캡처 동안 라이트 테마 강제(withLightTheme).
 * - 다이얼로그/진행표시는 호출부(App)가 제어 — build(캡처+PDF) 와 write(저장) 를 분리해
 *   "다이얼로그 → 진행표시 → 생성 → 저장" 흐름을 만든다(생성 지연 동안 progress 노출).
 */

/** 96dpi 기준 CSS px → mm (jsPDF unit=mm). */
const PX_PER_MM = 96 / 25.4;
/** 캡처 해상도 배율. */
const SCALE = 2;
/** 페이지 가장자리 여백(mm). */
const MARGIN_MM = 6;
const SVG_NS = 'http://www.w3.org/2000/svg';

export type VisualViewMode = 'gantt' | 'mindmap' | 'flowchart';

export interface CapturedImage {
    dataUrl: string;
    /** 논리(CSS) 픽셀 크기 — scale 과 무관한 실제 레이아웃 크기. */
    width: number;
    height: number;
}

/** 시각 뷰에 캡처할 내용이 있는지(빈 뷰면 다이얼로그를 안 띄우고 안내). */
export function hasVisualContent(viewMode: VisualViewMode): boolean {
    if (viewMode === 'gantt') return !!document.querySelector('.gantt-view .gantt-svg');
    const sel = viewMode === 'mindmap' ? '.mindmap-view' : '.flowchart-view';
    return !!document.querySelector(`${sel} .react-flow__node`);
}

/**
 * 캡처 동안 대상 요소에 `data-theme='light'` 를 강제하고 원복. 색이 전부 CSS 변수라
 * 다크모드면 배경이 #1A1A1A(검정)로 캡처된다. 요소 자신에 light 속성을 주면 그 서브트리가
 * 라이트 변수로 해석돼 PDF 가 흰 배경/어두운 텍스트로 나온다(시각 뷰 공통).
 */
async function withLightTheme<T>(el: Element, fn: () => Promise<T>): Promise<T> {
    const prev = el.getAttribute('data-theme');
    el.setAttribute('data-theme', 'light');
    void (el as HTMLElement).getBoundingClientRect?.(); // 강제 reflow
    try {
        return await fn();
    } finally {
        if (prev === null) el.removeAttribute('data-theme');
        else el.setAttribute('data-theme', prev);
    }
}

// ─── 간트(자체 SVG) ───────────────────────────────────────────────────────────

const INLINE_PROPS = [
    'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray',
    'opacity', 'font-size', 'font-weight', 'font-family', 'color', 'text-anchor',
];

/** 원본 트리의 computed 그리기 속성을 클론의 같은 위치 요소에 inline 복사
 *  (직렬화 시 외부 CSS 클래스 스타일이 빠지므로 fill/stroke/font 등을 박제). */
function inlineComputedStyles(src: Element, dst: Element): void {
    const srcEls = [src, ...Array.from(src.querySelectorAll('*'))];
    const dstEls = [dst, ...Array.from(dst.querySelectorAll('*'))];
    for (let i = 0; i < srcEls.length && i < dstEls.length; i++) {
        const cs = getComputedStyle(srcEls[i]);
        const style = (dstEls[i] as SVGElement).style;
        for (const p of INLINE_PROPS) {
            const v = cs.getPropertyValue(p);
            if (v) style.setProperty(p, v);
        }
    }
}

/** SVG 요소 → 흰 배경 PNG. computed 스타일 inline + 흰 배경 rect 로 검은 배경/색 누락 방지. */
async function svgToPng(svg: SVGSVGElement, w: number, h: number, scale = SCALE): Promise<CapturedImage> {
    const clone = svg.cloneNode(true) as SVGSVGElement;
    inlineComputedStyles(svg, clone);
    clone.setAttribute('width', String(w));
    clone.setAttribute('height', String(h));
    clone.setAttribute('xmlns', SVG_NS);

    const bg = document.createElementNS(SVG_NS, 'rect');
    bg.setAttribute('x', '0');
    bg.setAttribute('y', '0');
    bg.setAttribute('width', String(w));
    bg.setAttribute('height', String(h));
    bg.setAttribute('fill', '#ffffff');
    clone.insertBefore(bg, clone.firstChild);

    const xml = new XMLSerializer().serializeToString(clone);
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
    const imgEl = new Image();
    await new Promise<void>((resolve, reject) => {
        imgEl.onload = () => resolve();
        imgEl.onerror = () => reject(new Error('SVG 렌더 실패'));
        imgEl.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d 컨텍스트를 만들 수 없습니다.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(imgEl, 0, 0, canvas.width, canvas.height);
    return { dataUrl: canvas.toDataURL('image/png'), width: w, height: h };
}

async function captureGantt(): Promise<CapturedImage | null> {
    const svg = document.querySelector('.gantt-view .gantt-svg') as SVGSVGElement | null;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const w = Math.ceil(svg.width?.baseVal?.value || rect.width);
    const h = Math.ceil(svg.height?.baseVal?.value || rect.height);
    return withLightTheme(svg, () => svgToPng(svg, w, h));
}

// ─── 마인드맵 / 플로우차트(React Flow) ────────────────────────────────────────

interface FlowBounds {
    minX: number;
    minY: number;
    width: number;
    height: number;
}

/** React Flow viewport 안 모든 노드의 transform/크기로 전체 bounds(화면 밖 포함). */
function computeFlowBounds(viewport: HTMLElement): FlowBounds | null {
    const nodes = viewport.querySelectorAll<HTMLElement>('.react-flow__node');
    if (nodes.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach((n) => {
        const m = /translate(?:3d)?\(\s*([-\d.]+)px,\s*([-\d.]+)px/.exec(n.style.transform);
        const x = m ? parseFloat(m[1]) : 0;
        const y = m ? parseFloat(m[2]) : 0;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + n.offsetWidth);
        maxY = Math.max(maxY, y + n.offsetHeight);
    });
    if (!Number.isFinite(minX)) return null;
    return { minX, minY, width: maxX - minX, height: maxY - minY };
}

/** 엣지(SVG path)의 stroke 는 React Flow 기본 CSS 클래스라 html-to-image 가 누락해 선이 안
 *  보인다 → 캡처 직전 computed stroke/fill 을 인라인 주입하고, 복원 함수를 돌려준다. */
function inlineEdgeStyles(viewport: HTMLElement): () => void {
    const els = viewport.querySelectorAll<SVGElement>(
        '.react-flow__edge-path, .react-flow__connection-path, .react-flow__arrowhead, .react-flow__edge-text, marker path, marker polyline',
    );
    const restorers: Array<() => void> = [];
    els.forEach((el) => {
        const cs = getComputedStyle(el);
        const prev = { stroke: el.style.stroke, sw: el.style.strokeWidth, fill: el.style.fill };
        const stroke = cs.stroke;
        if (stroke && stroke !== 'none') el.style.stroke = stroke;
        if (cs.strokeWidth) el.style.strokeWidth = cs.strokeWidth;
        // 화살표/라벨은 fill 로 색이 들어감.
        const fill = cs.fill;
        if (fill && fill !== 'none') el.style.fill = fill;
        restorers.push(() => {
            el.style.stroke = prev.stroke;
            el.style.strokeWidth = prev.sw;
            el.style.fill = prev.fill;
        });
    });
    return () => restorers.forEach((fn) => fn());
}

async function captureReactFlow(viewport: HTMLElement, b: FlowBounds, pad = 48): Promise<CapturedImage> {
    const w = Math.ceil(b.width + pad * 2);
    const h = Math.ceil(b.height + pad * 2);
    const restoreEdges = inlineEdgeStyles(viewport); // 라이트 강제 상태의 computed stroke 박제
    try {
        const { toPng } = await import('html-to-image');
        const dataUrl = await toPng(viewport, {
            backgroundColor: '#ffffff',
            width: w,
            height: h,
            pixelRatio: SCALE,
            style: {
                transform: `translate(${-b.minX + pad}px, ${-b.minY + pad}px) scale(1)`,
                transformOrigin: '0 0',
            },
            cacheBust: true,
        });
        return { dataUrl, width: w, height: h };
    } finally {
        restoreEdges();
    }
}

async function captureFlowView(viewMode: 'mindmap' | 'flowchart'): Promise<CapturedImage | null> {
    const container = document.querySelector(
        viewMode === 'mindmap' ? '.mindmap-view' : '.flowchart-view',
    ) as HTMLElement | null;
    const viewport = container?.querySelector('.react-flow__viewport') as HTMLElement | null;
    const bounds = viewport ? computeFlowBounds(viewport) : null;
    if (!container || !viewport || !bounds) return null;
    return withLightTheme(container, () => captureReactFlow(viewport, bounds));
}

// ─── 공통: PDF 조립 / 저장 ────────────────────────────────────────────────────

/** 콘텐츠 비율에 맞춘 단일 커스텀 페이지 PDF(잘림 0, orientation 자동). jsPDF 지연 로드. */
async function imageToPdfBlob(img: CapturedImage, marginMm = MARGIN_MM): Promise<Blob> {
    const { jsPDF } = await import('jspdf');
    const cw = img.width / PX_PER_MM;
    const ch = img.height / PX_PER_MM;
    const pageW = cw + marginMm * 2;
    const pageH = ch + marginMm * 2;
    const orientation = pageW >= pageH ? 'landscape' : 'portrait';
    const pdf = new jsPDF({ orientation, unit: 'mm', format: [pageW, pageH], compress: true });
    pdf.addImage(img.dataUrl, 'PNG', marginMm, marginMm, cw, ch, undefined, 'FAST');
    return pdf.output('blob');
}

/** 현재 시각 뷰를 PDF blob 으로(빈 뷰면 null). 캡처+PDF(무거움) — 다이얼로그/진행표시는 호출부. */
export async function buildVisualViewPdf(viewMode: VisualViewMode): Promise<Blob | null> {
    const img = viewMode === 'gantt' ? await captureGantt() : await captureFlowView(viewMode);
    if (!img) return null;
    return imageToPdfBlob(img);
}

/** PDF blob → 지정 경로에 바이너리 쓰기. */
export async function writePdfBlob(blob: Blob, path: string): Promise<void> {
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
}
