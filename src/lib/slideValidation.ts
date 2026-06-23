import type { Slide, SlideBlock } from './markdownToSlides';

export type SlideIssueSeverity = 'info' | 'warning' | 'critical';

export interface SlideIssue {
  slideIndex: number;
  slideNumber: number;
  severity: SlideIssueSeverity;
  code: string;
  message: string;
}

export interface SlideValidationReport {
  issues: SlideIssue[];
  hasCritical: boolean;
  warnings: number;
}

const LIMITS = {
  titleChars: 86,
  coverTitleChars: 72,
  bodyChars: 820,
  bulletCount: 7,
  bulletChars: 118,
  simpleBlockCount: 9,
  splitChars: 760,
  splitBlocks: 8,
  quoteChars: 240,
  tableRows: 7,
  tableCols: 5,
  codeLines: 14,
  columnBlocks: 6,
};

function blockText(block: SlideBlock): string {
  if (block.kind === 'text' || block.kind === 'bullet') {
    return block.spans.map((span) => span.text).join('');
  }
  if (block.kind === 'subhead' || block.kind === 'code') return block.text;
  if (block.kind === 'image') return block.alt || block.src;
  return block.rows.map((row) => row.join(' ')).join(' ');
}

function countBullets(blocks: SlideBlock[]): number {
  return blocks.filter((block) => block.kind === 'bullet').length;
}

function countChars(blocks: SlideBlock[]): number {
  return blocks.reduce((sum, block) => sum + blockText(block).length, 0);
}

function isSimpleTextBlock(block: SlideBlock): boolean {
  return block.kind === 'text' || block.kind === 'bullet' || block.kind === 'subhead';
}

function canSplitSlide(slide: Slide): boolean {
  if (slide.layout === 'title' || slide.layout === 'section' || slide.layout === 'quote' || slide.layout === 'stat') {
    return false;
  }
  if (slide.columns?.length) return false;
  return slide.body.length > 0 && slide.body.every(isSimpleTextBlock);
}

function shouldSplitSlide(slide: Slide): boolean {
  if (!canSplitSlide(slide)) return false;
  return (
    slide.body.length > LIMITS.simpleBlockCount ||
    countBullets(slide.body) > LIMITS.bulletCount ||
    countChars(slide.body) > LIMITS.bodyChars
  );
}

function splitBlocks(blocks: SlideBlock[]): SlideBlock[][] {
  const chunks: SlideBlock[][] = [];
  let current: SlideBlock[] = [];
  let currentChars = 0;

  const flush = () => {
    if (current.length === 0) return;
    chunks.push(current);
    current = [];
    currentChars = 0;
  };

  for (const block of blocks) {
    const blockChars = Math.max(1, blockText(block).length);
    const tooManyBlocks = current.length >= LIMITS.splitBlocks;
    const tooManyChars = current.length > 0 && currentChars + blockChars > LIMITS.splitChars;
    if (tooManyBlocks || tooManyChars) flush();
    current.push(block);
    currentChars += blockChars;
  }

  flush();
  return chunks.length > 0 ? chunks : [blocks];
}

function repairLayout(slide: Slide): Slide {
  if (slide.layout === 'stat' && !slide.stat) return { ...slide, layout: 'content' };
  if (slide.layout === 'quote' && !slide.quote && countChars(slide.body) > LIMITS.quoteChars) {
    return { ...slide, layout: 'content' };
  }
  return slide;
}

function splitSlide(slide: Slide): Slide[] {
  if (!shouldSplitSlide(slide)) return [slide];
  const chunks = splitBlocks(slide.body);
  if (chunks.length <= 1) return [slide];

  return chunks.map((body, chunkIndex) => ({
    ...slide,
    title: chunkIndex === 0 ? slide.title : `${slide.title || 'Continued'} (${chunkIndex + 1}/${chunks.length})`,
    layout: 'content',
    body,
    image: chunkIndex === 0 ? slide.image : undefined,
    notes: chunkIndex === 0 ? slide.notes : undefined,
  }));
}

export function normalizeSlidesForPptx(slides: Slide[]): Slide[] {
  return slides.flatMap((slide) => splitSlide(repairLayout(slide)));
}

function addIssue(issues: SlideIssue[], slideIndex: number, severity: SlideIssueSeverity, code: string, message: string) {
  issues.push({
    slideIndex,
    slideNumber: slideIndex + 1,
    severity,
    code,
    message,
  });
}

function validateBlocks(issues: SlideIssue[], slideIndex: number, blocks: SlideBlock[]) {
  const bulletCount = countBullets(blocks);
  const bodyChars = countChars(blocks);

  if (bulletCount > LIMITS.bulletCount) {
    addIssue(issues, slideIndex, 'warning', 'dense-bullets', `Has ${bulletCount} bullets; split or compress.`);
  }
  if (bodyChars > LIMITS.bodyChars) {
    addIssue(issues, slideIndex, 'warning', 'dense-copy', `Has about ${bodyChars} text characters; may crowd the slide.`);
  }

  for (const block of blocks) {
    if (block.kind === 'bullet' && blockText(block).length > LIMITS.bulletChars) {
      addIssue(issues, slideIndex, 'warning', 'long-bullet', 'A bullet is too long for a presentation slot.');
    } else if (block.kind === 'table') {
      const cols = Math.max(0, ...block.rows.map((row) => row.length));
      if (block.rows.length > LIMITS.tableRows || cols > LIMITS.tableCols) {
        addIssue(issues, slideIndex, 'warning', 'large-table', 'Table is larger than the PPTX layout can comfortably render.');
      }
    } else if (block.kind === 'code' && block.text.split('\n').length > LIMITS.codeLines) {
      addIssue(issues, slideIndex, 'warning', 'long-code', 'Code block is too long for one slide.');
    }
  }
}

export function validateSlideDeck(slides: Slide[]): SlideValidationReport {
  const issues: SlideIssue[] = [];
  const deckUsesSourceIds = slides.some((slide) => slide.sourceIds && slide.sourceIds.length > 0);

  slides.forEach((slide, slideIndex) => {
    const titleLimit = slide.layout === 'title' ? LIMITS.coverTitleChars : LIMITS.titleChars;
    if (!slide.title.trim() && slide.body.length === 0 && !slide.quote && !slide.stat && !slide.image) {
      addIssue(issues, slideIndex, 'critical', 'empty-slide', 'Slide has no visible content.');
    }
    if (slide.title.length > titleLimit) {
      addIssue(issues, slideIndex, 'warning', 'long-title', 'Title is longer than the layout capacity.');
    }
    if (deckUsesSourceIds && slide.layout !== 'title' && slide.layout !== 'section' && !slide.sourceIds?.length) {
      addIssue(issues, slideIndex, 'info', 'missing-source-ids', 'Slide has no sourceIds from the source map.');
    }

    if (slide.layout === 'stat' && !slide.stat) {
      addIssue(issues, slideIndex, 'warning', 'stat-without-value', 'Stat layout needs a single headline number.');
    }
    if (slide.layout === 'quote') {
      const quoteText = slide.quote?.text ?? '';
      if (quoteText.length > LIMITS.quoteChars) {
        addIssue(issues, slideIndex, 'warning', 'long-quote', 'Quote is too long for a quote layout.');
      }
    }
    if ((slide.layout === 'two-column' || slide.layout === 'comparison') && slide.columns?.length) {
      slide.columns.forEach((column) => {
        if (column.length > LIMITS.columnBlocks || countChars(column) > LIMITS.splitChars) {
          addIssue(issues, slideIndex, 'warning', 'dense-column', 'A column has more content than its visual capacity.');
        }
      });
    }

    validateBlocks(issues, slideIndex, slide.body);
  });

  return {
    issues,
    hasCritical: issues.some((issue) => issue.severity === 'critical'),
    warnings: issues.filter((issue) => issue.severity === 'warning').length,
  };
}

export function summarizeSlideIssues(report: SlideValidationReport, limit = 6): string {
  if (report.issues.length === 0) return '';
  const shown = report.issues
    .slice(0, limit)
    .map((issue) => `Slide ${issue.slideNumber}: ${issue.code} - ${issue.message}`);
  const hidden = report.issues.length - shown.length;
  if (hidden > 0) shown.push(`...and ${hidden} more issue${hidden === 1 ? '' : 's'}.`);
  return shown.join('\n');
}
