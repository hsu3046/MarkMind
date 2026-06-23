import type { InlineSpan, Slide, SlideBlock } from './markdownToSlides';
import { DEFAULT_HTML_SLIDE_THEME, type HtmlSlideTheme } from './htmlSlideTheme';

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
};

export interface BuildHtmlSlidesOptions {
  title?: string;
  baseDir?: string;
  theme?: HtmlSlideTheme;
  fontFamily?: string;
  transition?: string;
  editable?: boolean;
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const attr = escapeHtml;

function cssFontName(value?: string): string | null {
  const cleaned = value
    ?.trim()
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[<>;{}]/g, '');
  if (!cleaned || cleaned.length > 96) return null;
  return `"${cleaned.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function fontStack(baseStack: string, selectedFont?: string): string {
  const selected = cssFontName(selectedFont);
  return selected ? `${selected}, ${baseStack}` : baseStack;
}

function transitionCss(transition?: string): string {
  const effect = transition?.trim().toLowerCase() || 'default';
  if (effect === 'cross-fade') {
    return `/* === SLIDE TRANSITION: cross-fade === */
.slide { transition: opacity 520ms ease; }
.slide:not(.active) { transform: none; }`;
  }
  if (effect === 'slide') {
    return `/* === SLIDE TRANSITION: slide === */
.slide { transition: opacity 460ms ease, transform 520ms var(--ease-out-expo); }
.slide:not(.active) { transform: translateX(110px); }`;
  }
  if (effect === 'zoom') {
    return `/* === SLIDE TRANSITION: zoom === */
.slide { transform-origin: center center; transition: opacity 520ms ease, transform 560ms var(--ease-out-expo); }
.slide:not(.active) { transform: scale(.965); }`;
  }
  if (effect === 'none') {
    return `/* === SLIDE TRANSITION: none === */
.slide { transition: none; }
.slide:not(.active) { transform: none; }`;
  }
  return `/* === SLIDE TRANSITION: default === */
.slide { transition: opacity 420ms ease, transform 420ms var(--ease-out-expo); }
.slide:not(.active) { transform: translateX(32px); }`;
}

const escapeJsonScript = (value: unknown): string =>
  JSON.stringify(value)
    .replace(/</g, '\\u003C')
    .replace(/>/g, '\\u003E')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

function ext(src: string): string {
  return src.split(/[?#]/)[0]?.split('.').pop()?.toLowerCase() ?? '';
}

async function resolveImageSrc(src: string, baseDir?: string): Promise<string> {
  if (!src || src.startsWith('data:') || /^https?:\/\//i.test(src)) return src;
  try {
    const { readFile } = await import('@tauri-apps/plugin-fs');
    let path = src.replace(/^asset:\/\/(localhost\/)?/i, '');
    path = decodeURIComponent(path);
    if (!path.startsWith('/') && baseDir) path = `${baseDir.replace(/\/$/, '')}/${path}`;
    const bytes = await readFile(path);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return `data:${MIME[ext(path)] ?? 'image/png'};base64,${btoa(binary)}`;
  } catch (err) {
    console.warn('[buildHtmlSlides] 이미지 로드 실패, 원본 경로를 유지합니다:', src, err);
    return src;
  }
}

function textFromSpans(spans: InlineSpan[]): string {
  return spans.map((span) => span.text).join('');
}

function blockText(block: SlideBlock): string {
  if (block.kind === 'bullet' || block.kind === 'text') return textFromSpans(block.spans);
  if (block.kind === 'subhead' || block.kind === 'code') return block.text;
  if (block.kind === 'image') return block.alt || '';
  if (block.kind === 'table') return block.rows.flat().join(' ');
  return '';
}

function contentBlocks(slide: Slide): SlideBlock[] {
  return slide.body.filter((block) => block.kind !== 'image');
}

function shortBlockLabel(block: SlideBlock, fallback: string): string {
  return (blockText(block) || fallback).replace(/\s+/g, ' ').trim().slice(0, 74);
}

function flattenSlideText(slide: Slide): string {
  return [
    slide.title,
    slide.quote?.text,
    slide.stat ? [slide.stat.value, slide.stat.label, slide.stat.context].filter(Boolean).join(' ') : '',
    ...slide.body.map(blockText),
    ...(slide.columns?.flat().map(blockText) ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function renderInline(spans: InlineSpan[]): string {
  return spans
    .map((span) => {
      let text = escapeHtml(span.text);
      if (span.code) text = `<code>${text}</code>`;
      if (span.bold) text = `<strong>${text}</strong>`;
      if (span.italic) text = `<em>${text}</em>`;
      return text;
    })
    .join('');
}

function renderBlocks(blocks: SlideBlock[]): string {
  const out: string[] = [];
  let bullets: string[] = [];
  const flushBullets = () => {
    if (bullets.length === 0) return;
    out.push(`<ul class="mm-bullets">${bullets.join('')}</ul>`);
    bullets = [];
  };

  for (const block of blocks) {
    if (block.kind === 'bullet') {
      bullets.push(`<li class="editable">${renderInline(block.spans)}</li>`);
      continue;
    }
    flushBullets();
    if (block.kind === 'text') {
      out.push(`<p class="mm-text editable">${renderInline(block.spans)}</p>`);
    } else if (block.kind === 'subhead') {
      out.push(`<h3 class="mm-subhead editable">${escapeHtml(block.text)}</h3>`);
    } else if (block.kind === 'code') {
      out.push(`<pre class="mm-code"><code>${escapeHtml(block.text)}</code></pre>`);
    } else if (block.kind === 'table') {
      out.push(renderTable(block.rows));
    } else if (block.kind === 'image') {
      out.push(`<figure class="mm-inline-image"><img src="${attr(block.src)}" alt="${attr(block.alt ?? '')}"></figure>`);
    }
  }
  flushBullets();
  return out.join('\n');
}

function renderTable(rows: string[][]): string {
  if (rows.length === 0) return '';
  const head = rows[0];
  const body = rows.slice(1);
  return [
    '<table class="mm-table">',
    '<thead><tr>',
    head.map((cell) => `<th class="editable">${escapeHtml(cell)}</th>`).join(''),
    '</tr></thead>',
    '<tbody>',
    body
      .map((row) => `<tr>${row.map((cell) => `<td class="editable">${escapeHtml(cell)}</td>`).join('')}</tr>`)
      .join(''),
    '</tbody></table>',
  ].join('');
}

function splitBlocks(slide: Slide): SlideBlock[][] {
  if (slide.columns?.length) return slide.columns.slice(0, 3);
  const midpoint = Math.ceil(slide.body.length / 2);
  return [slide.body.slice(0, midpoint), slide.body.slice(midpoint)].filter((column) => column.length > 0);
}

function lastValue(values?: string[]): string | undefined {
  return values && values.length > 0 ? values[values.length - 1] : undefined;
}

async function slideImage(slide: Slide, baseDir?: string): Promise<{ src: string; alt: string } | null> {
  const src = slide.image?.src || slide.body.find((block) => block.kind === 'image')?.src;
  if (!src) return null;
  return { src: await resolveImageSrc(src, baseDir), alt: slide.image?.alt || slide.title || 'slide image' };
}

function hasRenderableImage(slide: Slide): boolean {
  return Boolean(slide.image?.src?.trim() || slide.body.some((block) => block.kind === 'image' && block.src.trim()));
}

async function resolveBlockImages(blocks: SlideBlock[] | undefined, baseDir?: string): Promise<SlideBlock[] | undefined> {
  if (!blocks) return blocks;
  return Promise.all(
    blocks.map(async (block) => {
      if (block.kind !== 'image') return block;
      return { ...block, src: await resolveImageSrc(block.src, baseDir) };
    }),
  );
}

async function resolveSlideImages(slide: Slide, baseDir?: string): Promise<Slide> {
  const [body, columns, imageSrc] = await Promise.all([
    resolveBlockImages(slide.body, baseDir),
    slide.columns
      ? Promise.all(slide.columns.map((column) => resolveBlockImages(column, baseDir) as Promise<SlideBlock[]>))
      : undefined,
    slide.image?.src ? resolveImageSrc(slide.image.src, baseDir) : undefined,
  ]);
  return {
    ...slide,
    body: body ?? slide.body,
    columns,
    image: slide.image && imageSrc ? { ...slide.image, src: imageSrc } : slide.image,
  };
}

function slideLabel(slide: Slide, index: number): string {
  return (slide.title || lastValue(slide.sectionPath) || `Slide ${index + 1}`).slice(0, 64);
}

function surfaceClass(theme: HtmlSlideTheme, index: number, layout: Slide['layout']): string {
  if (theme.renderer !== 'signal') return '';
  if (layout === 'title' || layout === 'section' || layout === 'quote') return ' surface-dark';
  return index % 2 === 0 ? ' surface-light' : ' surface-dark';
}

function pageTag(index: number, total: number): string {
  return `${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
}

function slideTextWeight(slide: Slide): number {
  const blockWeight = [...slide.body, ...(slide.columns?.flat() ?? [])].reduce((sum, block) => {
    if (block.kind === 'table') return sum + block.rows.flat().join(' ').length + block.rows.length * 42;
    if (block.kind === 'code') return sum + block.text.length * 0.8;
    return sum + blockText(block).length;
  }, 0);
  return blockWeight + (slide.title?.length ?? 0) * 1.4;
}

function slideDensityClass(slide: Slide): string {
  const blocks = contentBlocks(slide).length + (slide.columns?.flat().length ?? 0);
  const weight = slideTextWeight(slide);
  if (weight > 720 || blocks > 8) return 'slide-density-high';
  if (weight < 220 && blocks <= 3) return 'slide-density-low';
  return 'slide-density-balanced';
}

function visualPriorityClass(slide: Slide, index: number, total: number): string {
  const importance = slide.importance ?? 0;
  if (index === 0 || index === total - 1 || importance >= 80 || slide.layout === 'title' || slide.layout === 'section') {
    return 'visual-priority-high';
  }
  if (importance >= 55 || slide.layout === 'quote' || slide.layout === 'stat' || slide.layout === 'image-focus') {
    return 'visual-priority-medium';
  }
  return 'visual-priority-standard';
}

function imageArtClasses(slide: Slide, index: number, theme: HtmlSlideTheme): string {
  if (!hasRenderableImage(slide)) return '';
  const treatment =
    theme.renderer === 'signal'
      ? 'image-treatment-muted'
      : theme.renderer === 'grid'
        ? 'image-treatment-poster'
        : index % 3 === 0
          ? 'image-treatment-duotone'
          : 'image-treatment-natural';
  const crop = ['image-crop-center', 'image-crop-left', 'image-crop-right', 'image-crop-top'][index % 4];
  return `${treatment} ${crop}`;
}

function decorateSlideHtml(html: string, slide: Slide, index: number, total: number, theme: HtmlSlideTheme): string {
  const classes = [
    slideDensityClass(slide),
    visualPriorityClass(slide, index, total),
    imageArtClasses(slide, index, theme),
  ]
    .filter(Boolean)
    .join(' ');
  return html.replace('<section class="', `<section class="${classes} `);
}

function variantPrefix(theme: HtmlSlideTheme): 'blue.' | 'neo.' | 'signal.' {
  return theme.renderer === 'professional' ? 'blue.' : theme.renderer === 'grid' ? 'neo.' : 'signal.';
}

function directorVariant(slide: Slide, index: number, total: number, theme: HtmlSlideTheme): string | undefined {
  const raw = slide.htmlVariant?.trim().toLowerCase();
  const prefix = variantPrefix(theme);
  if (raw?.startsWith(prefix)) return raw;

  const hasImage = hasRenderableImage(slide);
  const isTextSlide = !hasImage && !['title', 'section', 'quote', 'stat', 'image-focus'].includes(slide.layout);
  const isHigh = (slide.importance ?? 0) >= 78;
  const isClosing = total >= 4 && index === total - 1;

  if (theme.renderer === 'professional') {
    if (hasImage && isHigh && !['title', 'quote', 'stat', 'image-focus'].includes(slide.layout)) {
      return index % 2 === 0 ? 'blue.editorial-photo' : 'blue.photo-band';
    }
    if (isClosing) return 'blue.closing-circles';
    if (isTextSlide && isHigh) return 'blue.tension-resolution';
    if (isTextSlide && slideTextWeight(slide) > 520) return 'blue.agenda-grid';
    if (isTextSlide && index % 4 === 2) return 'blue.tension-resolution';
  } else if (theme.renderer === 'grid') {
    if (hasImage && !['title', 'quote', 'stat', 'image-focus'].includes(slide.layout)) {
      return index % 2 === 0 ? 'neo.image-billboard' : 'neo.photo-strip';
    }
    if (isClosing || (isTextSlide && isHigh)) return 'neo.manifesto-grid';
    if (isTextSlide && (slideTextWeight(slide) > 480 || slide.body.length >= 4 || slide.columns?.length)) return 'neo.poster-grid-6';
  } else {
    if (hasImage && !['title', 'quote', 'stat', 'image-focus'].includes(slide.layout)) {
      return index % 2 === 0 ? 'signal.photo-essay' : 'signal.image-dossier';
    }
    if (isClosing || (isTextSlide && isHigh && contentBlocks(slide).length <= 3)) return 'signal.statement';
    if (isTextSlide && (slideTextWeight(slide) > 520 || slide.body.length >= 4)) return 'signal.evidence-ledger';
  }
  return undefined;
}

function isSpecialRenderedLayout(slide: Slide): boolean {
  return ['title', 'section', 'quote', 'stat', 'image-focus'].includes(slide.layout);
}

function variantCandidates(slide: Slide, index: number, total: number, theme: HtmlSlideTheme): string[] {
  if (isSpecialRenderedLayout(slide)) return [];
  const hasImage = hasRenderableImage(slide);
  const isClosing = total >= 4 && index === total - 1;
  const isHigh = (slide.importance ?? 0) >= 78;
  const hasColumns = slide.layout === 'comparison' || Boolean(slide.columns?.length);
  const blocks = contentBlocks(slide).length + (slide.columns?.flat().length ?? 0);
  const heavy = slideTextWeight(slide) > 520 || blocks >= 5;

  if (theme.renderer === 'professional') {
    if (hasImage) return ['blue.editorial-photo', 'blue.photo-band'];
    if (isClosing) return ['blue.closing-circles', 'blue.tension-resolution', 'blue.split-highlight'];
    if (slide.layout === 'timeline') return ['blue.timeline-steps', 'blue.tension-resolution', 'blue.metric-row'];
    if (heavy) return ['blue.agenda-grid', 'blue.metric-row', 'blue.bar-insight', 'blue.tension-resolution', 'blue.split-highlight'];
    if (isHigh) return ['blue.tension-resolution', 'blue.metric-row', 'blue.split-highlight', 'blue.bar-insight'];
    return ['blue.split-highlight', 'blue.tension-resolution', 'blue.metric-row', 'blue.bar-insight'];
  }

  if (theme.renderer === 'grid') {
    if (hasImage) return ['neo.image-billboard', 'neo.photo-strip'];
    if (isClosing || isHigh) return ['neo.manifesto-grid', 'neo.stat-wall', 'neo.poster-grid-6'];
    if (slide.layout === 'timeline') return ['neo.process-arrows', 'neo.manifesto-grid', 'neo.poster-grid-6'];
    if (hasColumns) return ['neo.matrix-table', 'neo.poster-grid-6', 'neo.manifesto-grid'];
    return ['neo.poster-grid-6', 'neo.stat-wall', 'neo.manifesto-grid', 'neo.process-arrows'];
  }

  if (hasImage) return ['signal.photo-essay', 'signal.image-dossier'];
  if (isClosing || (isHigh && blocks <= 3)) return ['signal.statement', 'signal.editorial-split', 'signal.evidence-ledger'];
  if (hasColumns) return ['signal.compare-hairline', 'signal.editorial-columns', 'signal.briefing-cards'];
  if (heavy) return ['signal.evidence-ledger', 'signal.briefing-cards', 'signal.editorial-columns', 'signal.editorial-split'];
  return ['signal.editorial-split', 'signal.statement', 'signal.briefing-cards'];
}

function directHtmlSlides(slides: Slide[], theme: HtmlSlideTheme): Slide[] {
  const usage = new Map<string, number>();
  const recent: string[] = [];
  return slides.map((slide, index) => {
    let variant = directorVariant(slide, index, slides.length, theme);
    const candidates = variantCandidates(slide, index, slides.length, theme);
    if (candidates.length > 0) {
      const repeated = variant ? recent[recent.length - 1] === variant : false;
      const overused = variant ? (usage.get(variant) ?? 0) >= Math.max(2, Math.ceil((index + 1) / Math.max(3, candidates.length))) : false;
      if (!variant || repeated || overused) {
        variant =
          candidates.find((candidate) => candidate !== recent[recent.length - 1] && candidate !== recent[recent.length - 2]) ??
          candidates.find((candidate) => candidate !== recent[recent.length - 1]) ??
          candidates[0];
      }
    }
    if (variant) {
      usage.set(variant, (usage.get(variant) ?? 0) + 1);
      recent.push(variant);
    } else {
      recent.push(slide.layout);
    }
    if (recent.length > 4) recent.shift();
    return variant && variant !== slide.htmlVariant ? { ...slide, htmlVariant: variant } : slide;
  });
}

function variantForSlide(slide: Slide, index: number, theme: HtmlSlideTheme): string {
  const raw = slide.htmlVariant?.trim().toLowerCase();
  const prefix = theme.renderer === 'professional' ? 'blue.' : theme.renderer === 'grid' ? 'neo.' : 'signal.';
  if (raw?.startsWith(prefix)) return raw;
  const hasImage = hasRenderableImage(slide);

  if (theme.renderer === 'professional') {
    if (slide.layout === 'timeline') return 'blue.timeline-steps';
    if (slide.layout === 'section') return 'blue.split-highlight';
    if (hasImage && !['title', 'quote', 'stat', 'image-focus'].includes(slide.layout)) {
      return index % 2 === 0 ? 'blue.editorial-photo' : 'blue.photo-band';
    }
    if (!hasImage && slide.body.length >= 4 && index % 5 === 3) return 'blue.metric-row';
    if (!hasImage && slide.body.length >= 3 && index % 6 === 4) return 'blue.bar-insight';
    if (!hasImage && slide.body.length >= 5) return 'blue.agenda-grid';
    if (!hasImage && index % 4 === 2) return 'blue.tension-resolution';
  } else if (theme.renderer === 'grid') {
    if (slide.layout === 'section') return 'neo.section-ordinal';
    if (hasImage && !['title', 'quote', 'stat', 'image-focus'].includes(slide.layout) && index % 2 === 0) return 'neo.image-billboard';
    if (hasImage && index % 2 === 1) return 'neo.photo-strip';
    if (!hasImage && slide.layout === 'timeline') return 'neo.process-arrows';
    if (!hasImage && (slide.layout === 'comparison' || slide.columns?.length)) return 'neo.matrix-table';
    if (slide.body.length >= 4 || slide.columns?.length) return 'neo.poster-grid-6';
  } else {
    if (slide.layout === 'timeline') return 'signal.timeline-spine';
    if (hasImage && !['title', 'quote', 'stat', 'image-focus'].includes(slide.layout)) {
      return index % 2 === 0 ? 'signal.photo-essay' : 'signal.image-dossier';
    }
    if (!hasImage && slide.body.length <= 2 && index % 5 === 3) return 'signal.statement';
    if (!hasImage && (slide.layout === 'comparison' || slide.columns?.length)) return 'signal.compare-hairline';
    if (!hasImage && slide.body.length >= 6) return 'signal.evidence-ledger';
    if (!hasImage && slide.body.length >= 5 && index % 3 === 1) return 'signal.editorial-columns';
    if (!hasImage && (slide.body.length >= 4 || slide.columns?.length)) return 'signal.briefing-cards';
    if (index % 4 === 2) return 'signal.editorial-split';
  }
  return '';
}

function blockCardHtml(block: SlideBlock, index: number): string {
  const label = String(index + 1).padStart(2, '0');
  if (block.kind === 'subhead') {
    return `<span class="card-num">${label}</span><h3 class="editable">${escapeHtml(block.text)}</h3>`;
  }
  return `<span class="card-num">${label}</span>${renderBlocks([block])}`;
}

function renderProfessionalAgendaGrid(slide: Slide, index: number, total: number, tag: string): string {
  const blocks = slide.body.filter((block) => block.kind !== 'image').slice(0, 6);
  return `<section class="slide professional agenda-slide" data-label="${attr(slideLabel(slide, index))}">
    <div class="slide-header"><span class="eyebrow">${pageTag(index, total)}</span><span class="tag-pill">${tag}</span></div>
    <h2 class="slide-title reveal editable">${escapeHtml(slide.title || 'Untitled')}</h2>
    <div class="agenda-grid">
      ${blocks.map((block, i) => `<div class="agenda-card reveal">${blockCardHtml(block, i)}</div>`).join('')}
    </div>
    <div class="progress-rule" style="width:${((index + 1) / total) * 100}%"></div>
  </section>`;
}

function renderProfessionalSplitHighlight(slide: Slide, index: number, total: number, tag: string): string {
  const blocks = slide.body.filter((block) => block.kind !== 'image');
  const [first, ...rest] = blocks;
  const highlight = first ? renderBlocks([first]) : `<p class="mm-text editable">${escapeHtml(flattenSlideText(slide).slice(0, 220))}</p>`;
  return `<section class="slide professional split-highlight-slide" data-label="${attr(slideLabel(slide, index))}">
    <div class="slide-header"><span class="eyebrow">${pageTag(index, total)}</span><span class="tag-pill">${tag}</span></div>
    <div class="split-highlight-layout">
      <div>
        <h2 class="slide-title reveal editable">${escapeHtml(slide.title || 'Untitled')}</h2>
        <div class="split-highlight-block reveal">${highlight}</div>
      </div>
      <div class="detail-stack">
        ${rest.slice(0, 4).map((block, i) => `<div class="detail-card reveal">${blockCardHtml(block, i)}</div>`).join('')}
      </div>
    </div>
    <div class="progress-rule" style="width:${((index + 1) / total) * 100}%"></div>
  </section>`;
}

function renderProfessionalTimelineSteps(slide: Slide, index: number, total: number, tag: string): string {
  const blocks = slide.body.filter((block) => block.kind !== 'image').slice(0, 4);
  return `<section class="slide professional steps-slide" data-label="${attr(slideLabel(slide, index))}">
    <div class="slide-header"><span class="eyebrow">${pageTag(index, total)}</span><span class="tag-pill">${tag}</span></div>
    <h2 class="slide-title reveal editable">${escapeHtml(slide.title || 'Untitled')}</h2>
    <div class="step-row">
      ${blocks.map((block, i) => `<div class="step-card reveal" style="--step-opacity:${Math.max(0.55, 1 - i * 0.14)}"><span class="step-circle">${String(i + 1).padStart(2, '0')}</span>${renderBlocks([block])}</div>`).join('')}
    </div>
    <div class="progress-rule" style="width:${((index + 1) / total) * 100}%"></div>
  </section>`;
}

function renderProfessionalMetricRow(slide: Slide, index: number, total: number, tag: string): string {
  const blocks = contentBlocks(slide).slice(0, 4);
  return `<section class="slide professional metric-row-slide" data-label="${attr(slideLabel(slide, index))}">
    <div class="slide-header"><span class="eyebrow">${pageTag(index, total)}</span><span class="tag-pill">${tag}</span></div>
    <h2 class="slide-title reveal editable">${escapeHtml(slide.title || 'Untitled')}</h2>
    <div class="metric-row">
      ${blocks
        .map(
          (block, i) => `<div class="metric-card reveal ${i === 0 ? 'feature' : ''}">
            <span class="metric-index">${String(i + 1).padStart(2, '0')}</span>
            ${renderBlocks([block])}
          </div>`,
        )
        .join('')}
    </div>
    <div class="progress-rule" style="width:${((index + 1) / total) * 100}%"></div>
  </section>`;
}

function renderProfessionalBarInsight(slide: Slide, index: number, total: number, tag: string): string {
  const blocks = contentBlocks(slide).slice(0, 5);
  return `<section class="slide professional bar-insight-slide" data-label="${attr(slideLabel(slide, index))}">
    <div class="slide-header"><span class="eyebrow">${pageTag(index, total)}</span><span class="tag-pill">${tag}</span></div>
    <div class="bar-insight-layout">
      <div>
        <h2 class="slide-title reveal editable">${escapeHtml(slide.title || 'Untitled')}</h2>
        <p class="bar-insight-lead editable">${escapeHtml(flattenSlideText(slide).replace(slide.title, '').trim().slice(0, 180))}</p>
      </div>
      <div class="bar-stack">
        ${blocks
          .map((block, i) => {
            const width = Math.max(38, 96 - i * 12);
            return `<div class="bar-row reveal">
              <span class="bar-label editable">${escapeHtml(shortBlockLabel(block, `Point ${i + 1}`))}</span>
              <span class="bar-track"><i style="width:${width}%"></i></span>
            </div>`;
          })
          .join('')}
      </div>
    </div>
    <div class="progress-rule" style="width:${((index + 1) / total) * 100}%"></div>
  </section>`;
}

function renderProfessionalTensionResolution(slide: Slide, index: number, total: number, tag: string): string {
  const blocks = contentBlocks(slide);
  const first = blocks.slice(0, Math.max(1, Math.ceil(blocks.length / 2)));
  const second = blocks.slice(first.length);
  return `<section class="slide professional blue-tension-slide" data-label="${attr(slideLabel(slide, index))}">
    <div class="slide-header"><span class="eyebrow">${pageTag(index, total)}</span><span class="tag-pill">${tag}</span></div>
    <div class="blue-tension-grid">
      <div class="blue-tension-title reveal">
        <span class="eyebrow">${tag}</span>
        <h2 class="editable">${escapeHtml(slide.title || 'Untitled')}</h2>
      </div>
      <div class="blue-tension-panel blue-tension-primary reveal">
        <span class="blue-tension-num">01</span>
        ${renderBlocks(first)}
      </div>
      <div class="blue-tension-panel reveal">
        <span class="blue-tension-num">02</span>
        ${renderBlocks(second.length ? second : first.slice(0, 1))}
      </div>
    </div>
    <div class="progress-rule" style="width:${((index + 1) / total) * 100}%"></div>
  </section>`;
}

function renderProfessionalClosingCircles(slide: Slide, index: number, total: number, tag: string): string {
  const body = renderBlocks(contentBlocks(slide).slice(0, 2));
  return `<section class="slide professional closing-circles-slide" data-label="${attr(slideLabel(slide, index))}">
    <div class="closing-circle outer"></div>
    <div class="closing-circle inner"></div>
    <div class="closing-copy">
      <span class="eyebrow">${tag}</span>
      <div class="accent-line reveal"></div>
      <h2 class="closing-title reveal editable">${escapeHtml(slide.title || 'Untitled')}</h2>
      <div class="closing-body reveal">${body}</div>
    </div>
    <div class="slide-counter">${pageTag(index, total)}</div>
  </section>`;
}

function renderProfessionalEditorialPhoto(
  slide: Slide,
  index: number,
  total: number,
  tag: string,
  image: { src: string; alt: string },
): string {
  const blocks = contentBlocks(slide).slice(0, 4);
  const lead = renderBlocks(blocks);
  return `<section class="slide professional blue-editorial-photo-slide" data-label="${attr(slideLabel(slide, index))}">
    <figure class="blue-editorial-photo"><img src="${attr(image.src)}" alt="${attr(image.alt)}"></figure>
    <div class="blue-editorial-index">${pageTag(index, total)}</div>
    <div class="blue-editorial-panel reveal">
      <span class="eyebrow">${tag}</span>
      <div class="accent-line"></div>
      <h2 class="blue-editorial-title editable">${escapeHtml(slide.title || 'Untitled')}</h2>
      <div class="blue-editorial-body">${lead}</div>
    </div>
    <div class="progress-rule" style="width:${((index + 1) / total) * 100}%"></div>
  </section>`;
}

function renderProfessionalPhotoBand(
  slide: Slide,
  index: number,
  total: number,
  tag: string,
  image: { src: string; alt: string },
): string {
  const blocks = contentBlocks(slide).slice(0, 4);
  return `<section class="slide professional blue-photo-band-slide" data-label="${attr(slideLabel(slide, index))}">
    <figure class="blue-photo-band"><img src="${attr(image.src)}" alt="${attr(image.alt)}"></figure>
    <div class="blue-photo-band-copy reveal">
      <div class="slide-header"><span class="eyebrow">${pageTag(index, total)}</span><span class="tag-pill">${tag}</span></div>
      <h2 class="blue-photo-band-title editable">${escapeHtml(slide.title || 'Untitled')}</h2>
      <div class="blue-photo-band-body">${renderBlocks(blocks)}</div>
    </div>
    <div class="progress-rule" style="width:${((index + 1) / total) * 100}%"></div>
  </section>`;
}

async function renderProfessionalSlide(slide: Slide, index: number, total: number, baseDir?: string): Promise<string> {
  const image = await slideImage(slide, baseDir);
  const body = renderBlocks(slide.body.filter((block) => block.kind !== 'image'));
  const title = escapeHtml(slide.title || 'Untitled');
  const tag = escapeHtml(lastValue(slide.sectionPath) || slide.layout);
  const variant = variantForSlide(slide, index, { ...DEFAULT_HTML_SLIDE_THEME, renderer: 'professional' });

  if (slide.layout === 'title') {
    return `<section class="slide professional cover${image ? ' has-image' : ''}" data-label="${attr(slideLabel(slide, index))}">
      ${image ? `<figure class="cover-image"><img src="${attr(image.src)}" alt="${attr(image.alt)}"></figure>` : ''}
      <div class="cover-decoration"></div>
      <div class="cover-dots"></div>
      <div class="accent-line reveal"></div>
      <h1 class="cover-title reveal editable">${title}</h1>
      <p class="cover-subtitle reveal editable">${escapeHtml(flattenSlideText(slide).replace(slide.title, '').trim().slice(0, 180))}</p>
      <div class="slide-counter">${pageTag(index, total)}</div>
    </section>`;
  }

  if (image && slide.layout === 'image-focus') {
    return `<section class="slide professional image-focus-slide" data-label="${attr(slideLabel(slide, index))}">
      <figure class="image-focus-bg"><img src="${attr(image.src)}" alt="${attr(image.alt)}"></figure>
      <div class="image-focus-copy reveal">
        <div class="slide-header"><span class="eyebrow">${pageTag(index, total)}</span><span class="tag-pill">${tag}</span></div>
        <h2 class="slide-title editable">${title}</h2>
        <div class="image-focus-body">${body}</div>
      </div>
      <div class="progress-rule" style="width:${((index + 1) / total) * 100}%"></div>
    </section>`;
  }

  if (slide.layout === 'quote' || slide.quote) {
    return `<section class="slide professional quote-slide${image ? ' with-image' : ''}" data-label="${attr(slideLabel(slide, index))}">
      ${image ? `<figure class="quote-image"><img src="${attr(image.src)}" alt="${attr(image.alt)}"></figure>` : ''}
      <div class="slide-header"><span class="eyebrow">Quote</span><span class="tag-pill">${tag}</span></div>
      <div class="quote-mark">“</div>
      <blockquote class="quote-text reveal editable">${escapeHtml(slide.quote?.text || flattenSlideText(slide))}</blockquote>
      ${slide.quote?.attribution ? `<p class="quote-cite reveal editable">${escapeHtml(slide.quote.attribution)}</p>` : ''}
      <div class="progress-rule" style="width:${((index + 1) / total) * 100}%"></div>
    </section>`;
  }

  if (slide.layout === 'stat' || slide.stat) {
    return `<section class="slide professional stat-slide" data-label="${attr(slideLabel(slide, index))}">
      <div class="slide-header"><span class="eyebrow">Insight</span><span class="tag-pill">${tag}</span></div>
      <div class="stat-grid${image ? ' with-image' : ''}">
        <div class="stat-hero reveal"><span class="stat-value editable">${escapeHtml(slide.stat?.value || title)}</span><span class="stat-label editable">${escapeHtml(slide.stat?.label || '')}</span></div>
        <div class="stat-card reveal">${body || `<p class="mm-text editable">${escapeHtml(slide.stat?.context || '')}</p>`}</div>
        ${image ? `<figure class="stat-image reveal"><img src="${attr(image.src)}" alt="${attr(image.alt)}"></figure>` : ''}
      </div>
      <div class="progress-rule" style="width:${((index + 1) / total) * 100}%"></div>
    </section>`;
  }

  if (!image && variant === 'blue.agenda-grid') return renderProfessionalAgendaGrid(slide, index, total, tag);
  if (!image && variant === 'blue.split-highlight') return renderProfessionalSplitHighlight(slide, index, total, tag);
  if (!image && variant === 'blue.timeline-steps') return renderProfessionalTimelineSteps(slide, index, total, tag);
  if (!image && variant === 'blue.metric-row') return renderProfessionalMetricRow(slide, index, total, tag);
  if (!image && variant === 'blue.bar-insight') return renderProfessionalBarInsight(slide, index, total, tag);
  if (!image && variant === 'blue.tension-resolution') return renderProfessionalTensionResolution(slide, index, total, tag);
  if (!image && variant === 'blue.closing-circles') return renderProfessionalClosingCircles(slide, index, total, tag);
  if (image && variant === 'blue.editorial-photo') return renderProfessionalEditorialPhoto(slide, index, total, tag, image);
  if (image && variant === 'blue.photo-band') return renderProfessionalPhotoBand(slide, index, total, tag, image);

  const columns = splitBlocks(slide);
  if (slide.layout === 'two-column' || slide.layout === 'comparison' || columns.length > 1) {
    return `<section class="slide professional content-slide" data-label="${attr(slideLabel(slide, index))}">
      <div class="slide-header"><span class="eyebrow">${pageTag(index, total)}</span><span class="tag-pill">${tag}</span></div>
      <h2 class="slide-title reveal editable">${title}</h2>
      <div class="${image ? 'columns-with-image' : 'column-grid cols-' + columns.length}">
        <div class="column-grid cols-${Math.min(columns.length, 3)}">
          ${columns.slice(0, 3).map((column) => `<div class="content-card reveal">${renderBlocks(column)}</div>`).join('')}
        </div>
        ${image ? `<figure class="image-panel reveal"><img src="${attr(image.src)}" alt="${attr(image.alt)}"></figure>` : ''}
      </div>
      <div class="progress-rule" style="width:${((index + 1) / total) * 100}%"></div>
    </section>`;
  }

  return `<section class="slide professional content-slide" data-label="${attr(slideLabel(slide, index))}">
    <div class="slide-header"><span class="eyebrow">${pageTag(index, total)}</span><span class="tag-pill">${tag}</span></div>
    <h2 class="slide-title reveal editable">${title}</h2>
    <div class="${image ? 'content-with-image' : 'content-wide'}">
      <div class="content-card reveal">${body}</div>
      ${image ? `<figure class="image-panel reveal"><img src="${attr(image.src)}" alt="${attr(image.alt)}"></figure>` : ''}
    </div>
    <div class="progress-rule" style="width:${((index + 1) / total) * 100}%"></div>
  </section>`;
}

function renderGridStatWall(slide: Slide, index: number, total: number, label: string): string {
  const blocks = contentBlocks(slide).slice(0, 5);
  const statValue = slide.stat?.value || String(index + 1).padStart(2, '0');
  const statLabel = slide.stat?.label || slide.title || 'Signal';
  return `<section class="slide grid-theme" data-label="${attr(slideLabel(slide, index))}">
    <div class="ng-frame">
      <div class="ng-panel ng-lemon ng-wall-stat"><span class="editable">${escapeHtml(statValue)}</span><p class="editable">${escapeHtml(statLabel)}</p></div>
      <div class="ng-panel ng-ink ng-wall-title"><span class="ng-label">${label}</span><h2 class="editable">${escapeHtml(slide.title || 'Untitled')}</h2></div>
      ${blocks
        .map(
          (block, blockIndex) =>
            `<div class="ng-panel ${blockIndex % 2 === 0 ? 'ng-paper' : 'ng-ink'} ng-wall-card-${blockIndex + 1}">${blockCardHtml(block, blockIndex)}</div>`,
        )
        .join('')}
      <div class="ng-corner-mark"></div>
    </div>
    <div class="ng-page ng-page-lemon">${pageTag(index, total)}</div>
  </section>`;
}

function renderGridProcessArrows(slide: Slide, index: number, total: number, label: string): string {
  const blocks = contentBlocks(slide).slice(0, 4);
  return `<section class="slide grid-theme" data-label="${attr(slideLabel(slide, index))}">
    <div class="ng-frame">
      <div class="ng-panel ng-ink ng-process-title"><span class="ng-label">${label}</span><h2 class="editable">${escapeHtml(slide.title || 'Untitled')}</h2></div>
      ${blocks
        .map(
          (block, blockIndex) =>
            `<div class="ng-panel ${blockIndex % 2 === 0 ? 'ng-paper' : 'ng-lemon'} ng-process-card-${blockIndex + 1}">
              <span class="ng-process-num">${String(blockIndex + 1).padStart(2, '0')}</span>${renderBlocks([block])}
            </div>`,
        )
        .join('')}
      <div class="ng-arrow ng-arrow-1" aria-hidden="true">→</div>
      <div class="ng-arrow ng-arrow-2" aria-hidden="true">→</div>
      <div class="ng-arrow ng-arrow-3" aria-hidden="true">→</div>
    </div>
    <div class="ng-page">${pageTag(index, total)}</div>
  </section>`;
}

function renderGridMatrixTable(slide: Slide, index: number, total: number, label: string): string {
  const cells = (slide.columns?.flat() ?? contentBlocks(slide)).filter((block) => block.kind !== 'image').slice(0, 6);
  return `<section class="slide grid-theme" data-label="${attr(slideLabel(slide, index))}">
    <div class="ng-frame">
      <div class="ng-panel ng-lemon ng-matrix-title"><span class="ng-label">${label}</span><h2 class="editable">${escapeHtml(slide.title || 'Untitled')}</h2></div>
      ${cells
        .map(
          (block, blockIndex) =>
            `<div class="ng-panel ${blockIndex === 2 || blockIndex === 5 ? 'ng-ink' : 'ng-paper'} ng-matrix-cell-${blockIndex + 1}">${blockCardHtml(block, blockIndex)}</div>`,
        )
        .join('')}
      <div class="ng-corner-mark"></div>
    </div>
    <div class="ng-page ng-page-invert">${pageTag(index, total)}</div>
  </section>`;
}

function renderGridImageBillboard(
  slide: Slide,
  index: number,
  total: number,
  label: string,
  image: { src: string; alt: string },
): string {
  const blocks = (slide.columns?.flat() ?? contentBlocks(slide)).filter((block) => block.kind !== 'image').slice(0, 3);
  return `<section class="slide grid-theme" data-label="${attr(slideLabel(slide, index))}">
    <div class="ng-frame">
      <div class="ng-panel ng-photo ng-billboard-photo"><img src="${attr(image.src)}" alt="${attr(image.alt)}"></div>
      <div class="ng-panel ng-lemon ng-billboard-title"><span class="ng-label">${label}</span><h2 class="editable">${escapeHtml(slide.title || 'Untitled')}</h2></div>
      ${blocks
        .map(
          (block, blockIndex) =>
            `<div class="ng-panel ${blockIndex === 1 ? 'ng-ink' : 'ng-paper'} ng-billboard-card-${blockIndex + 1}">${blockCardHtml(block, blockIndex)}</div>`,
        )
        .join('')}
      <div class="ng-corner-mark"></div>
    </div>
    <div class="ng-page ng-page-lemon">${pageTag(index, total)}</div>
  </section>`;
}

function renderGridManifesto(slide: Slide, index: number, total: number, label: string): string {
  const blocks = contentBlocks(slide).slice(0, 4);
  return `<section class="slide grid-theme" data-label="${attr(slideLabel(slide, index))}">
    <div class="ng-frame">
      <div class="ng-panel ng-lemon ng-manifesto-num"><span>${String(index + 1).padStart(2, '0')}</span></div>
      <div class="ng-panel ng-ink ng-manifesto-title"><span class="ng-label">${label}</span><h2 class="editable">${escapeHtml(slide.title || 'Untitled')}</h2></div>
      ${blocks
        .map(
          (block, blockIndex) =>
            `<div class="ng-panel ${blockIndex % 2 === 0 ? 'ng-paper' : 'ng-ink'} ng-manifesto-card-${blockIndex + 1}">${blockCardHtml(block, blockIndex)}</div>`,
        )
        .join('')}
      <div class="ng-corner-mark"></div>
    </div>
    <div class="ng-page ng-page-lemon">${pageTag(index, total)}</div>
  </section>`;
}

async function renderGridSlide(slide: Slide, index: number, total: number, baseDir?: string): Promise<string> {
  const image = await slideImage(slide, baseDir);
  const title = escapeHtml(slide.title || 'Untitled');
  const body = renderBlocks(slide.body.filter((block) => block.kind !== 'image'));
  const columns = splitBlocks(slide);
  const label = escapeHtml(lastValue(slide.sectionPath) || slide.layout);
  const variant = variantForSlide(slide, index, {
    ...DEFAULT_HTML_SLIDE_THEME,
    renderer: 'grid',
  });

  if (!image && variant === 'neo.stat-wall') return renderGridStatWall(slide, index, total, label);
  if (!image && variant === 'neo.process-arrows') return renderGridProcessArrows(slide, index, total, label);
  if (!image && variant === 'neo.matrix-table') return renderGridMatrixTable(slide, index, total, label);
  if (!image && variant === 'neo.manifesto-grid') return renderGridManifesto(slide, index, total, label);
  if (image && variant === 'neo.image-billboard') return renderGridImageBillboard(slide, index, total, label, image);

  if (variant === 'neo.section-ordinal') {
    return `<section class="slide grid-theme" data-label="${attr(slideLabel(slide, index))}">
      <div class="ng-frame">
        <div class="ng-panel ng-lemon ng-section-num"><span>${String(index + 1).padStart(2, '0')}</span></div>
        <div class="ng-panel ng-ink ng-section-title"><span class="ng-label">${label}</span><h1 class="editable">${title}</h1></div>
        <div class="ng-panel ng-paper ng-section-copy">${body || `<p class="editable">${escapeHtml(flattenSlideText(slide).slice(0, 260))}</p>`}</div>
        <div class="ng-panel ng-paper ng-qr-tile" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
      </div>
      <div class="ng-page ng-page-lemon">${pageTag(index, total)}</div>
    </section>`;
  }

  if (slide.layout === 'title' || slide.layout === 'section') {
    return `<section class="slide grid-theme" data-label="${attr(slideLabel(slide, index))}">
      <div class="ng-frame">
        <div class="ng-panel ng-ink ${image ? 'ng-hero-with-photo' : 'ng-hero'}"><span class="ng-label">${label}</span><h1 class="editable">${title}</h1></div>
        ${image ? `<div class="ng-panel ng-photo ng-hero-photo"><img src="${attr(image.src)}" alt="${attr(image.alt)}"></div>` : `<div class="ng-panel ng-lemon ng-mark"><span>${String(index + 1).padStart(2, '0')}</span></div>`}
        <div class="ng-panel ng-paper ${image ? 'ng-summary-with-photo' : 'ng-summary'}">${body || `<p class="editable">${escapeHtml(flattenSlideText(slide).slice(0, 220))}</p>`}</div>
        <div class="ng-corner-mark"></div>
      </div>
      <div class="ng-page">${pageTag(index, total)}</div>
    </section>`;
  }

  if (slide.layout === 'stat' || slide.stat) {
    return `<section class="slide grid-theme" data-label="${attr(slideLabel(slide, index))}">
      <div class="ng-frame">
        <div class="ng-panel ng-lemon ng-stat"><span class="editable">${escapeHtml(slide.stat?.value || '01')}</span></div>
        <div class="ng-panel ng-ink ${image ? 'ng-title-with-photo' : 'ng-title'}"><span class="ng-label">${label}</span><h2 class="editable">${title}</h2></div>
        <div class="ng-panel ng-paper ${image ? 'ng-body-with-photo' : 'ng-body'}">${body || `<p class="editable">${escapeHtml(slide.stat?.context || '')}</p>`}</div>
        ${image ? `<div class="ng-panel ng-photo ng-stat-photo"><img src="${attr(image.src)}" alt="${attr(image.alt)}"></div>` : ''}
      </div>
      <div class="ng-page">${pageTag(index, total)}</div>
    </section>`;
  }

  if (image && slide.layout === 'image-focus') {
    return `<section class="slide grid-theme" data-label="${attr(slideLabel(slide, index))}">
      <div class="ng-frame">
        <div class="ng-panel ng-photo"><img src="${attr(image.src)}" alt="${attr(image.alt)}"></div>
        <div class="ng-panel ng-lemon ng-title"><span class="ng-label">${label}</span><h2 class="editable">${title}</h2></div>
        <div class="ng-panel ng-paper ng-body">${body}</div>
      </div>
      <div class="ng-page ng-page-invert">${pageTag(index, total)}</div>
    </section>`;
  }

  if (image && variant === 'neo.photo-strip') {
    return `<section class="slide grid-theme" data-label="${attr(slideLabel(slide, index))}">
      <div class="ng-frame">
        <div class="ng-panel ng-photo ng-photo-strip-main"><img src="${attr(image.src)}" alt="${attr(image.alt)}"></div>
        <div class="ng-panel ng-lemon ng-photo-strip-title"><span class="ng-label">${label}</span><h2 class="editable">${title}</h2></div>
        ${columns.slice(0, 3).map((column, columnIndex) => `<div class="ng-panel ${columnIndex === 1 ? 'ng-ink' : 'ng-paper'} ng-photo-strip-card-${columnIndex + 1}">${renderBlocks(column)}</div>`).join('')}
      </div>
      <div class="ng-page">${pageTag(index, total)}</div>
    </section>`;
  }

  if (!image && variant === 'neo.poster-grid-6') {
    const blocks = (slide.body.length > 0 ? slide.body : columns.flat()).filter((block) => block.kind !== 'image').slice(0, 6);
    return `<section class="slide grid-theme" data-label="${attr(slideLabel(slide, index))}">
      <div class="ng-frame">
        <div class="ng-panel ng-ink ng-poster-title"><span class="ng-label">${label}</span><h2 class="editable">${title}</h2></div>
        ${blocks.map((block, blockIndex) => `<div class="ng-panel ${blockIndex % 3 === 1 ? 'ng-lemon' : 'ng-paper'} ng-poster-card-${blockIndex + 1}">${blockCardHtml(block, blockIndex)}</div>`).join('')}
        <div class="ng-corner-mark"></div>
      </div>
      <div class="ng-page">${pageTag(index, total)}</div>
    </section>`;
  }

  return `<section class="slide grid-theme" data-label="${attr(slideLabel(slide, index))}">
    <div class="ng-frame">
      <div class="ng-panel ng-ink ng-title"><span class="ng-label">${label}</span><h2 class="editable">${title}</h2></div>
      ${columns
        .slice(0, 3)
        .map((column, columnIndex) => `<div class="ng-panel ${columnIndex === 1 ? 'ng-lemon' : 'ng-paper'} ng-col-${columnIndex + 1}">${renderBlocks(column)}</div>`)
        .join('')}
      ${image ? `<div class="ng-panel ng-photo ng-side-photo"><img src="${attr(image.src)}" alt="${attr(image.alt)}"></div>` : ''}
    </div>
    <div class="ng-page">${pageTag(index, total)}</div>
  </section>`;
}

function renderSignalStatement(slide: Slide, index: number, total: number, section: string): string {
  const lead = renderBlocks(contentBlocks(slide).slice(0, 1));
  return `<section class="slide signal-theme surface-dark signal-statement-slide" data-label="${attr(slideLabel(slide, index))}">
    <div class="signal-texture"></div>
    <div class="signal-statement">
      <span class="signal-kicker editable">${section}</span>
      <div class="signal-rule"></div>
      <h2 class="signal-statement-title editable">${escapeHtml(slide.title || 'Untitled')}</h2>
      <div class="signal-statement-lead">${lead}</div>
    </div>
    <div class="signal-footer"><span>${pageTag(index, total)}</span><span>Statement</span></div>
  </section>`;
}

function renderSignalEditorialColumns(slide: Slide, index: number, total: number, section: string): string {
  const columns = splitBlocks(slide).slice(0, 3);
  return `<section class="slide signal-theme surface-light" data-label="${attr(slideLabel(slide, index))}">
    <div class="signal-chrome"><span>${section}</span><span>${pageTag(index, total)}</span></div>
    <div class="signal-columns-layout">
      <div class="signal-columns-head">
        <span class="signal-kicker editable">${section}</span>
        <h2 class="signal-title editable">${escapeHtml(slide.title || 'Untitled')}</h2>
      </div>
      <div class="signal-columns">
        ${columns.map((column, columnIndex) => `<div class="signal-column"><span class="signal-card-num">${String(columnIndex + 1).padStart(2, '0')}</span>${renderBlocks(column)}</div>`).join('')}
      </div>
    </div>
  </section>`;
}

function renderSignalCompareHairline(slide: Slide, index: number, total: number, section: string): string {
  const columns = splitBlocks(slide).slice(0, 2);
  return `<section class="slide signal-theme surface-dark" data-label="${attr(slideLabel(slide, index))}">
    <div class="signal-texture"></div>
    <div class="signal-chrome"><span>${section}</span><span>${pageTag(index, total)}</span></div>
    <div class="signal-compare-layout">
      <div class="signal-compare-head">
        <span class="signal-kicker editable">${section}</span>
        <h2 class="signal-title editable">${escapeHtml(slide.title || 'Untitled')}</h2>
      </div>
      <div class="signal-compare-panels">
        ${columns.map((column, columnIndex) => `<div class="signal-compare-panel"><span class="signal-card-num">${String(columnIndex + 1).padStart(2, '0')}</span>${renderBlocks(column)}</div>`).join('')}
      </div>
    </div>
  </section>`;
}

function renderSignalEvidenceLedger(slide: Slide, index: number, total: number, section: string): string {
  const blocks = contentBlocks(slide).slice(0, 6);
  return `<section class="slide signal-theme surface-light signal-ledger-slide" data-label="${attr(slideLabel(slide, index))}">
    <div class="signal-chrome"><span>${section}</span><span>${pageTag(index, total)}</span></div>
    <div class="signal-ledger-layout">
      <div class="signal-ledger-head">
        <span class="signal-kicker editable">${section}</span>
        <h2 class="signal-title editable">${escapeHtml(slide.title || 'Untitled')}</h2>
      </div>
      <div class="signal-ledger-list">
        ${blocks
          .map(
            (block, blockIndex) =>
              `<div class="signal-ledger-row"><span class="signal-card-num">${String(blockIndex + 1).padStart(2, '0')}</span><div>${renderBlocks([block])}</div></div>`,
          )
          .join('')}
      </div>
    </div>
  </section>`;
}

function renderSignalPhotoEssay(
  slide: Slide,
  index: number,
  total: number,
  section: string,
  image: { src: string; alt: string },
): string {
  const blocks = contentBlocks(slide).slice(0, 4);
  return `<section class="slide signal-theme surface-dark signal-photo-essay-slide" data-label="${attr(slideLabel(slide, index))}">
    <div class="signal-texture"></div>
    <div class="signal-chrome"><span>${section}</span><span>${pageTag(index, total)}</span></div>
    <figure class="signal-photo-essay-image"><img src="${attr(image.src)}" alt="${attr(image.alt)}"></figure>
    <div class="signal-photo-essay-copy">
      <span class="signal-kicker editable">${section}</span>
      <div class="signal-rule"></div>
      <h2 class="signal-photo-essay-title editable">${escapeHtml(slide.title || 'Untitled')}</h2>
      <div class="signal-photo-essay-body">${renderBlocks(blocks)}</div>
    </div>
    <div class="signal-footer"><span>${pageTag(index, total)}</span><span>Field Note</span></div>
  </section>`;
}

function renderSignalImageDossier(
  slide: Slide,
  index: number,
  total: number,
  section: string,
  image: { src: string; alt: string },
): string {
  const blocks = contentBlocks(slide).slice(0, 4);
  return `<section class="slide signal-theme surface-light signal-dossier-slide" data-label="${attr(slideLabel(slide, index))}">
    <figure class="signal-dossier-image"><img src="${attr(image.src)}" alt="${attr(image.alt)}"></figure>
    <div class="signal-dossier-copy">
      <div class="signal-chrome"><span>${section}</span><span>${pageTag(index, total)}</span></div>
      <span class="signal-kicker editable">${section}</span>
      <h2 class="signal-dossier-title editable">${escapeHtml(slide.title || 'Untitled')}</h2>
      <div class="signal-dossier-body">${renderBlocks(blocks)}</div>
    </div>
  </section>`;
}

async function renderSignalSlide(slide: Slide, index: number, total: number, theme: HtmlSlideTheme, baseDir?: string): Promise<string> {
  const image = await slideImage(slide, baseDir);
  const title = escapeHtml(slide.title || 'Untitled');
  const body = renderBlocks(slide.body.filter((block) => block.kind !== 'image'));
  const surface = surfaceClass(theme, index, slide.layout);
  const section = escapeHtml(lastValue(slide.sectionPath) || slide.layout);
  const variant = variantForSlide(slide, index, theme);

  if (!image && variant === 'signal.statement' && slide.layout !== 'title') {
    return renderSignalStatement(slide, index, total, section);
  }

  if (slide.layout === 'title' || slide.layout === 'section') {
    return `<section class="slide signal-theme surface-dark${image ? ' signal-cover-with-image' : ''}" data-label="${attr(slideLabel(slide, index))}">
      ${image ? `<figure class="signal-cover-image"><img src="${attr(image.src)}" alt="${attr(image.alt)}"></figure>` : ''}
      <div class="signal-texture"></div>
      <div class="signal-center">
        <span class="signal-kicker editable">${section}</span>
        <div class="signal-rule"></div>
        <h1 class="signal-display editable">${title}</h1>
        <p class="signal-lead editable">${escapeHtml(flattenSlideText(slide).replace(slide.title, '').trim().slice(0, 220))}</p>
      </div>
      <div class="signal-footer"><span>${pageTag(index, total)}</span><span>MarkMind HTML</span></div>
    </section>`;
  }

  if (slide.layout === 'quote' || slide.quote) {
    return `<section class="slide signal-theme surface-dark${image ? ' signal-quote-with-image' : ''}" data-label="${attr(slideLabel(slide, index))}">
      ${image ? `<figure class="signal-quote-image"><img src="${attr(image.src)}" alt="${attr(image.alt)}"></figure>` : ''}
      <div class="signal-texture"></div>
      <div class="signal-quote">
        <span class="signal-kicker">Quote</span>
        <blockquote class="editable">${escapeHtml(slide.quote?.text || flattenSlideText(slide))}</blockquote>
        ${slide.quote?.attribution ? `<p class="signal-cite editable">${escapeHtml(slide.quote.attribution)}</p>` : ''}
      </div>
      <div class="signal-footer"><span>${pageTag(index, total)}</span><span>${section}</span></div>
    </section>`;
  }

  if (slide.layout === 'stat' || slide.stat) {
    return `<section class="slide signal-theme${surface}" data-label="${attr(slideLabel(slide, index))}">
      <div class="signal-texture"></div>
      <div class="signal-chrome"><span>${section}</span><span>${pageTag(index, total)}</span></div>
      <div class="signal-stat${image ? ' with-image' : ''}">
        <div><span class="signal-stat-value editable">${escapeHtml(slide.stat?.value || title)}</span><p class="editable">${escapeHtml(slide.stat?.label || '')}</p></div>
        <div class="signal-body">${body || `<p class="editable">${escapeHtml(slide.stat?.context || '')}</p>`}</div>
        ${image ? `<figure class="signal-stat-image"><img src="${attr(image.src)}" alt="${attr(image.alt)}"></figure>` : ''}
      </div>
    </section>`;
  }

  if (!image && variant === 'signal.timeline-spine') {
    const blocks = slide.body.filter((block) => block.kind !== 'image').slice(0, 5);
    return `<section class="slide signal-theme${surface}" data-label="${attr(slideLabel(slide, index))}">
      <div class="signal-texture"></div>
      <div class="signal-chrome"><span>${section}</span><span>${pageTag(index, total)}</span></div>
      <div class="signal-timeline">
        <div class="signal-timeline-head">
          <span class="signal-kicker editable">${section}</span>
          <h2 class="signal-title editable">${title}</h2>
        </div>
        <div class="signal-spine-list">
          ${blocks.map((block, i) => `<div class="signal-spine-item"><span class="signal-spine-index">${String(i + 1).padStart(2, '0')}</span><div>${renderBlocks([block])}</div></div>`).join('')}
        </div>
      </div>
    </section>`;
  }

  if (!image && variant === 'signal.briefing-cards') {
    const blocks = slide.body.filter((block) => block.kind !== 'image').slice(0, 6);
    return `<section class="slide signal-theme${surface}" data-label="${attr(slideLabel(slide, index))}">
      <div class="signal-texture"></div>
      <div class="signal-chrome"><span>${section}</span><span>${pageTag(index, total)}</span></div>
      <div class="signal-briefing">
        <div class="signal-briefing-title">
          <span class="signal-kicker editable">${section}</span>
          <h2 class="signal-title editable">${title}</h2>
        </div>
        <div class="signal-card-grid">
          ${blocks.map((block, i) => `<div class="signal-card"><span class="signal-card-num">${String(i + 1).padStart(2, '0')}</span>${renderBlocks([block])}</div>`).join('')}
        </div>
      </div>
    </section>`;
  }

  if (!image && variant === 'signal.editorial-split') {
    const blocks = slide.body.filter((block) => block.kind !== 'image');
    const [first, ...rest] = blocks;
    return `<section class="slide signal-theme${surface}" data-label="${attr(slideLabel(slide, index))}">
      <div class="signal-texture"></div>
      <div class="signal-chrome"><span>${section}</span><span>${pageTag(index, total)}</span></div>
      <div class="signal-editorial-split">
        <div>
          <span class="signal-kicker editable">${section}</span>
          <h2 class="signal-title editable">${title}</h2>
          <div class="signal-rule"></div>
          <div class="signal-lead-block">${first ? renderBlocks([first]) : ''}</div>
        </div>
        <div class="signal-editorial-side">${renderBlocks(rest.slice(0, 5))}</div>
      </div>
    </section>`;
  }

  if (!image && variant === 'signal.editorial-columns') {
    return renderSignalEditorialColumns(slide, index, total, section);
  }

  if (!image && variant === 'signal.compare-hairline') {
    return renderSignalCompareHairline(slide, index, total, section);
  }

  if (!image && variant === 'signal.evidence-ledger') {
    return renderSignalEvidenceLedger(slide, index, total, section);
  }

  if (image && variant === 'signal.photo-essay') {
    return renderSignalPhotoEssay(slide, index, total, section, image);
  }

  if (image && variant === 'signal.image-dossier') {
    return renderSignalImageDossier(slide, index, total, section, image);
  }

  return `<section class="slide signal-theme${surface}" data-label="${attr(slideLabel(slide, index))}">
    <div class="signal-texture"></div>
    <div class="signal-chrome"><span>${section}</span><span>${pageTag(index, total)}</span></div>
    <div class="${image ? 'signal-layout with-image' : 'signal-layout'}">
      <div>
        <span class="signal-kicker editable">${section}</span>
        <h2 class="signal-title editable">${title}</h2>
        <div class="signal-body">${body}</div>
      </div>
      ${image ? `<figure class="signal-image"><img src="${attr(image.src)}" alt="${attr(image.alt)}"></figure>` : ''}
    </div>
  </section>`;
}

async function renderSlide(slide: Slide, index: number, total: number, theme: HtmlSlideTheme, baseDir?: string): Promise<string> {
  const resolvedSlide = await resolveSlideImages(slide, baseDir);
  const html =
    theme.renderer === 'grid'
      ? await renderGridSlide(resolvedSlide, index, total, baseDir)
      : theme.renderer === 'signal'
        ? await renderSignalSlide(resolvedSlide, index, total, theme, baseDir)
        : await renderProfessionalSlide(resolvedSlide, index, total, baseDir);
  return decorateSlideHtml(html, resolvedSlide, index, total, theme);
}

function viewportBaseCss(): string {
  return `/* ===========================================
   FIXED 16:9 STAGE: MANDATORY BASE STYLES
   Adapted from zarazhangrui/frontend-slides viewport-base.css (MIT).
   Slides are authored at 1920x1080 and scaled as a whole.
   =========================================== */
html,
body {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
  background: var(--stage-bg, #000);
}
.deck-viewport {
  position: fixed;
  inset: 0;
  overflow: hidden;
  background: var(--stage-bg, #000);
}
.deck-stage {
  position: absolute;
  left: 0;
  top: 0;
  width: 1920px;
  height: 1080px;
  overflow: hidden;
  transform-origin: 0 0;
  background: var(--slide-bg, #fff);
}
.slide {
  position: absolute;
  inset: 0;
  width: 1920px;
  height: 1080px;
  overflow: hidden;
  display: block;
  visibility: hidden;
  opacity: 0;
  pointer-events: none;
  background: var(--slide-bg, #fff);
}
.slide.active,
.slide.visible {
  visibility: visible;
  opacity: 1;
  pointer-events: auto;
  z-index: 1;
}
img,
video,
canvas,
svg {
  max-width: 100%;
  max-height: 100%;
}
.deck-controls {
  position: fixed;
  left: 50%;
  bottom: 22px;
  transform: translateX(-50%);
  z-index: 1000;
}
@media print {
  html,
  body {
    width: 1920px;
    height: auto;
    overflow: visible;
    background: #fff;
  }
  .deck-viewport {
    position: static;
    overflow: visible;
    background: #fff;
  }
  .deck-stage {
    position: static;
    width: auto;
    height: auto;
    transform: none !important;
    background: none;
  }
  .slide {
    position: relative;
    display: block !important;
    visibility: visible !important;
    opacity: 1 !important;
    pointer-events: auto !important;
    width: 1920px;
    height: 1080px;
    break-after: page;
    page-break-after: always;
  }
  .slide:last-child {
    break-after: auto;
    page-break-after: auto;
  }
  .deck-controls,
  .edit-hotzone,
  .edit-toggle {
    display: none !important;
  }
}
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.2s !important;
  }
}`;
}

function themeCss(theme: HtmlSlideTheme, fontFamily?: string, transition?: string): string {
  const c = theme.colors;
  const displayFont = fontStack(theme.fonts.display, fontFamily);
  const bodyFont = fontStack(theme.fonts.body, fontFamily);
  return `/* === THEME TOKENS === */
:root {
  --stage-bg: #${c.stage};
  --slide-bg: #${c.bg};
  --surface: #${c.surface};
  --surface-alt: #${c.surfaceAlt};
  --text: #${c.text};
  --muted: #${c.muted};
  --accent: #${c.accent};
  --accent-2: #${c.accent2};
  --border: #${c.border};
  --inverse-text: #${c.inverseText};
  --font-display: ${displayFont};
  --font-body: ${bodyFont};
  --font-mono: ${theme.fonts.mono};
  --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
}
* { box-sizing: border-box; }
body { font-family: var(--font-body); color: var(--text); }
code, pre { font-family: var(--font-mono); }
${transitionCss(transition)}
.reveal { opacity: 0; transform: translateY(28px); transition: opacity 560ms var(--ease-out-expo), transform 560ms var(--ease-out-expo); }
.slide.visible .reveal { opacity: 1; transform: translateY(0); }
.reveal:nth-child(2) { transition-delay: 80ms; }
.reveal:nth-child(3) { transition-delay: 160ms; }
.reveal:nth-child(4) { transition-delay: 240ms; }
.deck-controls { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: 999px; background: rgba(0,0,0,.72); color: white; font: 500 14px var(--font-body); backdrop-filter: blur(12px); transition: opacity 180ms ease; }
.deck-controls button { width: 34px; height: 30px; display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: 999px; color: inherit; background: rgba(255,255,255,.12); cursor: pointer; }
.deck-controls button:hover { background: rgba(255,255,255,.22); }
.deck-controls button svg { width: 17px; height: 17px; display: block; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.deck-controls .fullscreen-button { width: 36px; }
body.is-fullscreen .deck-controls { display: none; }
.deck-count { min-width: 58px; text-align: center; font-variant-numeric: tabular-nums; }
.edit-hotzone { position: fixed; top: 0; left: 0; width: 80px; height: 80px; z-index: 10000; }
.edit-toggle { position: fixed; top: 18px; left: 18px; z-index: 10001; opacity: 0; pointer-events: none; border: 0; border-radius: 999px; padding: 8px 12px; background: rgba(0,0,0,.72); color: #fff; font: 600 13px var(--font-body); transition: opacity 180ms ease; }
.edit-toggle.show, .edit-toggle.active { opacity: 1; pointer-events: auto; }
body.editing .editable { outline: 2px dashed rgba(255,255,255,.45); outline-offset: 4px; cursor: text; }
.mm-bullets { margin: 0; padding: 0; list-style: none; display: grid; gap: 18px; }
.mm-bullets li { position: relative; padding-left: 34px; font-size: 28px; line-height: 1.32; }
.mm-bullets li::before { content: ""; position: absolute; left: 0; top: .58em; width: 12px; height: 12px; background: var(--accent); }
.mm-text { font-size: 30px; line-height: 1.42; margin: 0 0 22px; }
.mm-subhead { font: 700 34px/1.12 var(--font-display); margin: 0 0 16px; }
.mm-code { max-height: 390px; overflow: hidden; white-space: pre-wrap; padding: 22px; background: rgba(0,0,0,.08); font-size: 20px; line-height: 1.35; }
.mm-table { width: 100%; border-collapse: collapse; font-size: 22px; line-height: 1.32; }
.mm-table th, .mm-table td { padding: 16px 18px; border: 1px solid var(--border); text-align: left; vertical-align: top; }
.mm-table th { font-family: var(--font-mono); color: var(--accent); }
.mm-inline-image img, .image-panel img, .signal-image img, .ng-photo img, .blue-editorial-photo img, .blue-photo-band img, .signal-photo-essay-image img, .signal-dossier-image img { width: 100%; height: 100%; object-fit: cover; display: block; }
.slide-density-low .mm-text, .slide-density-low .mm-bullets li { font-size: 32px; line-height: 1.5; }
.slide-density-low .mm-bullets { gap: 22px; }
.slide-density-high .mm-text, .slide-density-high .mm-bullets li { font-size: 24px; line-height: 1.28; }
.slide-density-high .mm-bullets { gap: 12px; }
.slide-density-high .mm-subhead { font-size: 28px; }
.visual-priority-high .slide-title { font-size: 82px; }
.visual-priority-high .signal-title { font-size: 84px; }
.image-treatment-muted img { filter: saturate(.78) contrast(1.06); }
.image-treatment-poster img { filter: saturate(1.12) contrast(1.08); }
.image-treatment-duotone img { filter: grayscale(.95) contrast(1.14); }
.image-treatment-natural img { filter: saturate(1.02) contrast(1.02); }
.image-crop-left img { object-position: 35% center; }
.image-crop-right img { object-position: 65% center; }
.image-crop-top img { object-position: center 28%; }
.image-crop-center img { object-position: center center; }

/* === BLUE PROFESSIONAL RENDERER === */
.professional { background: var(--slide-bg); color: var(--text); padding: 76px 92px 72px; }
.professional .slide-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 38px; font-family: var(--font-display); }
.professional .eyebrow { color: var(--accent); text-transform: uppercase; letter-spacing: .08em; font-size: 22px; font-weight: 700; }
.professional .tag-pill { color: var(--accent); background: rgba(30,43,250,.08); border-radius: 999px; padding: 12px 26px; font-weight: 600; font-size: 20px; }
.professional .slide-title { font: 700 72px/.98 var(--font-display); letter-spacing: -.02em; max-width: 1280px; margin: 0 0 42px; }
.professional .content-card, .professional .stat-card { background: rgba(30,43,250,.04); border: 2px solid rgba(30,43,250,.2); border-radius: 22px; padding: 38px 42px; }
.professional .content-wide { max-width: 1320px; }
.professional .content-with-image { display: grid; grid-template-columns: minmax(0, .9fr) 720px; gap: 56px; align-items: stretch; }
.professional .image-panel { margin: 0; border-radius: 24px; overflow: hidden; border: 2px solid rgba(30,43,250,.2); min-height: 560px; }
.professional .column-grid { display: grid; gap: 28px; }
.professional .column-grid.cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.professional .column-grid.cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.professional .columns-with-image { display: grid; grid-template-columns: minmax(0, 1fr) 620px; gap: 38px; align-items: stretch; }
.professional .columns-with-image .column-grid.cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; }
.professional .columns-with-image .content-card { padding: 28px 30px; }
.professional .columns-with-image .mm-bullets { gap: 12px; }
.professional .columns-with-image .mm-bullets li { font-size: 23px; line-height: 1.24; padding-left: 26px; }
.professional.cover { display: flex; flex-direction: column; justify-content: center; padding-left: 128px; }
.professional.cover.has-image { padding-right: 760px; }
.cover-image { position: absolute; top: 0; right: 0; width: 780px; height: 100%; margin: 0; overflow: hidden; }
.cover-image::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, rgba(253,250,231,.98), rgba(253,250,231,.42) 38%, rgba(30,43,250,.08)); }
.cover-image img { width: 100%; height: 100%; object-fit: cover; display: block; }
.cover-decoration { position: absolute; right: 0; top: 0; width: 660px; height: 100%; background: rgba(30,43,250,.08); clip-path: polygon(28% 0,100% 0,100% 100%,0 100%); }
.professional.cover.has-image .cover-decoration { right: 560px; width: 420px; opacity: .72; }
.cover-dots { position: absolute; right: 128px; top: 160px; width: 84px; height: 84px; background: radial-gradient(circle, var(--accent) 0 4px, transparent 5px); background-size: 28px 28px; opacity: .28; }
.accent-line { width: 88px; height: 7px; background: var(--accent); border-radius: 999px; margin-bottom: 38px; }
.cover-title { position: relative; z-index: 1; font: 700 116px/.94 var(--font-display); letter-spacing: -.035em; max-width: 1180px; margin: 0; }
.cover-subtitle { position: relative; z-index: 1; max-width: 780px; margin: 34px 0 0; font-size: 34px; line-height: 1.42; color: var(--muted); }
.slide-counter { position: absolute; left: 92px; bottom: 58px; color: var(--muted); font: 600 20px var(--font-display); }
.image-focus-slide { padding: 0; color: var(--inverse-text); background: #0A1022; }
.image-focus-bg { position: absolute; inset: 0; margin: 0; }
.image-focus-bg::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, rgba(4,7,22,.86), rgba(4,7,22,.42) 50%, rgba(4,7,22,.06)); }
.image-focus-bg img { width: 100%; height: 100%; object-fit: cover; display: block; }
.image-focus-copy { position: relative; z-index: 1; width: 760px; min-height: 100%; padding: 78px 92px 80px; display: flex; flex-direction: column; justify-content: center; }
.image-focus-copy .slide-title { color: var(--inverse-text); margin-bottom: 32px; }
.image-focus-copy .tag-pill { color: var(--inverse-text); background: rgba(255,255,255,.14); }
.image-focus-body { color: rgba(253,250,231,.86); }
.quote-mark { position: absolute; top: 180px; left: 108px; font: 700 180px/.6 var(--font-display); color: var(--accent); opacity: .15; }
.quote-text { margin: 180px 120px 0; max-width: 1280px; font: 600 66px/1.18 var(--font-display); letter-spacing: -.02em; }
.quote-cite { margin: 36px 120px 0; color: var(--muted); font-size: 24px; }
.quote-slide.with-image .quote-text { max-width: 980px; margin-right: 680px; }
.quote-slide.with-image .quote-cite { margin-right: 680px; }
.quote-image { position: absolute; right: 92px; top: 192px; width: 560px; height: 640px; margin: 0; border-radius: 30px; overflow: hidden; border: 2px solid rgba(30,43,250,.2); }
.quote-image img { width: 100%; height: 100%; object-fit: cover; display: block; }
.stat-grid { display: grid; grid-template-columns: 560px 1fr; gap: 44px; align-items: stretch; }
.stat-grid.with-image { grid-template-columns: 500px minmax(0, 1fr) 520px; }
.stat-hero { background: var(--accent); color: var(--inverse-text); border-radius: 26px; padding: 54px; display: flex; flex-direction: column; justify-content: flex-end; min-height: 620px; }
.stat-value { font: 700 126px/.86 var(--font-display); letter-spacing: -.04em; }
.stat-label { margin-top: 28px; font-size: 30px; line-height: 1.24; }
.stat-image { margin: 0; border-radius: 26px; overflow: hidden; min-height: 620px; }
.stat-image img { width: 100%; height: 100%; object-fit: cover; display: block; }
.agenda-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); grid-auto-rows: minmax(210px, 1fr); gap: 24px; }
.agenda-card, .detail-card { background: rgba(30,43,250,.04); border: 1.5px solid rgba(30,43,250,.2); border-radius: 18px; padding: 30px 32px; min-height: 0; overflow: hidden; }
.agenda-card .card-num, .detail-card .card-num { display: block; color: var(--accent); font: 700 28px/1 var(--font-display); margin-bottom: 18px; }
.agenda-card h3, .detail-card h3 { font: 700 32px/1.08 var(--font-display); margin: 0; }
.agenda-card .mm-bullets li, .detail-card .mm-bullets li { font-size: 23px; line-height: 1.28; }
.split-highlight-layout { display: grid; grid-template-columns: minmax(0, 1.06fr) 560px; gap: 54px; align-items: stretch; }
.split-highlight-block { background: rgba(30,43,250,.08); border-left: 7px solid var(--accent); border-radius: 18px; padding: 34px 38px; font-family: var(--font-display); }
.split-highlight-block .mm-text, .split-highlight-block .mm-bullets li { font-size: 34px; line-height: 1.32; color: var(--text); }
.detail-stack { display: grid; gap: 20px; align-content: start; }
.step-row { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 26px; margin-top: 56px; }
.step-card { background: rgba(30,43,250,.04); border: 1.5px solid rgba(30,43,250,.2); border-radius: 20px; padding: 34px 30px; min-height: 500px; opacity: var(--step-opacity, 1); }
.step-circle { display: grid; place-items: center; width: 68px; height: 68px; border-radius: 50%; background: var(--accent); color: var(--inverse-text); font: 700 24px/1 var(--font-display); margin-bottom: 42px; }
.step-card .mm-bullets li, .step-card .mm-text { font-size: 26px; line-height: 1.34; }
.metric-row { display: grid; grid-template-columns: 1.14fr repeat(3, .9fr); gap: 24px; min-height: 560px; }
.metric-card { background: rgba(30,43,250,.04); border: 1.5px solid rgba(30,43,250,.2); border-radius: 14px; padding: 34px 32px; overflow: hidden; }
.metric-card.feature { background: var(--accent); color: var(--inverse-text); }
.metric-index { display: block; font: 700 44px/.9 var(--font-display); color: var(--accent); margin-bottom: 40px; }
.metric-card.feature .metric-index { color: var(--inverse-text); opacity: .72; }
.metric-card .mm-text, .metric-card .mm-bullets li { font-size: 26px; line-height: 1.32; }
.metric-card.feature .mm-text, .metric-card.feature .mm-bullets li { font: 600 36px/1.24 var(--font-display); color: inherit; }
.bar-insight-layout { display: grid; grid-template-columns: minmax(0, .88fr) 760px; gap: 74px; align-items: center; min-height: 650px; }
.bar-insight-lead { color: var(--muted); font-size: 30px; line-height: 1.42; max-width: 760px; margin: -12px 0 0; }
.bar-stack { display: grid; gap: 30px; padding: 42px 44px; border: 1.5px solid rgba(30,43,250,.2); border-radius: 14px; background: rgba(30,43,250,.04); }
.bar-row { display: grid; grid-template-columns: minmax(0, 1fr); gap: 13px; }
.bar-label { font: 600 23px/1.18 var(--font-body); color: var(--text); }
.bar-track { height: 20px; background: rgba(30,43,250,.09); border-radius: 999px; overflow: hidden; }
.bar-track i { display: block; height: 100%; background: var(--accent); border-radius: 999px; }
.blue-tension-grid { display: grid; grid-template-columns: minmax(0, .92fr) 520px 520px; gap: 26px; align-items: stretch; min-height: 650px; }
.blue-tension-title { display: flex; flex-direction: column; justify-content: center; padding-right: 34px; }
.blue-tension-title h2 { font: 700 82px/.96 var(--font-display); letter-spacing: -.03em; margin: 0; }
.blue-tension-panel { display: flex; flex-direction: column; justify-content: flex-end; min-height: 650px; padding: 42px 40px; border: 1.5px solid rgba(30,43,250,.2); border-radius: 16px; background: rgba(30,43,250,.04); overflow: hidden; }
.blue-tension-primary { background: var(--accent); color: var(--inverse-text); }
.blue-tension-num { display: block; font: 700 74px/.8 var(--font-display); letter-spacing: -.04em; color: var(--accent); margin-bottom: 48px; }
.blue-tension-primary .blue-tension-num { color: var(--inverse-text); opacity: .68; }
.blue-tension-panel .mm-text, .blue-tension-panel .mm-bullets li { font-size: 27px; line-height: 1.34; }
.blue-tension-primary .mm-text, .blue-tension-primary .mm-bullets li { color: inherit; font-weight: 600; }
.closing-circles-slide { display: grid; place-items: center; text-align: center; }
.closing-circle { position: absolute; border: 1.5px solid rgba(30,43,250,.2); border-radius: 50%; opacity: .52; }
.closing-circle.outer { width: 620px; height: 620px; }
.closing-circle.inner { width: 430px; height: 430px; }
.closing-copy { position: relative; z-index: 1; max-width: 1040px; display: grid; justify-items: center; }
.closing-title { font: 700 86px/1 var(--font-display); margin: 0; max-width: 1040px; }
.closing-body { margin-top: 34px; max-width: 820px; color: var(--muted); }
.closing-body .mm-text, .closing-body .mm-bullets li { font-size: 28px; line-height: 1.38; }
.blue-editorial-photo-slide { padding: 0; background: var(--slide-bg); }
.blue-editorial-photo { position: absolute; inset: 0 auto 0 0; width: 1080px; margin: 0; overflow: hidden; }
.blue-editorial-photo::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, rgba(17,17,17,.08), rgba(253,250,231,.18) 54%, rgba(253,250,231,.92)); }
.blue-editorial-panel { position: absolute; right: 92px; top: 116px; width: 760px; min-height: 720px; padding: 54px 58px; background: rgba(253,250,231,.92); border: 1.5px solid rgba(30,43,250,.22); border-radius: 18px; backdrop-filter: blur(8px); }
.blue-editorial-title { font: 700 78px/.98 var(--font-display); letter-spacing: -.028em; margin: 22px 0 34px; }
.blue-editorial-body { color: var(--muted); }
.blue-editorial-body .mm-bullets { gap: 16px; }
.blue-editorial-body .mm-bullets li, .blue-editorial-body .mm-text { font-size: 28px; line-height: 1.36; }
.blue-editorial-index { position: absolute; left: 92px; bottom: 58px; padding: 14px 22px; background: var(--accent); color: var(--inverse-text); border-radius: 999px; font: 700 20px/1 var(--font-display); }
.blue-photo-band-slide { padding: 0; background: var(--slide-bg); }
.blue-photo-band { position: absolute; left: 0; right: 0; top: 0; height: 475px; margin: 0; overflow: hidden; }
.blue-photo-band::after { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(17,17,17,.05), rgba(253,250,231,.16) 48%, rgba(253,250,231,.9)); }
.blue-photo-band-copy { position: absolute; left: 92px; right: 92px; bottom: 74px; min-height: 440px; display: grid; grid-template-columns: minmax(0,.9fr) 720px; gap: 64px; align-items: end; }
.blue-photo-band-copy .slide-header { grid-column: 1 / -1; margin-bottom: 0; }
.blue-photo-band-title { font: 700 84px/.96 var(--font-display); letter-spacing: -.03em; margin: 0; max-width: 900px; }
.blue-photo-band-body { padding: 34px 38px; border: 1.5px solid rgba(30,43,250,.2); background: rgba(253,250,231,.88); border-radius: 16px; backdrop-filter: blur(7px); }
.blue-photo-band-body .mm-text, .blue-photo-band-body .mm-bullets li { font-size: 27px; line-height: 1.36; }
.progress-rule { position: absolute; left: 0; bottom: 0; height: 6px; background: var(--accent); transition: width 400ms ease; }

/* === NEO-GRID BOLD RENDERER === */
.grid-theme { background: var(--slide-bg); color: var(--text); font-family: var(--font-body); }
.ng-frame { position: absolute; inset: 40px; display: grid; grid-template-columns: repeat(12, 1fr); grid-template-rows: repeat(8, 1fr); gap: 12px; }
.ng-panel { position: relative; overflow: hidden; padding: 34px 38px; display: flex; flex-direction: column; justify-content: space-between; }
.ng-paper { background: var(--surface); color: var(--text); }
.ng-ink { background: var(--surface-alt); color: var(--inverse-text); }
.ng-lemon { background: var(--accent); color: var(--text); }
.ng-label { font: 400 22px/1 var(--font-mono); letter-spacing: .12em; text-transform: uppercase; opacity: .82; }
.ng-hero { grid-column: 1 / span 8; grid-row: 1 / span 5; }
.ng-hero-with-photo { grid-column: 1 / span 7; grid-row: 1 / span 5; }
.ng-hero h1 { font: 700 124px/.9 var(--font-display); letter-spacing: -.035em; text-transform: uppercase; margin: 0; }
.ng-hero-with-photo h1 { font: 700 104px/.9 var(--font-display); letter-spacing: -.035em; text-transform: uppercase; margin: 0; }
.ng-mark { grid-column: 9 / span 4; grid-row: 1 / span 3; align-items: flex-end; }
.ng-mark span { font: 700 250px/.78 var(--font-display); letter-spacing: -.06em; }
.ng-summary { grid-column: 1 / span 12; grid-row: 6 / span 3; }
.ng-summary-with-photo { grid-column: 1 / span 7; grid-row: 6 / span 3; }
.ng-title { grid-column: 1 / span 5; grid-row: 1 / span 4; }
.ng-title-with-photo { grid-column: 1 / span 4; grid-row: 1 / span 4; }
.ng-title h2 { font: 700 78px/.92 var(--font-display); letter-spacing: -.025em; text-transform: uppercase; margin: 22px 0 0; }
.ng-title-with-photo h2 { font: 700 64px/.94 var(--font-display); letter-spacing: -.025em; text-transform: uppercase; margin: 22px 0 0; }
.ng-body { grid-column: 6 / span 7; grid-row: 1 / span 4; }
.ng-body-with-photo { grid-column: 5 / span 4; grid-row: 1 / span 4; }
.ng-stat { grid-column: 1 / span 5; grid-row: 5 / span 4; justify-content: center; }
.ng-stat span { font: 700 190px/.85 var(--font-display); letter-spacing: -.05em; }
.ng-col-1 { grid-column: 1 / span 4; grid-row: 5 / span 4; }
.ng-col-2 { grid-column: 5 / span 4; grid-row: 5 / span 4; }
.ng-col-3 { grid-column: 9 / span 4; grid-row: 5 / span 4; }
.ng-photo { grid-column: 1 / span 7; grid-row: 1 / span 8; padding: 0; background: #111; }
.ng-hero-photo { grid-column: 8 / span 5; grid-row: 1 / span 8; }
.ng-stat-photo { grid-column: 9 / span 4; grid-row: 1 / span 8; }
.ng-side-photo { grid-column: 9 / span 4; grid-row: 1 / span 4; }
.ng-section-num { grid-column: 1 / span 5; grid-row: 1 / span 8; justify-content: center; }
.ng-section-num span { font: 700 320px/.8 var(--font-display); letter-spacing: -.06em; }
.ng-section-title { grid-column: 6 / span 7; grid-row: 1 / span 4; }
.ng-section-title h1 { font: 700 98px/.9 var(--font-display); text-transform: uppercase; letter-spacing: -.035em; margin: 0; }
.ng-section-copy { grid-column: 6 / span 5; grid-row: 5 / span 4; }
.ng-qr-tile { grid-column: 11 / span 2; grid-row: 5 / span 4; display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; align-content: center; }
.ng-qr-tile i { display: block; aspect-ratio: 1; background: var(--text); }
.ng-page-lemon { background: var(--accent); }
.ng-photo-strip-main { grid-column: 1 / span 5; grid-row: 1 / span 8; }
.ng-photo-strip-title { grid-column: 6 / span 7; grid-row: 1 / span 3; }
.ng-photo-strip-title h2 { font: 700 76px/.92 var(--font-display); text-transform: uppercase; letter-spacing: -.03em; margin: 16px 0 0; }
.ng-photo-strip-card-1 { grid-column: 6 / span 3; grid-row: 4 / span 5; }
.ng-photo-strip-card-2 { grid-column: 9 / span 4; grid-row: 4 / span 2; }
.ng-photo-strip-card-3 { grid-column: 9 / span 4; grid-row: 6 / span 3; }
.ng-poster-title { grid-column: 1 / span 6; grid-row: 1 / span 3; }
.ng-poster-title h2 { font: 700 74px/.94 var(--font-display); text-transform: uppercase; letter-spacing: -.03em; margin: 0; }
.ng-poster-card-1 { grid-column: 7 / span 3; grid-row: 1 / span 3; }
.ng-poster-card-2 { grid-column: 10 / span 3; grid-row: 1 / span 3; }
.ng-poster-card-3 { grid-column: 1 / span 4; grid-row: 4 / span 3; }
.ng-poster-card-4 { grid-column: 5 / span 4; grid-row: 4 / span 3; }
.ng-poster-card-5 { grid-column: 9 / span 4; grid-row: 4 / span 3; }
.ng-poster-card-6 { grid-column: 1 / span 12; grid-row: 7 / span 2; }
.ng-wall-stat { grid-column: 1 / span 5; grid-row: 1 / span 5; justify-content: center; }
.ng-wall-stat span { font: 700 220px/.78 var(--font-display); }
.ng-wall-stat p { margin: 30px 0 0; font: 700 38px/1.06 var(--font-display); text-transform: uppercase; }
.ng-wall-title { grid-column: 6 / span 7; grid-row: 1 / span 3; }
.ng-wall-title h2 { font: 700 78px/.92 var(--font-display); text-transform: uppercase; margin: 0; }
.ng-wall-card-1 { grid-column: 6 / span 3; grid-row: 4 / span 2; }
.ng-wall-card-2 { grid-column: 9 / span 4; grid-row: 4 / span 2; }
.ng-wall-card-3 { grid-column: 1 / span 5; grid-row: 6 / span 3; }
.ng-wall-card-4 { grid-column: 6 / span 3; grid-row: 6 / span 3; }
.ng-wall-card-5 { grid-column: 9 / span 4; grid-row: 6 / span 3; }
.ng-process-title { grid-column: 1 / span 5; grid-row: 1 / span 3; }
.ng-process-title h2 { font: 700 76px/.94 var(--font-display); text-transform: uppercase; margin: 0; }
.ng-process-card-1 { grid-column: 1 / span 3; grid-row: 4 / span 5; }
.ng-process-card-2 { grid-column: 4 / span 3; grid-row: 3 / span 4; }
.ng-process-card-3 { grid-column: 7 / span 3; grid-row: 4 / span 5; }
.ng-process-card-4 { grid-column: 10 / span 3; grid-row: 2 / span 5; }
.ng-process-num { font: 700 92px/.8 var(--font-display); }
.ng-arrow { position: absolute; font: 700 72px/1 var(--font-display); color: var(--text); opacity: .82; }
.ng-arrow-1 { left: 470px; top: 610px; }
.ng-arrow-2 { left: 940px; top: 500px; }
.ng-arrow-3 { left: 1400px; top: 580px; }
.ng-matrix-title { grid-column: 1 / span 4; grid-row: 1 / span 3; }
.ng-matrix-title h2 { font: 700 70px/.94 var(--font-display); text-transform: uppercase; margin: 0; }
.ng-matrix-cell-1 { grid-column: 5 / span 4; grid-row: 1 / span 2; }
.ng-matrix-cell-2 { grid-column: 9 / span 4; grid-row: 1 / span 2; }
.ng-matrix-cell-3 { grid-column: 1 / span 4; grid-row: 4 / span 2; }
.ng-matrix-cell-4 { grid-column: 5 / span 4; grid-row: 3 / span 3; }
.ng-matrix-cell-5 { grid-column: 9 / span 4; grid-row: 3 / span 3; }
.ng-matrix-cell-6 { grid-column: 1 / span 12; grid-row: 6 / span 3; }
.ng-billboard-photo { grid-column: 1 / span 8; grid-row: 1 / span 8; }
.ng-billboard-title { grid-column: 7 / span 6; grid-row: 1 / span 3; z-index: 2; }
.ng-billboard-title h2 { font: 700 84px/.9 var(--font-display); text-transform: uppercase; letter-spacing: -.035em; margin: 18px 0 0; }
.ng-billboard-card-1 { grid-column: 9 / span 4; grid-row: 4 / span 2; z-index: 2; }
.ng-billboard-card-2 { grid-column: 7 / span 3; grid-row: 6 / span 3; z-index: 2; }
.ng-billboard-card-3 { grid-column: 10 / span 3; grid-row: 6 / span 3; z-index: 2; }
.ng-manifesto-num { grid-column: 1 / span 4; grid-row: 1 / span 8; justify-content: center; }
.ng-manifesto-num span { font: 700 300px/.78 var(--font-display); letter-spacing: -.07em; }
.ng-manifesto-title { grid-column: 5 / span 8; grid-row: 1 / span 4; }
.ng-manifesto-title h2 { font: 700 104px/.88 var(--font-display); text-transform: uppercase; letter-spacing: -.04em; margin: 0; }
.ng-manifesto-card-1 { grid-column: 5 / span 4; grid-row: 5 / span 2; }
.ng-manifesto-card-2 { grid-column: 9 / span 4; grid-row: 5 / span 2; }
.ng-manifesto-card-3 { grid-column: 5 / span 3; grid-row: 7 / span 2; }
.ng-manifesto-card-4 { grid-column: 8 / span 5; grid-row: 7 / span 2; }
.grid-theme .card-num { display: block; font: 400 18px/1 var(--font-mono); letter-spacing: .12em; margin-bottom: 20px; }
.ng-corner-mark { position: absolute; top: 72px; right: 72px; width: 44px; height: 44px; display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
.ng-corner-mark::before, .ng-corner-mark::after { content: ""; background: currentColor; box-shadow: 24px 24px 0 currentColor; }
.ng-page { position: absolute; left: 40px; bottom: 40px; background: var(--surface); color: var(--text); padding: 16px 24px; font: 400 24px var(--font-mono); letter-spacing: .04em; }
.ng-page-invert { background: var(--surface-alt); color: var(--inverse-text); }
.grid-theme .mm-bullets li { font-size: 26px; line-height: 1.28; }
.grid-theme .mm-bullets li::before { background: var(--text); }
.grid-theme .mm-subhead { text-transform: uppercase; font-size: 32px; }

/* === SIGNAL RENDERER === */
.signal-theme { color: var(--text); font-family: var(--font-body); padding: 92px 136px; }
.surface-dark { background: var(--slide-bg); color: var(--text); --signal-border: var(--border); --signal-muted: var(--muted); }
.surface-light { background: var(--surface); color: var(--inverse-text); --signal-border: #CAC4B4; --signal-muted: #5A6270; }
.signal-texture { position: absolute; inset: 0; pointer-events: none; opacity: .4; background-image: linear-gradient(rgba(255,255,255,.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.03) 1px, transparent 1px); background-size: 80px 80px; }
.surface-light .signal-texture { display: none; }
.signal-center { position: relative; max-width: 1280px; margin-top: 160px; }
.signal-cover-with-image .signal-center { max-width: 940px; margin-top: 118px; }
.signal-cover-image { position: absolute; right: 0; top: 0; width: 760px; height: 100%; margin: 0; opacity: .72; overflow: hidden; }
.signal-cover-image::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, var(--slide-bg), rgba(28,38,68,.55) 42%, rgba(28,38,68,.08)); }
.signal-cover-image img { width: 100%; height: 100%; object-fit: cover; display: block; filter: saturate(.82) contrast(1.05); }
.signal-kicker { display: inline-block; font: 500 20px/1 var(--font-mono); letter-spacing: .16em; text-transform: uppercase; color: var(--accent); margin-bottom: 22px; }
.signal-rule { width: 52px; height: 2px; background: var(--accent); margin: 0 0 34px; }
.signal-display { font: 700 132px/.92 var(--font-display); letter-spacing: -.025em; max-width: 1280px; margin: 0; }
.signal-cover-with-image .signal-display { font-size: 112px; max-width: 900px; }
.signal-lead { max-width: 820px; font-size: 32px; line-height: 1.52; color: var(--signal-muted); margin: 36px 0 0; }
.signal-footer { position: absolute; left: 136px; right: 136px; bottom: 58px; display: flex; justify-content: space-between; border-top: 1px solid var(--signal-border); padding-top: 18px; color: var(--signal-muted); font: 500 18px var(--font-mono); letter-spacing: .12em; text-transform: uppercase; }
.signal-chrome { position: relative; z-index: 1; display: flex; justify-content: space-between; border-bottom: 1px solid var(--signal-border); padding-bottom: 18px; color: var(--signal-muted); font: 500 18px var(--font-mono); letter-spacing: .14em; text-transform: uppercase; }
.signal-layout { position: relative; z-index: 1; display: grid; grid-template-columns: minmax(0, 1fr); gap: 56px; margin-top: 70px; }
.signal-layout.with-image { grid-template-columns: minmax(0, .95fr) 660px; align-items: stretch; }
.signal-title { font: 600 76px/1.08 var(--font-display); letter-spacing: -.015em; max-width: 980px; margin: 0 0 44px; }
.signal-body { color: var(--signal-muted); }
.signal-body .mm-bullets li { font-size: 29px; line-height: 1.46; padding-left: 42px; }
.signal-body .mm-bullets li::before { content: "—"; top: 0; width: auto; height: auto; background: transparent; color: var(--accent); font-family: var(--font-mono); }
.signal-image { margin: 0; border-top: 1px solid var(--signal-border); border-bottom: 1px solid var(--signal-border); min-height: 560px; overflow: hidden; }
.signal-quote { position: relative; z-index: 1; margin: 142px 70px; max-width: 1350px; }
.signal-quote-with-image .signal-quote { max-width: 840px; margin-top: 132px; }
.signal-quote-image { position: absolute; right: 136px; top: 178px; width: 580px; height: 650px; margin: 0; overflow: hidden; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
.signal-quote-image img { width: 100%; height: 100%; object-fit: cover; display: block; filter: saturate(.85); }
.signal-quote blockquote { font: 400 76px/1.18 var(--font-display); letter-spacing: -.015em; margin: 0; }
.signal-quote-with-image .signal-quote blockquote { font-size: 66px; }
.signal-cite { color: var(--signal-muted); font: 500 20px var(--font-mono); letter-spacing: .12em; text-transform: uppercase; margin-top: 34px; }
.signal-stat { position: relative; z-index: 1; display: grid; grid-template-columns: 560px 1fr; gap: 70px; margin-top: 86px; align-items: start; }
.signal-stat.with-image { grid-template-columns: 440px minmax(0, 1fr) 520px; gap: 46px; }
.signal-stat-value { display: block; font: 600 132px/.9 var(--font-display); color: var(--accent); letter-spacing: -.035em; margin-bottom: 24px; }
.signal-stat.with-image .signal-stat-value { font-size: 112px; }
.signal-stat-image { margin: 0; min-height: 600px; overflow: hidden; border-top: 1px solid var(--signal-border); border-bottom: 1px solid var(--signal-border); }
.signal-stat-image img { width: 100%; height: 100%; object-fit: cover; display: block; }
.signal-timeline { position: relative; z-index: 1; display: grid; grid-template-columns: 640px minmax(0, 1fr); gap: 82px; margin-top: 72px; }
.signal-spine-list { position: relative; display: grid; gap: 28px; padding-left: 42px; border-left: 1px solid var(--signal-border); }
.signal-spine-item { position: relative; display: grid; grid-template-columns: 70px minmax(0, 1fr); gap: 22px; padding-bottom: 24px; }
.signal-spine-item::before { content: ""; position: absolute; left: -47px; top: 8px; width: 11px; height: 11px; border-radius: 50%; background: var(--accent); }
.signal-spine-index, .signal-card-num { color: var(--accent); font: 500 20px/1 var(--font-mono); letter-spacing: .12em; }
.signal-briefing { position: relative; z-index: 1; display: grid; grid-template-columns: 520px minmax(0, 1fr); gap: 70px; margin-top: 72px; }
.signal-card-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 26px 34px; }
.signal-card { border-top: 1px solid var(--signal-border); padding-top: 24px; min-height: 170px; }
.signal-card .mm-bullets li, .signal-card .mm-text, .signal-spine-item .mm-bullets li, .signal-spine-item .mm-text { font-size: 25px; line-height: 1.42; }
.signal-editorial-split { position: relative; z-index: 1; display: grid; grid-template-columns: minmax(0, .95fr) 620px; gap: 80px; margin-top: 78px; }
.signal-lead-block { border-top: 1px solid var(--signal-border); padding-top: 34px; margin-top: 34px; }
.signal-lead-block .mm-text, .signal-lead-block .mm-bullets li { font: 400 38px/1.32 var(--font-display); color: inherit; }
.signal-editorial-side { border-left: 1px solid var(--signal-border); padding-left: 44px; color: var(--signal-muted); }
.signal-statement { position: relative; z-index: 1; max-width: 1280px; margin: 150px auto 0; text-align: center; display: grid; justify-items: center; }
.signal-statement-title { font: 600 104px/1.02 var(--font-display); margin: 0; max-width: 1220px; }
.signal-statement-lead { margin-top: 42px; max-width: 880px; color: var(--signal-muted); }
.signal-statement-lead .mm-text, .signal-statement-lead .mm-bullets li { font-size: 30px; line-height: 1.48; }
.signal-columns-layout { position: relative; z-index: 1; display: grid; grid-template-columns: 510px minmax(0, 1fr); gap: 72px; margin-top: 78px; }
.signal-columns { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-top: 1px solid var(--signal-border); border-bottom: 1px solid var(--signal-border); }
.signal-column { min-height: 520px; padding: 30px 30px 24px; border-left: 1px solid var(--signal-border); color: var(--signal-muted); }
.signal-column:first-child { border-left: 0; }
.signal-column .mm-bullets li, .signal-column .mm-text { font-size: 25px; line-height: 1.44; }
.signal-compare-layout { position: relative; z-index: 1; display: grid; grid-template-columns: 560px minmax(0, 1fr); gap: 74px; margin-top: 78px; }
.signal-compare-panels { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border-top: 1px solid var(--signal-border); border-bottom: 1px solid var(--signal-border); }
.signal-compare-panel { min-height: 560px; padding: 34px 42px; color: var(--signal-muted); }
.signal-compare-panel + .signal-compare-panel { border-left: 1px solid var(--signal-border); }
.signal-compare-panel .mm-bullets li, .signal-compare-panel .mm-text { font-size: 28px; line-height: 1.44; }
.signal-ledger-layout { position: relative; z-index: 1; display: grid; grid-template-columns: 560px minmax(0, 1fr); gap: 72px; margin-top: 78px; }
.signal-ledger-list { border-top: 1px solid var(--signal-border); }
.signal-ledger-row { display: grid; grid-template-columns: 82px minmax(0, 1fr); gap: 28px; padding: 25px 0; border-bottom: 1px solid var(--signal-border); color: var(--signal-muted); }
.signal-ledger-row .mm-bullets li, .signal-ledger-row .mm-text { font-size: 27px; line-height: 1.42; }
.signal-ledger-row .mm-bullets { gap: 10px; }
.signal-photo-essay-slide { padding: 92px 136px; }
.signal-photo-essay-image { position: absolute; right: 136px; top: 168px; bottom: 132px; width: 760px; margin: 0; overflow: hidden; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
.signal-photo-essay-image::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, rgba(28,38,68,.18), rgba(28,38,68,.02)); }
.signal-photo-essay-copy { position: relative; z-index: 1; width: 820px; margin-top: 78px; }
.signal-photo-essay-title { font: 600 86px/1.04 var(--font-display); letter-spacing: -.018em; margin: 0 0 40px; }
.signal-photo-essay-body { max-width: 720px; color: var(--signal-muted); border-top: 1px solid var(--signal-border); padding-top: 34px; }
.signal-photo-essay-body .mm-bullets li, .signal-photo-essay-body .mm-text { font-size: 29px; line-height: 1.5; }
.signal-dossier-slide { padding: 0; background: var(--surface); color: var(--inverse-text); }
.signal-dossier-image { position: absolute; left: 0; top: 0; bottom: 0; width: 820px; margin: 0; overflow: hidden; }
.signal-dossier-image::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, rgba(240,236,227,.03), rgba(240,236,227,.44)); }
.signal-dossier-copy { position: absolute; left: 900px; right: 136px; top: 92px; bottom: 72px; display: flex; flex-direction: column; justify-content: center; }
.signal-dossier-copy .signal-chrome { position: absolute; left: 0; right: 0; top: 0; }
.signal-dossier-title { font: 600 82px/1.04 var(--font-display); letter-spacing: -.018em; margin: 72px 0 34px; }
.signal-dossier-body { border-top: 1px solid var(--signal-border); padding-top: 34px; color: var(--signal-muted); }
.signal-dossier-body .mm-text, .signal-dossier-body .mm-bullets li { font-size: 28px; line-height: 1.5; }

/* === HTML SOURCE NOTICE === */
.source-notice { display: none; }`;
}

function controllerJs(editable: boolean): string {
  return `/* === SLIDE PRESENTATION CONTROLLER === */
class SlidePresentation {
  constructor() {
    this.slides = Array.from(document.querySelectorAll('.slide'));
    this.stage = document.getElementById('deckStage');
    this.current = 0;
    this.wheelLocked = false;
    this.touchStartX = 0;
    this.setupStageScale();
    this.setupKeyboardNav();
    this.setupWheelNav();
    this.setupTouchNav();
    this.setupButtons();
    this.setupFullscreen();
    ${editable ? 'this.setupEditing();' : ''}
    this.show(0);
  }
  setupStageScale() {
    const scale = () => {
      const factor = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
      const x = (window.innerWidth - 1920 * factor) / 2;
      const y = (window.innerHeight - 1080 * factor) / 2;
      this.stage.style.transform = 'translate(' + x + 'px, ' + y + 'px) scale(' + factor + ')';
    };
    scale();
    window.addEventListener('resize', scale);
  }
  setupKeyboardNav() {
    document.addEventListener('keydown', (event) => {
      const target = event.target;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
        event.preventDefault();
        this.next();
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        this.prev();
      } else if (event.key === 'Home') {
        event.preventDefault();
        this.show(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        this.show(this.slides.length - 1);
      }
    });
  }
  setupWheelNav() {
    window.addEventListener('wheel', (event) => {
      if (Math.abs(event.deltaY) < 24 || this.wheelLocked) return;
      this.wheelLocked = true;
      if (event.deltaY > 0) this.next();
      else this.prev();
      window.setTimeout(() => { this.wheelLocked = false; }, 520);
    }, { passive: true });
  }
  setupTouchNav() {
    window.addEventListener('touchstart', (event) => {
      this.touchStartX = event.changedTouches[0]?.clientX || 0;
    }, { passive: true });
    window.addEventListener('touchend', (event) => {
      const endX = event.changedTouches[0]?.clientX || 0;
      const dx = endX - this.touchStartX;
      if (Math.abs(dx) < 50) return;
      if (dx < 0) this.next();
      else this.prev();
    }, { passive: true });
  }
  setupButtons() {
    document.getElementById('prevSlide')?.addEventListener('click', () => this.prev());
    document.getElementById('nextSlide')?.addEventListener('click', () => this.next());
  }
  setupFullscreen() {
    const button = document.getElementById('fullscreenToggle');
    const root = document.documentElement;
    const getFullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
    const update = () => {
      const active = Boolean(getFullscreenElement());
      document.body.classList.toggle('is-fullscreen', active);
      button?.setAttribute('aria-pressed', active ? 'true' : 'false');
      button?.setAttribute('aria-label', active ? '전체 화면 종료' : '전체 화면');
      button?.setAttribute('title', active ? '전체 화면 종료 (F)' : '전체 화면 (F)');
    };
    const request = () => {
      if (root.requestFullscreen) {
        try {
          return root.requestFullscreen({ navigationUI: 'hide' });
        } catch (_err) {
          return root.requestFullscreen();
        }
      }
      if (root.webkitRequestFullscreen) return root.webkitRequestFullscreen();
      return Promise.resolve();
    };
    const exit = () => {
      if (document.exitFullscreen) return document.exitFullscreen();
      if (document.webkitExitFullscreen) return document.webkitExitFullscreen();
      return Promise.resolve();
    };
    const toggle = () => {
      const result = getFullscreenElement() ? exit() : request();
      if (result && typeof result.catch === 'function') {
        result.catch((err) => console.warn('[slides] fullscreen failed:', err));
      }
    };
    button?.addEventListener('click', toggle);
    document.addEventListener('fullscreenchange', update);
    document.addEventListener('webkitfullscreenchange', update);
    document.addEventListener('keydown', (event) => {
      const target = event.target;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'f' || event.key === 'F') {
        event.preventDefault();
        toggle();
      }
    });
    update();
  }
  setupEditing() {
    const toggle = document.getElementById('editToggle');
    const hotzone = document.querySelector('.edit-hotzone');
    let hideTimer = null;
    const setVisible = (visible) => toggle?.classList.toggle('show', visible);
    const setEditing = () => {
      const active = !document.body.classList.contains('editing');
      document.body.classList.toggle('editing', active);
      toggle?.classList.toggle('active', active);
      document.querySelectorAll('.editable').forEach((el) => {
        if (active) el.setAttribute('contenteditable', 'true');
        else el.removeAttribute('contenteditable');
      });
    };
    toggle?.addEventListener('click', setEditing);
    hotzone?.addEventListener('mouseenter', () => {
      clearTimeout(hideTimer);
      setVisible(true);
    });
    hotzone?.addEventListener('mouseleave', () => {
      hideTimer = window.setTimeout(() => {
        if (!document.body.classList.contains('editing')) setVisible(false);
      }, 400);
    });
    toggle?.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    toggle?.addEventListener('mouseleave', () => {
      hideTimer = window.setTimeout(() => {
        if (!document.body.classList.contains('editing')) setVisible(false);
      }, 400);
    });
    document.addEventListener('keydown', (event) => {
      const target = event.target;
      if ((event.key === 'e' || event.key === 'E') && !(target && target.isContentEditable)) setEditing();
    });
  }
  show(index) {
    this.current = Math.max(0, Math.min(index, this.slides.length - 1));
    this.slides.forEach((slide, i) => {
      slide.classList.toggle('active', i === this.current);
      slide.classList.toggle('visible', i === this.current);
    });
    const current = document.getElementById('currentSlide');
    const total = document.getElementById('totalSlides');
    if (current) current.textContent = String(this.current + 1);
    if (total) total.textContent = String(this.slides.length);
    history.replaceState(null, '', '#' + (this.current + 1));
  }
  next() { this.show(this.current + 1); }
  prev() { this.show(this.current - 1); }
}
new SlidePresentation();`;
}

export async function buildHtmlSlides(slides: Slide[], options: BuildHtmlSlidesOptions = {}): Promise<string> {
  const theme = options.theme ?? DEFAULT_HTML_SLIDE_THEME;
  const directedSlides = directHtmlSlides(slides, theme);
  const title = options.title?.trim() || directedSlides[0]?.title || 'MarkMind Slides';
  const renderedSlides = await Promise.all(
    directedSlides.map((slide, index) => renderSlide(slide, index, directedSlides.length, theme, options.baseDir)),
  );
  const notes = directedSlides.map((slide, index) => ({ index, title: slide.title, notes: slide.notes ?? '' }));
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  ${theme.fontLinks.map((href) => `<link rel="stylesheet" href="${attr(href)}">`).join('\n  ')}
  <style>
${viewportBaseCss()}

${themeCss(theme, options.fontFamily, options.transition)}
  </style>
</head>
<body>
  <div class="deck-viewport">
    <main class="deck-stage" id="deckStage" aria-label="${attr(title)}">
${renderedSlides.join('\n')}
    </main>
  </div>
  <nav class="deck-controls" aria-label="Slide controls">
    <button type="button" id="prevSlide" aria-label="Previous slide">‹</button>
    <span class="deck-count"><span id="currentSlide">1</span> / <span id="totalSlides">${directedSlides.length}</span></span>
    <button type="button" id="nextSlide" aria-label="Next slide">›</button>
    <button type="button" id="fullscreenToggle" class="fullscreen-button" aria-label="전체 화면" aria-pressed="false" title="전체 화면 (F)">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M8 3H3v5"></path>
        <path d="M16 3h5v5"></path>
        <path d="M8 21H3v-5"></path>
        <path d="M21 16v5h-5"></path>
      </svg>
    </button>
  </nav>
  ${options.editable === false ? '' : '<div class="edit-hotzone" aria-hidden="true"></div><button class="edit-toggle" id="editToggle" type="button">Edit</button>'}
  <script type="application/json" id="speaker-notes">${escapeJsonScript(notes)}</script>
  <script>
${controllerJs(options.editable !== false)}
  </script>
  <div class="source-notice">Design runtime follows fixed-stage HTML slide principles from zarazhangrui/frontend-slides and selected MIT template recipes from zarazhangrui/beautiful-html-templates.</div>
</body>
</html>`;
}
