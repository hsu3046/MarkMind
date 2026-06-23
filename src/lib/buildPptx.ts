// Slide[] -> .pptx (ArrayBuffer) — PptxGenJS 기반 결정론적 렌더러.

import PptxGenJS from 'pptxgenjs';
import type { Slide, SlideBlock, InlineSpan } from './markdownToSlides';
import { DEFAULT_SLIDE_THEME, type SlideTheme } from './slideTheme';
import { pptxFontFaceForText } from './pptxDesignSystem';
import {
  masterSpecIncludes,
  resolveSlideMasterSpec,
  type MasterElementStyle,
  type MasterTextPosition,
  type SlideMasterRole,
  type SlideMasterSpec,
  type SlideMasterTextSpec,
} from './slideMaster';

const PAGE_W = 13.333;
const PAGE_H = 7.5;

type Pptx = InstanceType<typeof PptxGenJS>;
type PptxSlide = ReturnType<Pptx['addSlide']>;
type ResolvedImage = { data?: string; path?: string; width?: number; height?: number };

const RECT_SHAPE = 'rect' as PptxGenJS.ShapeType;

function fontFaceForTheme(text: string, theme: SlideTheme, role: 'heading' | 'body' | 'mono' = 'body'): string {
  const themeFont = role === 'heading' ? theme.fonts.heading : role === 'mono' ? theme.fonts.mono : theme.fonts.body;
  if (role !== 'mono' && theme.fonts.useLanguageFallback === false) return themeFont;
  return pptxFontFaceForText(text, themeFont, role);
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

type MasterObject = NonNullable<PptxGenJS.SlideMasterProps['objects']>[number];

const flattenText = (blocks: SlideBlock[]) =>
  blocks
    .map((b) => {
      if (b.kind === 'text' || b.kind === 'bullet') return b.spans.map((s) => s.text).join('');
      if (b.kind === 'subhead' || b.kind === 'code') return b.text;
      if (b.kind === 'image') return b.alt || '';
      if (b.kind === 'table') return b.rows.map((r) => r.join(' ')).join(' ');
      return '';
    })
    .filter(Boolean)
    .join(' ');

function masterTextColor(theme: SlideTheme, role: SlideMasterRole, style: MasterElementStyle = 'muted'): string {
  if (style === 'accent') return role === 'content' ? theme.palette.accent : theme.palette.accent2;
  if (style === 'inverse') return role === 'content' ? theme.palette.title : theme.palette.inverseText;
  if (role === 'content') return style === 'minimal' ? theme.palette.border : theme.palette.muted;
  return style === 'minimal' ? theme.palette.accent : theme.palette.inverseText;
}

function masterTextPlacement(
  position: MasterTextPosition = 'bottom-right',
  textWidth = 0.9,
  marginX = 0.72,
): { x: number; y: number; w: number; h: number; align: 'left' | 'center' | 'right' } {
  const w = Math.min(4.4, Math.max(0.72, textWidth));
  if (position === 'bottom-left') return { x: marginX, y: 7.06, w, h: 0.24, align: 'left' };
  if (position === 'bottom-center') return { x: (PAGE_W - w) / 2, y: 7.06, w, h: 0.24, align: 'center' };
  return { x: PAGE_W - marginX - w, y: 7.06, w, h: 0.24, align: 'right' };
}

function estimatedMasterTextWidth(text: string): number {
  return Math.min(4.4, Math.max(1.2, Array.from(text).length * 0.078));
}

function slideNumberProps(
  spec: SlideMasterTextSpec | undefined,
  role: SlideMasterRole,
  theme: SlideTheme,
): PptxGenJS.SlideNumberProps | undefined {
  if (!masterSpecIncludes(spec, role)) return undefined;
  return {
    ...masterTextPlacement(spec?.position, 0.74, theme.spacing.marginX),
    fontFace: fontFaceForTheme('9', theme),
    fontSize: 9,
    color: masterTextColor(theme, role, spec?.style),
    margin: 0,
  };
}

function masterTextObject(
  text: string | undefined,
  spec: (SlideMasterTextSpec & { text?: string }) | undefined,
  role: SlideMasterRole,
  theme: SlideTheme,
): MasterObject | undefined {
  if (!text || !masterSpecIncludes(spec, role)) return undefined;
  const placement = masterTextPlacement(spec?.position, estimatedMasterTextWidth(text), theme.spacing.marginX);
  return {
    text: {
      text,
      options: {
        ...placement,
        fontFace: fontFaceForTheme(text, theme),
        fontSize: 9,
        color: masterTextColor(theme, role, spec?.style),
        margin: 0,
        fit: 'shrink',
      },
    },
  };
}

function masterChromeObjects(
  theme: SlideTheme,
  role: SlideMasterRole,
  inverse: boolean,
  spec: SlideMasterSpec,
): MasterObject[] {
  const objects: MasterObject[] = motifObjects(theme, inverse);
  const footer = masterTextObject(spec.footer?.text, spec.footer, role, theme);
  const date = masterTextObject(spec.date?.text, spec.date, role, theme);
  if (footer) objects.push(footer);
  if (date) objects.push(date);
  return objects;
}

function defineMasters(pptx: Pptx, theme: SlideTheme, inputMasterSpec?: SlideMasterSpec) {
  const masterSpec = resolveSlideMasterSpec(inputMasterSpec);
  pptx.defineSlideMaster({
    title: 'TITLE_SLIDE',
    background: { color: theme.palette.title },
    objects: [
      { rect: { x: 0, y: 0, w: PAGE_W, h: PAGE_H, fill: { color: theme.palette.title }, line: { color: theme.palette.title } } },
      ...masterChromeObjects(theme, 'title', true, masterSpec),
    ],
    slideNumber: slideNumberProps(masterSpec.slideNumber, 'title', theme),
  });
  pptx.defineSlideMaster({
    title: 'CONTENT',
    background: { color: theme.palette.bg },
    objects: masterChromeObjects(theme, 'content', false, masterSpec),
    slideNumber: slideNumberProps(masterSpec.slideNumber, 'content', theme),
  });
  pptx.defineSlideMaster({
    title: 'SECTION',
    background: { color: theme.palette.title },
    objects: masterChromeObjects(theme, 'section', true, masterSpec),
    slideNumber: slideNumberProps(masterSpec.slideNumber, 'section', theme),
  });
}

function motifObjects(theme: SlideTheme, inverse: boolean) {
  const accent = inverse ? theme.palette.accent2 : theme.palette.accent;
  const quiet = inverse ? theme.palette.accent : theme.palette.surfaceAlt;
  if (theme.shape.motif === 'corner-block') {
    return [
      { rect: { x: PAGE_W - 2.2, y: 0, w: 2.2, h: 1.15, fill: { color: accent }, line: { color: accent } } },
      { rect: { x: 0, y: PAGE_H - 0.34, w: 2.8, h: 0.34, fill: { color: quiet }, line: { color: quiet } } },
    ];
  }
  if (theme.shape.motif === 'frame') {
    return [
      { rect: { x: 0.18, y: 0.18, w: PAGE_W - 0.36, h: PAGE_H - 0.36, fill: { color: inverse ? theme.palette.title : theme.palette.bg, transparency: 100 }, line: { color: accent, width: 1.2 } } },
    ];
  }
  return [
    { rect: { x: 0, y: 0, w: 0.12, h: PAGE_H, fill: { color: accent }, line: { color: accent } } },
    { rect: { x: PAGE_W - 2.15, y: 0, w: 2.15, h: 0.18, fill: { color: quiet }, line: { color: quiet } } },
    { rect: { x: 0.12, y: PAGE_H - 0.08, w: PAGE_W - 0.12, h: 0.08, fill: { color: accent }, line: { color: accent } } },
  ];
}

function spansToRich(
  spans: InlineSpan[],
  theme: SlideTheme,
  base: {
    bullet?: boolean;
    indentLevel?: number;
    breakLine?: boolean;
    fontSize?: number;
    color?: string;
    lineSpacingMultiple?: number;
    paraSpaceAfter?: number;
    paraSpaceBefore?: number;
  },
) {
  return spans.map((s, idx) => ({
    text: s.text,
    options: {
      bold: s.bold,
      italic: s.italic,
      fontFace: s.code ? fontFaceForTheme(s.text, theme, 'mono') : fontFaceForTheme(s.text, theme),
      ...(idx === 0
        ? {
            bullet: base.bullet ? { indent: 14 } : undefined,
            indentLevel: base.indentLevel,
            breakLine: base.breakLine,
          }
        : {}),
      lineSpacingMultiple: base.lineSpacingMultiple,
      paraSpaceAfter: base.paraSpaceAfter,
      paraSpaceBefore: base.paraSpaceBefore,
      fontSize: base.fontSize,
      color: base.color,
    },
  }));
}

async function resolveImage(
  src: string,
  baseDir?: string,
): Promise<ResolvedImage | null> {
  if (src.startsWith('data:')) return { data: src, ...imageDimensionsFromDataUrl(src) };
  if (/^https?:\/\//i.test(src)) return { path: src };
  try {
    const { readFile } = await import('@tauri-apps/plugin-fs');
    let p = src.replace(/^asset:\/\/(localhost\/)?/i, '');
    p = decodeURIComponent(p);
    if (!p.startsWith('/') && baseDir) p = `${baseDir.replace(/\/$/, '')}/${p}`;
    const bytes = await readFile(p);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const mime = MIME[ext(p)] ?? 'image/png';
    const data = `data:${mime};base64,${btoa(bin)}`;
    return { data, ...imageDimensionsFromBytes(bytes, mime) };
  } catch (e) {
    console.warn('[buildPptx] 이미지 로드 실패, 건너뜀:', src, e);
    return null;
  }
}

function bytesFromDataUrl(dataUrl: string): { bytes: Uint8Array; mime: string } | null {
  const match = dataUrl.match(/^data:([^;,]+)(;base64)?,(.*)$/s);
  if (!match) return null;
  const raw = match[2] ? atob(match[3] || '') : decodeURIComponent(match[3] || '');
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return { bytes, mime: match[1] || 'image/png' };
}

function imageDimensionsFromDataUrl(dataUrl: string): { width?: number; height?: number } {
  const parsed = bytesFromDataUrl(dataUrl);
  return parsed ? imageDimensionsFromBytes(parsed.bytes, parsed.mime) : {};
}

function imageDimensionsFromBytes(bytes: Uint8Array, mime: string): { width?: number; height?: number } {
  if (mime.includes('png') && bytes.length >= 24) {
    const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
    const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
    if (width > 0 && height > 0) return { width, height };
  }
  if (mime.includes('jpeg') || mime.includes('jpg')) {
    for (let i = 2; i + 9 < bytes.length;) {
      if (bytes[i] !== 0xff) break;
      const marker = bytes[i + 1];
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      if (len < 2) break;
      if (marker >= 0xc0 && marker <= 0xc3) {
        const height = (bytes[i + 5] << 8) | bytes[i + 6];
        const width = (bytes[i + 7] << 8) | bytes[i + 8];
        if (width > 0 && height > 0) return { width, height };
      }
      i += 2 + len;
    }
  }
  if (mime.includes('svg')) {
    const text = new TextDecoder().decode(bytes);
    const viewBox = text.match(/viewBox=["']\s*[-.\d]+\s+[-.\d]+\s+([.\d]+)\s+([.\d]+)\s*["']/i);
    if (viewBox) return { width: Number(viewBox[1]), height: Number(viewBox[2]) };
    const width = text.match(/\bwidth=["']([.\d]+)(?:px)?["']/i);
    const height = text.match(/\bheight=["']([.\d]+)(?:px)?["']/i);
    if (width && height) return { width: Number(width[1]), height: Number(height[1]) };
  }
  return {};
}

function fitImageBox(
  img: ResolvedImage,
  box: { x: number; y: number; w: number; h: number },
  mode: 'contain' | 'cover',
): { x: number; y: number; w: number; h: number } {
  if (!img.width || !img.height || img.width <= 0 || img.height <= 0) return box;
  const imageRatio = img.width / img.height;
  const boxRatio = box.w / box.h;
  const fitByWidth = mode === 'contain' ? imageRatio >= boxRatio : imageRatio < boxRatio;
  const w = fitByWidth ? box.w : box.h * imageRatio;
  const h = fitByWidth ? box.w / imageRatio : box.h;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

function slideImageSrc(slide: Slide): string | undefined {
  return slide.image?.src?.trim() || undefined;
}

async function addSlideImage(
  s: PptxSlide,
  slide: Slide,
  baseDir: string | undefined,
  box: { x: number; y: number; w: number; h: number },
  sizing: 'contain' | 'cover' = 'contain',
): Promise<boolean> {
  const src = slideImageSrc(slide);
  if (!src) return false;
  const img = await resolveImage(src, baseDir);
  if (!img) return false;
  const { width: _width, height: _height, ...imgProps } = img;
  const fitted = fitImageBox(img, box, sizing);
  s.addImage({
    ...imgProps,
    ...fitted,
    altText: slide.image?.alt || slide.title,
  });
  return true;
}

async function addSlideBackgroundImage(
  s: PptxSlide,
  slide: Slide,
  theme: SlideTheme,
  baseDir?: string,
): Promise<boolean> {
  const added = await addSlideImage(s, slide, baseDir, { x: 0, y: 0, w: PAGE_W, h: PAGE_H }, 'cover');
  if (!added) return false;
  s.addShape(RECT_SHAPE, {
    x: 0,
    y: 0,
    w: PAGE_W,
    h: PAGE_H,
    fill: { color: theme.palette.title, transparency: 18 },
    line: { color: theme.palette.title, transparency: 100 },
  });
  return true;
}

async function addSlideImagePanel(
  s: PptxSlide,
  slide: Slide,
  theme: SlideTheme,
  baseDir: string | undefined,
  box: { x: number; y: number; w: number; h: number },
  sizing: 'contain' | 'cover' = 'contain',
): Promise<boolean> {
  s.addShape(RECT_SHAPE, {
    ...box,
    fill: { color: theme.palette.surfaceAlt, transparency: 0 },
    line: { color: theme.palette.border, transparency: 100 },
  });
  const added = await addSlideImage(s, slide, baseDir, box, sizing);
  if (!added) return false;
  s.addShape(RECT_SHAPE, {
    ...box,
    fill: { color: theme.palette.surface, transparency: 100 },
    line: { color: theme.palette.border, transparency: 12, width: 0.7 },
  });
  return true;
}

function headingLevelFor(slide: Slide): number {
  if (slide.sourceLevel && slide.sourceLevel >= 1 && slide.sourceLevel <= 6) return slide.sourceLevel;
  if (slide.layout === 'title' || slide.layout === 'section') return 1;
  return 2;
}

function titleMetrics(slide: Slide, theme: SlideTheme) {
  const level = headingLevelFor(slide);
  if (level <= 1) {
    return { y: theme.spacing.titleY, h: 0.9, fontSize: theme.typeScale.title + 4 };
  }
  if (level === 2) {
    return { y: theme.spacing.titleY + 0.08, h: 0.78, fontSize: theme.typeScale.title };
  }
  return { y: theme.spacing.titleY + 0.2, h: 0.64, fontSize: Math.max(21, theme.typeScale.title - 5) };
}

function bodyTopFor(slide: Slide, theme: SlideTheme): number {
  if (sectionTrail(slide)) return Math.max(theme.spacing.bodyTop, 1.58);
  if (headingLevelFor(slide) >= 3) return Math.max(1.34, theme.spacing.bodyTop - 0.12);
  return theme.spacing.bodyTop;
}

function sectionTrail(slide: Slide): string {
  const path = (slide.sectionPath ?? [])
    .map((p) => p.trim())
    .filter((p) => p && !/^\(?root\)?$/i.test(p) && !/^document(?: opening)?$/i.test(p));
  if (path.length === 0) return '';
  const title = slide.title.trim();
  const visible = path.filter((p) => p !== title).slice(-2);
  return visible.join(' / ');
}

function addSectionTrail(s: PptxSlide, slide: Slide, theme: SlideTheme, inverse = false) {
  const trail = sectionTrail(slide);
  if (!trail) return;
  s.addText(trail, {
    x: theme.spacing.marginX,
    y: 0.22,
    w: PAGE_W - theme.spacing.marginX * 2,
    h: 0.22,
    fontFace: fontFaceForTheme(trail, theme),
    fontSize: Math.max(9, theme.typeScale.caption - 1),
    bold: true,
    color: inverse ? theme.palette.inverseText : theme.palette.muted,
    transparency: inverse ? 16 : 0,
    margin: 0,
    fit: 'shrink',
  });
}

function subheadFontSize(level: number | undefined, theme: SlideTheme): number {
  if (!level || level <= 2) return theme.typeScale.body + 4;
  if (level === 3) return theme.typeScale.body + 2;
  return theme.typeScale.body + 1;
}

type BlockRenderProfile = {
  bodyFontSize: number;
  lineSpacingMultiple: number;
  paraSpaceAfter: number;
  subheadSpaceBefore: number;
  gap: number;
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function blockText(block: SlideBlock): string {
  if (block.kind === 'text' || block.kind === 'bullet') return block.spans.map((s) => s.text).join('');
  if (block.kind === 'subhead' || block.kind === 'code') return block.text;
  if (block.kind === 'table') return block.rows.map((row) => row.join(' ')).join(' ');
  if (block.kind === 'image') return block.alt || block.src;
  return '';
}

function estimatedTextWidthPt(text: string, fontSize: number): number {
  let units = 0;
  for (const ch of text) {
    if (/\s/.test(ch)) units += 0.32;
    else if (/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af\u3040-\u30ff\u3400-\u9fff]/.test(ch)) units += 0.92;
    else if (/[A-Z0-9]/.test(ch)) units += 0.58;
    else if (/[.,:;'"`|!()\[\]{}]/.test(ch)) units += 0.3;
    else units += 0.52;
  }
  return units * fontSize;
}

function estimatedLineCount(text: string, boxW: number, fontSize: number, indent = 0): number {
  const usableWidthPt = Math.max(40, boxW * 72 - indent * 18);
  const paragraphs = text.split(/\n+/).filter(Boolean);
  if (paragraphs.length === 0) return 1;
  return paragraphs.reduce(
    (sum, paragraph) => sum + Math.max(1, Math.ceil(estimatedTextWidthPt(paragraph, fontSize) / usableWidthPt)),
    0,
  );
}

function fontSizeForBlock(block: SlideBlock, theme: SlideTheme, profile: BlockRenderProfile): number {
  if (block.kind === 'subhead') {
    const delta = subheadFontSize(block.level, theme) - theme.typeScale.body;
    return clamp(profile.bodyFontSize + delta, profile.bodyFontSize + 1, profile.bodyFontSize + 5);
  }
  return profile.bodyFontSize;
}

function defaultBlockProfile(theme: SlideTheme): BlockRenderProfile {
  return {
    bodyFontSize: theme.typeScale.body,
    lineSpacingMultiple: 1.12,
    paraSpaceAfter: 3,
    subheadSpaceBefore: 10,
    gap: theme.spacing.gap,
  };
}

function estimateTextRunHeight(
  blocks: SlideBlock[],
  theme: SlideTheme,
  boxW: number,
  profile: BlockRenderProfile,
): number {
  if (blocks.length === 0) return 0;
  const height = blocks.reduce((sum, block, idx) => {
    const fontSize = fontSizeForBlock(block, theme, profile);
    const indent = block.kind === 'bullet' ? 1 + block.indent : 0;
    const lines = estimatedLineCount(blockText(block), boxW, fontSize, indent);
    const lineHeight = (fontSize * profile.lineSpacingMultiple) / 72;
    const paragraphBreath = block.kind === 'subhead' ? 0.05 : 0.015;
    const groupSpace = block.kind === 'subhead' && idx > 0 ? profile.subheadSpaceBefore / 72 : 0;
    const paragraphSpace = block === blocks[blocks.length - 1] ? 0 : profile.paraSpaceAfter / 72;
    return sum + groupSpace + Math.max(0.24, lines * lineHeight) + paragraphSpace + paragraphBreath;
  }, 0);
  return Math.max(0.46, height + 0.02);
}

function estimateBlocksHeight(
  blocks: SlideBlock[],
  theme: SlideTheme,
  boxW: number,
  profile: BlockRenderProfile,
): number {
  let height = 0;
  let textRun: SlideBlock[] = [];
  const addGap = () => {
    if (height > 0) height += profile.gap;
  };
  const flush = () => {
    if (textRun.length === 0) return;
    addGap();
    height += estimateTextRunHeight(textRun, theme, boxW, profile);
    textRun = [];
  };

  for (const block of blocks) {
    if (block.kind === 'text' || block.kind === 'bullet' || block.kind === 'subhead') {
      textRun.push(block);
      continue;
    }
    flush();
    addGap();
    if (block.kind === 'code') height += Math.max(0.52, block.text.split('\n').length * 0.25 + 0.28);
    else if (block.kind === 'table') height += Math.max(0.45, block.rows.length * 0.38);
    else if (block.kind === 'image') height += 3.15;
  }
  flush();
  return height;
}

function isTextDominant(blocks: SlideBlock[]): boolean {
  return blocks.every((b) => b.kind === 'text' || b.kind === 'bullet' || b.kind === 'subhead');
}

function blockRenderProfile(blocks: SlideBlock[], theme: SlideTheme, box: { w: number; h: number }): BlockRenderProfile {
  const base = defaultBlockProfile(theme);
  const estimatedHeight = estimateBlocksHeight(blocks, theme, box.w, base);
  const usage = estimatedHeight / Math.max(1, box.h);
  const textBlockCount = blocks.filter((b) => b.kind === 'text' || b.kind === 'bullet' || b.kind === 'subhead').length;

  if (usage < 0.55 && textBlockCount > 0 && textBlockCount <= 10 && isTextDominant(blocks)) {
    const maxFont =
      textBlockCount <= 4
        ? Math.min(30, theme.typeScale.body + 12)
        : textBlockCount <= 7
          ? Math.min(26, theme.typeScale.body + 9)
          : Math.min(23, theme.typeScale.body + 6);
    const targetUsage = textBlockCount <= 4 ? 0.5 : textBlockCount <= 7 ? 0.56 : 0.62;
    let best = base;

    for (let bodyFontSize = theme.typeScale.body + 1; bodyFontSize <= maxFont; bodyFontSize += 1) {
      const growth = bodyFontSize - theme.typeScale.body;
      const candidate: BlockRenderProfile = {
        bodyFontSize,
        lineSpacingMultiple: clamp(1.14 + growth * 0.014, 1.16, 1.34),
        paraSpaceAfter: clamp(4 + growth * 1.35, 5, 18),
        subheadSpaceBefore: clamp(11 + growth * 1.25, 12, 20),
        gap: Math.min(0.34, theme.spacing.gap + growth * 0.012),
      };
      const candidateUsage = estimateBlocksHeight(blocks, theme, box.w, candidate) / Math.max(1, box.h);
      if (candidateUsage <= targetUsage || best === base) {
        best = candidate;
        continue;
      }
      break;
    }
    return best;
  }
  if (usage > 0.92) {
    return {
      bodyFontSize: clamp(theme.typeScale.body - 2, 12, theme.typeScale.body),
      lineSpacingMultiple: 1.04,
      paraSpaceAfter: 1,
      subheadSpaceBefore: 6,
      gap: Math.max(0.08, theme.spacing.gap - 0.04),
    };
  }
  if (usage > 0.72) {
    return {
      bodyFontSize: clamp(theme.typeScale.body - 1, 13, theme.typeScale.body),
      lineSpacingMultiple: 1.08,
      paraSpaceAfter: 2,
      subheadSpaceBefore: 8,
      gap: Math.max(0.1, theme.spacing.gap - 0.02),
    };
  }
  return base;
}

function addTitle(s: PptxSlide, slide: Slide, theme: SlideTheme, inverse = false) {
  addSectionTrail(s, slide, theme, inverse);
  const metrics = titleMetrics(slide, theme);
  s.addText(slide.title, {
    x: theme.spacing.marginX,
    y: metrics.y,
    w: PAGE_W - theme.spacing.marginX * 2,
    h: metrics.h,
    fontFace: fontFaceForTheme(slide.title, theme, 'heading'),
    fontSize: metrics.fontSize,
    bold: true,
    color: inverse ? theme.palette.inverseText : theme.palette.title,
    valign: 'middle',
    margin: 0,
    fit: 'shrink',
  });
}

async function renderTitleSlide(pptx: Pptx, slide: Slide, theme: SlideTheme, baseDir?: string) {
  const s = pptx.addSlide({ masterName: 'TITLE_SLIDE' });
  await addSlideBackgroundImage(s, slide, theme, baseDir);
  s.addText(slide.title || 'Untitled', {
    x: 0.8,
    y: 2.28,
    w: PAGE_W - 1.6,
    h: 1.35,
    fontFace: fontFaceForTheme(slide.title || 'Untitled', theme, 'heading'),
    fontSize: theme.typeScale.coverTitle,
    bold: true,
    color: theme.palette.inverseText,
    align: 'left',
    valign: 'bottom',
    margin: 0,
    fit: 'shrink',
  });
  const sub = flattenText(slide.body).slice(0, 180);
  if (sub) {
    s.addText(sub, {
      x: 0.82,
      y: 3.85,
      w: PAGE_W - 1.9,
      h: 0.74,
      fontFace: fontFaceForTheme(sub, theme),
      fontSize: 18,
      color: theme.palette.inverseText,
      transparency: 12,
      margin: 0,
      fit: 'shrink',
    });
  }
  if (slide.notes) s.addNotes(slide.notes);
}

async function renderSectionSlide(pptx: Pptx, slide: Slide, theme: SlideTheme, baseDir?: string) {
  const s = pptx.addSlide({ masterName: 'SECTION' });
  await addSlideBackgroundImage(s, slide, theme, baseDir);
  addSectionTrail(s, slide, theme, true);
  const level = headingLevelFor(slide);
  s.addText(slide.title || flattenText(slide.body) || 'Section', {
    x: 0.82,
    y: level <= 1 ? 2.62 : 2.72,
    w: PAGE_W - 1.64,
    h: 1.2,
    fontFace: fontFaceForTheme(slide.title || flattenText(slide.body) || 'Section', theme, 'heading'),
    fontSize: level <= 1 ? theme.typeScale.section : Math.max(28, theme.typeScale.section - 4),
    bold: true,
    color: theme.palette.inverseText,
    align: 'left',
    valign: 'middle',
    margin: 0,
    fit: 'shrink',
  });
  const sub = flattenText(slide.body).slice(0, 150);
  if (sub) {
    s.addText(sub, {
      x: 0.86,
      y: 4.0,
      w: PAGE_W - 2.4,
      h: 0.62,
      fontFace: fontFaceForTheme(sub, theme),
      fontSize: 16,
      color: theme.palette.inverseText,
      transparency: 10,
      margin: 0,
      fit: 'shrink',
    });
  }
  if (slide.notes) s.addNotes(slide.notes);
}

async function renderBlocks(
  s: PptxSlide,
  blocks: SlideBlock[],
  theme: SlideTheme,
  box: { x: number; y: number; w: number; h: number },
  baseDir?: string,
) {
  let y = box.y;
  const avail = () => box.y + box.h - y;
  const profile = blockRenderProfile(blocks, theme, box);
  let textRun: SlideBlock[] = [];

  const flushText = () => {
    if (textRun.length === 0) return;
    const rich: ReturnType<typeof spansToRich> = [];
    for (let idx = 0; idx < textRun.length; idx++) {
      const b = textRun[idx];
      if (b.kind === 'subhead') {
        rich.push(
          ...spansToRich([{ text: b.text, bold: true }], theme, {
            breakLine: true,
            fontSize: fontSizeForBlock(b, theme, profile),
            color: theme.palette.accent,
            lineSpacingMultiple: profile.lineSpacingMultiple,
            paraSpaceBefore: idx > 0 ? profile.subheadSpaceBefore : undefined,
            paraSpaceAfter: Math.max(profile.paraSpaceAfter + 1, 4),
          }),
        );
      } else if (b.kind === 'bullet') {
        rich.push(
          ...spansToRich(b.spans, theme, {
            bullet: true,
            indentLevel: b.indent,
            breakLine: true,
            fontSize: profile.bodyFontSize,
            color: theme.palette.body,
            lineSpacingMultiple: profile.lineSpacingMultiple,
            paraSpaceAfter: profile.paraSpaceAfter,
          }),
        );
      } else if (b.kind === 'text') {
        rich.push(
          ...spansToRich(b.spans, theme, {
            breakLine: true,
            fontSize: profile.bodyFontSize,
            color: theme.palette.body,
            lineSpacingMultiple: profile.lineSpacingMultiple,
            paraSpaceAfter: profile.paraSpaceAfter,
          }),
        );
      }
    }
    const runH = estimateTextRunHeight(textRun, theme, box.w, profile);
    const h = Math.min(avail(), Math.max(0.48, runH));
    s.addText(rich, {
      x: box.x,
      y,
      w: box.w,
      h,
      valign: 'top',
      align: 'left',
      lineSpacingMultiple: profile.lineSpacingMultiple,
      fit: 'shrink',
      margin: 0,
    });
    y += h + profile.gap;
    textRun = [];
  };

  for (const b of blocks) {
    if (b.kind === 'text' || b.kind === 'bullet' || b.kind === 'subhead') {
      textRun.push(b);
      continue;
    }
    flushText();
    if (avail() < 0.48) break;
    if (b.kind === 'code') {
      const h = Math.min(avail(), Math.max(0.52, b.text.split('\n').length * 0.25 + 0.28));
      s.addText(b.text, {
        x: box.x,
        y,
        w: box.w,
        h,
        fontFace: fontFaceForTheme(b.text, theme, 'mono'),
        fontSize: 11,
        color: theme.palette.codeFg,
        fill: { color: theme.palette.codeBg },
        align: 'left',
        valign: 'top',
        margin: 6,
        fit: 'shrink',
      });
      y += h + profile.gap;
    } else if (b.kind === 'table') {
      const rows = b.rows.map((r, ri) =>
        r.map((cell) => ({
          text: cell,
          options: {
            bold: ri === 0,
            color: ri === 0 ? theme.palette.inverseText : theme.palette.body,
            fill: { color: ri === 0 ? theme.palette.accent : theme.palette.surface },
            fontFace: fontFaceForTheme(cell, theme),
            fontSize: 12,
          },
        })),
      );
      const h = Math.min(avail(), Math.max(0.45, b.rows.length * 0.38));
      s.addTable(rows, {
        x: box.x,
        y,
        w: box.w,
        h,
        border: { type: 'solid', pt: 0.5, color: theme.palette.border },
        valign: 'middle',
      });
      y += h + profile.gap;
    } else if (b.kind === 'image') {
      const img = await resolveImage(b.src, baseDir);
      const h = Math.min(avail(), 3.15);
      if (img) {
        const { width: _width, height: _height, ...imgProps } = img;
        const fitted = fitImageBox(img, { x: box.x, y, w: box.w, h }, 'contain');
        s.addImage({ ...imgProps, ...fitted, altText: b.alt });
      } else {
        s.addText(`[이미지: ${b.alt || b.src}]`, {
          x: box.x,
          y,
          w: box.w,
          h: 0.45,
          fontFace: fontFaceForTheme(b.alt || b.src, theme),
          fontSize: theme.typeScale.caption,
          italic: true,
          color: theme.palette.muted,
          margin: 0,
        });
      }
      y += h + profile.gap;
    }
  }
  flushText();
}

async function renderContentSlide(pptx: Pptx, slide: Slide, theme: SlideTheme, baseDir?: string) {
  const s = pptx.addSlide({ masterName: 'CONTENT' });
  if (slide.title) addTitle(s, slide, theme);
  const bodyTop = bodyTopFor(slide, theme);
  const hasResolvedImage = Boolean(slideImageSrc(slide));
  const totalX = theme.spacing.marginX;
  const totalW = PAGE_W - theme.spacing.marginX * 2;
  const imageW = hasResolvedImage ? Math.min(4.25, totalW * 0.38) : 0;
  const imageGap = hasResolvedImage ? Math.max(0.34, theme.spacing.columnGap) : 0;
  const imageBox = {
    x: totalX + totalW - imageW,
    y: bodyTop,
    w: imageW,
    h: theme.spacing.bodyBottom - bodyTop,
  };
  const imageAdded = hasResolvedImage ? await addSlideImage(s, slide, baseDir, imageBox, 'contain') : false;
  await renderBlocks(
    s,
    slide.body,
    theme,
    {
      x: totalX,
      y: bodyTop,
      w: imageAdded ? Math.max(3.8, totalW - imageW - imageGap) : totalW,
      h: theme.spacing.bodyBottom - bodyTop,
    },
    baseDir,
  );
  if (slide.notes) s.addNotes(slide.notes);
}

async function renderTwoColumnSlide(pptx: Pptx, slide: Slide, theme: SlideTheme, baseDir?: string) {
  const s = pptx.addSlide({ masterName: 'CONTENT' });
  if (slide.title) addTitle(s, slide, theme);
  const x = theme.spacing.marginX;
  const y = bodyTopFor(slide, theme);
  const w = PAGE_W - x * 2;
  const columns = slide.columns?.length ? slide.columns : [slide.body.slice(0, Math.ceil(slide.body.length / 2)), slide.body.slice(Math.ceil(slide.body.length / 2))];
  const cardPadX = 0.22;
  const cardPadY = 0.18;
  const cardY = y - 0.06;
  const maxCardH = Math.max(1.52, theme.spacing.bodyBottom - cardY);
  const hasResolvedImage = Boolean(slideImageSrc(slide));
  const imageW = hasResolvedImage ? Math.min(3.05, w * 0.28) : 0;
  const imageGap = hasResolvedImage ? Math.max(0.34, theme.spacing.columnGap) : 0;
  const imageBox = {
    x: x + w - imageW,
    y: cardY,
    w: imageW,
    h: maxCardH,
  };
  const imageAdded = hasResolvedImage ? await addSlideImagePanel(s, slide, theme, baseDir, imageBox, 'contain') : false;
  const contentW = imageAdded ? w - imageW - imageGap : w;
  const gap = Math.max(0.34, theme.spacing.columnGap);
  const colW = (contentW - gap) / 2;
  const innerW = colW - cardPadX * 1.55;
  const maxInnerH = Math.max(0.9, maxCardH - cardPadY * 2);
  const leftProfile = blockRenderProfile(columns[0] ?? [], theme, { w: innerW, h: maxInnerH });
  const rightProfile = blockRenderProfile(columns[1] ?? [], theme, { w: innerW, h: maxInnerH });
  const leftH = estimateBlocksHeight(columns[0] ?? [], theme, innerW, leftProfile);
  const rightH = estimateBlocksHeight(columns[1] ?? [], theme, innerW, rightProfile);
  const cardH = Math.min(maxCardH, Math.max(1.72, leftH, rightH) + cardPadY * 2 + 0.16);
  const cardBoxes = [
    { x, accent: theme.palette.accent },
    { x: x + colW + gap, accent: theme.palette.accent2 },
  ];

  for (const box of cardBoxes) {
    s.addShape(RECT_SHAPE, {
      x: box.x,
      y: cardY,
      w: colW,
      h: cardH,
      fill: { color: theme.palette.surface, transparency: 0 },
      line: { color: theme.palette.border, width: 0.7 },
    });
    s.addShape(RECT_SHAPE, {
      x: box.x,
      y: cardY,
      w: 0.06,
      h: cardH,
      fill: { color: box.accent, transparency: 0 },
      line: { color: box.accent, transparency: 100 },
    });
  }

  await renderBlocks(s, columns[0] ?? [], theme, { x: x + cardPadX, y: y + cardPadY, w: innerW, h: cardH - cardPadY * 2 }, baseDir);
  await renderBlocks(s, columns[1] ?? [], theme, { x: x + colW + gap + cardPadX, y: y + cardPadY, w: innerW, h: cardH - cardPadY * 2 }, baseDir);
  if (slide.notes) s.addNotes(slide.notes);
}

async function renderQuoteSlide(pptx: Pptx, slide: Slide, theme: SlideTheme, baseDir?: string) {
  const s = pptx.addSlide({ masterName: 'CONTENT' });
  addSectionTrail(s, slide, theme);
  const quote = slide.quote?.text || flattenText(slide.body) || slide.title;
  const hasResolvedImage = Boolean(slideImageSrc(slide));
  const imageW = hasResolvedImage ? 3.75 : 0;
  const imageBox = {
    x: PAGE_W - theme.spacing.marginX - imageW,
    y: 1.16,
    w: imageW,
    h: 4.52,
  };
  const imageAdded = hasResolvedImage ? await addSlideImagePanel(s, slide, theme, baseDir, imageBox, 'contain') : false;
  const quoteX = theme.spacing.marginX + 0.55;
  const quoteW = imageAdded
    ? Math.max(5.4, imageBox.x - quoteX - Math.max(0.42, theme.spacing.columnGap))
    : PAGE_W - theme.spacing.marginX * 2 - 0.7;
  s.addText('“', {
    x: theme.spacing.marginX,
    y: 1.08,
    w: 1.0,
    h: 0.8,
    fontFace: fontFaceForTheme('“', theme, 'heading'),
    fontSize: 54,
    color: theme.palette.accent,
    margin: 0,
  });
  s.addText(quote, {
    x: quoteX,
    y: 1.75,
    w: quoteW,
    h: 2.2,
    fontFace: fontFaceForTheme(quote, theme, 'heading'),
    fontSize: 28,
    bold: true,
    color: theme.palette.title,
    margin: 0,
    fit: 'shrink',
  });
  const attribution = slide.quote?.attribution || slide.title;
  if (attribution) {
    s.addText(attribution, {
      x: quoteX + 0.05,
      y: 4.24,
      w: quoteW,
      h: 0.45,
      fontFace: fontFaceForTheme(attribution, theme),
      fontSize: theme.typeScale.body,
      color: theme.palette.muted,
      margin: 0,
    });
  }
  if (slide.notes) s.addNotes(slide.notes);
}

async function renderStatSlide(pptx: Pptx, slide: Slide, theme: SlideTheme, baseDir?: string) {
  const s = pptx.addSlide({ masterName: 'CONTENT' });
  if (slide.title) addTitle(s, slide, theme);
  const stat = slide.stat;
  const hasResolvedImage = Boolean(slideImageSrc(slide));
  const imageW = hasResolvedImage ? 3.55 : 0;
  const imageBox = {
    x: PAGE_W - theme.spacing.marginX - imageW,
    y: bodyTopFor(slide, theme),
    w: imageW,
    h: theme.spacing.bodyBottom - bodyTopFor(slide, theme),
  };
  const imageAdded = hasResolvedImage ? await addSlideImagePanel(s, slide, theme, baseDir, imageBox, 'contain') : false;
  const textX = theme.spacing.marginX;
  const textW = imageAdded
    ? Math.max(5.5, imageBox.x - textX - Math.max(0.46, theme.spacing.columnGap))
    : PAGE_W - theme.spacing.marginX * 2;
  s.addText(stat?.value || 'Key point', {
    x: textX,
    y: 2.05,
    w: textW,
    h: 1.25,
    fontFace: fontFaceForTheme(stat?.value || 'Key point', theme, 'heading'),
    fontSize: theme.typeScale.stat,
    bold: true,
    color: theme.palette.accent,
    margin: 0,
    fit: 'shrink',
  });
  const statLabel = stat?.label || flattenText(slide.body).slice(0, 140);
  s.addText(statLabel, {
    x: textX + 0.05,
    y: 3.45,
    w: textW,
    h: 0.75,
    fontFace: fontFaceForTheme(statLabel, theme),
    fontSize: 20,
    bold: true,
    color: theme.palette.title,
    margin: 0,
    fit: 'shrink',
  });
  if (stat?.context) {
    s.addText(stat.context, {
      x: textX + 0.05,
      y: 4.35,
      w: Math.max(3.8, textW - 1.4),
      h: 0.8,
      fontFace: fontFaceForTheme(stat.context, theme),
      fontSize: theme.typeScale.body,
      color: theme.palette.body,
      margin: 0,
      fit: 'shrink',
    });
  }
  if (slide.notes) s.addNotes(slide.notes);
}

async function renderImageFocusSlide(pptx: Pptx, slide: Slide, theme: SlideTheme, baseDir?: string) {
  const s = pptx.addSlide({ masterName: 'CONTENT' });
  const src = slide.image?.src || slide.body.find((b): b is Extract<SlideBlock, { kind: 'image' }> => b.kind === 'image')?.src;
  const img = src ? await resolveImage(src, baseDir) : null;
  if (img) {
    const { width: _width, height: _height, ...imgProps } = img;
    const fitted = fitImageBox(img, { x: 0, y: 0, w: PAGE_W, h: PAGE_H }, 'cover');
    s.addImage({ ...imgProps, ...fitted, altText: slide.image?.alt });
    s.addShape(RECT_SHAPE, { x: 0, y: 0, w: PAGE_W * 0.45, h: PAGE_H, fill: { color: theme.palette.title, transparency: 10 }, line: { color: theme.palette.title, transparency: 100 } });
    s.addText(slide.title, {
      x: 0.72,
      y: 1.0,
      w: PAGE_W * 0.36,
      h: 1.3,
      fontFace: fontFaceForTheme(slide.title, theme, 'heading'),
      fontSize: titleMetrics(slide, theme).fontSize,
      bold: true,
      color: theme.palette.inverseText,
      margin: 0,
      fit: 'shrink',
    });
    const body = flattenText(slide.body.filter((b) => b.kind !== 'image')).slice(0, 210);
    if (body) {
      s.addText(body, {
        x: 0.74,
        y: 2.55,
        w: PAGE_W * 0.34,
        h: 2.0,
        fontFace: fontFaceForTheme(body, theme),
        fontSize: theme.typeScale.body,
        color: theme.palette.inverseText,
        margin: 0,
        fit: 'shrink',
      });
    }
  } else {
    if (slide.title) addTitle(s, slide, theme);
    const bodyTop = bodyTopFor(slide, theme);
    await renderBlocks(s, slide.body, theme, { x: theme.spacing.marginX, y: bodyTop, w: PAGE_W - theme.spacing.marginX * 2, h: theme.spacing.bodyBottom - bodyTop }, baseDir);
  }
  if (slide.notes) s.addNotes(slide.notes);
}

export async function buildPptx(
  slides: Slide[],
  opts?: { title?: string; baseDir?: string; theme?: SlideTheme; masterSpec?: SlideMasterSpec },
): Promise<ArrayBuffer> {
  const theme = opts?.theme ?? DEFAULT_SLIDE_THEME;
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'MM_16x9', width: PAGE_W, height: PAGE_H });
  pptx.layout = 'MM_16x9';
  pptx.author = 'MarkMind';
  if (opts?.title) pptx.title = opts.title;
  defineMasters(pptx, theme, opts?.masterSpec);

  for (const slide of slides) {
    if (slide.layout === 'title') await renderTitleSlide(pptx, slide, theme, opts?.baseDir);
    else if (slide.layout === 'section') await renderSectionSlide(pptx, slide, theme, opts?.baseDir);
    else if (slide.layout === 'two-column' || slide.layout === 'comparison') await renderTwoColumnSlide(pptx, slide, theme, opts?.baseDir);
    else if (slide.layout === 'quote') await renderQuoteSlide(pptx, slide, theme, opts?.baseDir);
    else if (slide.layout === 'stat') await renderStatSlide(pptx, slide, theme, opts?.baseDir);
    else if (slide.layout === 'image-focus') await renderImageFocusSlide(pptx, slide, theme, opts?.baseDir);
    else await renderContentSlide(pptx, slide, theme, opts?.baseDir);
  }

  return (await pptx.write({ outputType: 'arraybuffer' })) as ArrayBuffer;
}
