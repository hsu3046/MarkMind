// Slide[] → .pptx (ArrayBuffer) — 이슈 #6 PPTX 내보내기
//
// PptxGenJS 로 네이티브 편집 가능 pptx 를 생성한다. WKWebView 의 blob:// 다운로드
// 버그(WebKit #216918) 때문에 writeFile()/blob 대신 outputType:'arraybuffer' 로
// 받아 Rust(save_pptx)가 fs::write 한다.
//
// "검정 글씨/흰 배경" 빈약 슬라이드를 피하려고 슬라이드 마스터(테마)를 정의한다.

import PptxGenJS from 'pptxgenjs';
import type { Slide, SlideBlock, InlineSpan } from './markdownToSlides';

// ─── 테마 상수 (MarkMind 톤) ───
const COLORS = {
  accent: '2F6FED', // 헤더 막대 / 강조
  title: '1A1A2E',
  body: '2D2D3A',
  subhead: '2F6FED',
  codeBg: 'F4F5F7',
  codeFg: '24292F',
  faint: '9AA0A6',
  bg: 'FFFFFF',
};
const FONT = 'Helvetica Neue';
const MONO = 'Courier New';

// 16:9 inch 기준 본문 영역
const PAGE_W = 13.333;
const BODY = { x: 0.7, top: 1.55, bottom: 7.0, w: PAGE_W - 1.4 };

type Pptx = InstanceType<typeof PptxGenJS>;

function defineMasters(pptx: Pptx) {
  pptx.defineSlideMaster({
    title: 'TITLE_SLIDE',
    background: { color: COLORS.bg },
    objects: [
      { rect: { x: 0, y: 3.95, w: PAGE_W, h: 0.05, fill: { color: COLORS.accent } } },
    ],
  });
  pptx.defineSlideMaster({
    title: 'CONTENT',
    background: { color: COLORS.bg },
    objects: [
      // 상단 제목 영역 액센트 막대
      { rect: { x: 0, y: 1.25, w: PAGE_W, h: 0.035, fill: { color: COLORS.accent } } },
    ],
    slideNumber: { x: PAGE_W - 0.9, y: 7.05, color: COLORS.faint, fontSize: 10 },
  });
}

/** InlineSpan[] → PptxGenJS rich-text 배열. */
function spansToRich(
  spans: InlineSpan[],
  base: { bullet?: boolean; indentLevel?: number; breakLine?: boolean; fontSize?: number; color?: string },
) {
  return spans.map((s, idx) => ({
    text: s.text,
    options: {
      bold: s.bold,
      italic: s.italic,
      fontFace: s.code ? MONO : FONT,
      // 첫 run 에만 bullet/indent/breakLine 적용
      ...(idx === 0
        ? {
            bullet: base.bullet ? { indent: 14 } : undefined,
            indentLevel: base.indentLevel,
            breakLine: base.breakLine,
          }
        : {}),
      fontSize: base.fontSize,
      color: base.color,
    },
  }));
}

const ext = (src: string) => src.split('.').pop()?.toLowerCase() ?? '';
const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
};

/**
 * 본문 이미지 경로 → PptxGenJS addImage 인자. 로컬 파일은 base64 data URL 로 읽어
 * 넣고(WKWebView 가 직접 못 가져옴), http(s)/data URL 은 path 로 전달. 실패 시 null.
 */
async function resolveImage(
  src: string,
  baseDir?: string,
): Promise<{ data?: string; path?: string } | null> {
  if (src.startsWith('data:')) return { data: src };
  if (/^https?:\/\//i.test(src)) return { path: src };
  try {
    const { readFile } = await import('@tauri-apps/plugin-fs');
    // asset:// 또는 상대/절대 로컬 경로
    let p = src.replace(/^asset:\/\/(localhost\/)?/i, '');
    p = decodeURIComponent(p);
    if (!p.startsWith('/') && baseDir) p = `${baseDir.replace(/\/$/, '')}/${p}`;
    const bytes = await readFile(p);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const b64 = btoa(bin);
    const mime = MIME[ext(p)] ?? 'image/png';
    return { data: `data:${mime};base64,${b64}` };
  } catch (e) {
    console.warn('[buildPptx] 이미지 로드 실패, 건너뜀:', src, e);
    return null;
  }
}

function renderTitleSlide(pptx: Pptx, slide: Slide) {
  const s = pptx.addSlide({ masterName: 'TITLE_SLIDE' });
  s.addText(slide.title || 'Untitled', {
    x: 0.8,
    y: 2.7,
    w: PAGE_W - 1.6,
    h: 1.2,
    fontFace: FONT,
    fontSize: 40,
    bold: true,
    color: COLORS.title,
    align: 'left',
    valign: 'bottom',
  });
  // 본문 첫 text/bullet 를 부제로
  const sub = slide.body.find((b) => b.kind === 'text' || b.kind === 'bullet');
  if (sub && (sub.kind === 'text' || sub.kind === 'bullet')) {
    s.addText(sub.spans.map((x) => x.text).join(''), {
      x: 0.8,
      y: 4.15,
      w: PAGE_W - 1.6,
      h: 0.8,
      fontFace: FONT,
      fontSize: 18,
      color: COLORS.faint,
      align: 'left',
    });
  }
  if (slide.notes) s.addNotes(slide.notes);
}

async function renderContentSlide(pptx: Pptx, slide: Slide, baseDir?: string) {
  const s = pptx.addSlide({ masterName: 'CONTENT' });
  if (slide.title) {
    s.addText(slide.title, {
      x: BODY.x,
      y: 0.4,
      w: BODY.w,
      h: 0.8,
      fontFace: FONT,
      fontSize: 26,
      bold: true,
      color: COLORS.title,
      valign: 'middle',
    });
  }

  // 블록을 위→아래 커서로 배치. text/bullet/subhead 는 연속 그룹으로 묶어 하나의
  // 텍스트박스(fit:shrink)로, table/image/code 는 개별 박스로.
  let y = BODY.top;
  const avail = () => BODY.bottom - y;
  let textRun: SlideBlock[] = [];

  const flushText = () => {
    if (textRun.length === 0) return;
    const rich: ReturnType<typeof spansToRich> = [];
    for (const b of textRun) {
      if (b.kind === 'subhead') {
        rich.push(
          ...spansToRich([{ text: b.text, bold: true }], {
            breakLine: true,
            fontSize: 18,
            color: COLORS.subhead,
          }),
        );
      } else if (b.kind === 'bullet') {
        rich.push(
          ...spansToRich(b.spans, {
            bullet: true,
            indentLevel: b.indent,
            breakLine: true,
            fontSize: 16,
            color: COLORS.body,
          }),
        );
      } else if (b.kind === 'text') {
        rich.push(
          ...spansToRich(b.spans, {
            breakLine: true,
            fontSize: 16,
            color: COLORS.body,
          }),
        );
      }
    }
    const lines = textRun.length;
    const h = Math.min(avail(), Math.max(0.5, lines * 0.42));
    s.addText(rich, {
      x: BODY.x,
      y,
      w: BODY.w,
      h,
      valign: 'top',
      align: 'left',
      lineSpacingMultiple: 1.15,
      fit: 'shrink',
    });
    y += h + 0.12;
    textRun = [];
  };

  for (const b of slide.body) {
    if (b.kind === 'text' || b.kind === 'bullet' || b.kind === 'subhead') {
      textRun.push(b);
      continue;
    }
    flushText();
    if (avail() < 0.6) break; // 공간 소진
    if (b.kind === 'code') {
      const codeLines = b.text.split('\n').length;
      const h = Math.min(avail(), Math.max(0.5, codeLines * 0.26 + 0.3));
      s.addText(b.text, {
        x: BODY.x,
        y,
        w: BODY.w,
        h,
        fontFace: MONO,
        fontSize: 12,
        color: COLORS.codeFg,
        fill: { color: COLORS.codeBg },
        align: 'left',
        valign: 'top',
        margin: 6,
        fit: 'shrink',
      });
      y += h + 0.12;
    } else if (b.kind === 'table') {
      const rows = b.rows.map((r, ri) =>
        r.map((cell) => ({
          text: cell,
          options: {
            bold: ri === 0,
            color: ri === 0 ? 'FFFFFF' : COLORS.body,
            fill: { color: ri === 0 ? COLORS.accent : 'FFFFFF' },
            fontFace: FONT,
            fontSize: 13,
          },
        })),
      );
      const h = Math.min(avail(), Math.max(0.4, b.rows.length * 0.4));
      s.addTable(rows, {
        x: BODY.x,
        y,
        w: BODY.w,
        h,
        border: { type: 'solid', pt: 0.5, color: 'D7DAE0' },
        valign: 'middle',
      });
      y += h + 0.15;
    } else if (b.kind === 'image') {
      const img = await resolveImage(b.src, baseDir);
      const h = Math.min(avail(), 3.2);
      if (img) {
        s.addImage({
          ...img,
          x: BODY.x,
          y,
          w: BODY.w,
          h,
          sizing: { type: 'contain', w: BODY.w, h },
          altText: b.alt,
        });
      } else {
        s.addText(`[이미지: ${b.alt || b.src}]`, {
          x: BODY.x,
          y,
          w: BODY.w,
          h: 0.5,
          fontFace: FONT,
          fontSize: 12,
          italic: true,
          color: COLORS.faint,
        });
        y -= h - 0.5;
      }
      y += h + 0.15;
    }
  }
  flushText();

  if (slide.notes) s.addNotes(slide.notes);
}

/**
 * Slide[] → .pptx ArrayBuffer.
 * @param baseDir 현재 문서 디렉토리(상대 이미지 경로 해석용, 옵션)
 */
export async function buildPptx(
  slides: Slide[],
  opts?: { title?: string; baseDir?: string },
): Promise<ArrayBuffer> {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'MM_16x9', width: PAGE_W, height: 7.5 });
  pptx.layout = 'MM_16x9';
  pptx.author = 'MarkMind';
  if (opts?.title) pptx.title = opts.title;
  defineMasters(pptx);

  for (const slide of slides) {
    if (slide.layout === 'title') renderTitleSlide(pptx, slide);
    else await renderContentSlide(pptx, slide, opts?.baseDir);
  }

  return (await pptx.write({ outputType: 'arraybuffer' })) as ArrayBuffer;
}
