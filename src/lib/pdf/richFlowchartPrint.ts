import type { StoredFlowchart } from '../flowchartBlock';
import type { FlowchartEdge, FlowchartNode } from '../../types/flowchart';
import { flowchartToPngSnapshot } from './flowchartSvgSnapshot';

const SNAPSHOT_CLASS = 'is-print-snapshot';
const PRINT_IMAGE_CLASS = 'rich-flowchart-print-image';
const PRINT_IMAGE_WIDTH = '88%';

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function parseStoredFlowchartJson(code: string): StoredFlowchart | null {
  try {
    const data = JSON.parse(code);
    if (!Array.isArray(data?.nodes) || !Array.isArray(data?.edges)) return null;
    const direction = data.direction === 'TB' ? 'TB' : data.direction === 'LR' ? 'LR' : undefined;
    return {
      title: typeof data.title === 'string' ? data.title : undefined,
      direction,
      nodes: data.nodes as FlowchartNode[],
      edges: data.edges as FlowchartEdge[],
    };
  } catch {
    return null;
  }
}

function readFlowchart(block: HTMLElement): StoredFlowchart | null {
  const datasetJson = block.dataset.flowchartJson?.trim();
  if (datasetJson) {
    const parsed = parseStoredFlowchartJson(datasetJson);
    if (parsed) return parsed;
  }

  const source = block.querySelector<HTMLElement>('.rich-flowchart-block__content-host')?.textContent?.trim();
  return source ? parseStoredFlowchartJson(source) : null;
}

async function createFlowchartPrintImage(block: HTMLElement): Promise<HTMLImageElement | null> {
  const flowchart = readFlowchart(block);
  if (!flowchart || flowchart.nodes.length === 0) return null;

  const snapshot = await flowchartToPngSnapshot(flowchart);
  const img = document.createElement('img');
  img.className = PRINT_IMAGE_CLASS;
  img.src = snapshot.dataUrl;
  img.alt = snapshot.title;
  img.width = snapshot.width;
  img.height = snapshot.height;
  img.decoding = 'sync';
  img.style.width = PRINT_IMAGE_WIDTH;
  img.style.maxWidth = PRINT_IMAGE_WIDTH;
  img.style.height = 'auto';
  img.style.margin = '0 auto';
  return img;
}

export async function prepareRichFlowchartsForPrint(): Promise<() => void> {
  const blocks = Array.from(
    document.querySelectorAll<HTMLElement>('.preview-rich-mode .rich-flowchart-block'),
  );
  if (blocks.length === 0) return () => {};

  await document.fonts?.ready?.catch(() => undefined);
  await nextFrame();

  const cleanup: Array<() => void> = [];
  for (const block of blocks) {
    try {
      const img = await createFlowchartPrintImage(block);
      if (!img) continue;

      block.appendChild(img);
      block.classList.add(SNAPSHOT_CLASS);
      cleanup.push(() => {
        block.classList.remove(SNAPSHOT_CLASS);
        img.remove();
      });
    } catch (err) {
      console.warn('[export_pdf] rich flowchart snapshot skipped:', err);
    }
  }

  return () => cleanup.reverse().forEach((restore) => restore());
}
