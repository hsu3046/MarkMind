export const PPTX_MAX_SLIDES = 32;

export const PPTX_MAX_STOCK_IMAGE_ASSETS = {
  sourceOnly: 0,
  needed: 6,
  active: 18,
} as const;

export const PPTX_MAX_GENERATED_IMAGE_ASSETS = {
  sourceOnly: 0,
  needed: 3,
  active: 8,
} as const;

export function slideImagePolicyMode(policy?: string): 'sourceOnly' | 'needed' | 'active' {
  const p = (policy ?? '').toLowerCase();
  if (p.includes('source images only') || p.includes('do not add')) return 'sourceOnly';
  if (p.includes('actively') || p.includes('cover, section')) return 'active';
  return 'needed';
}

export function stockImageLimitForPolicy(policy?: string): number {
  return PPTX_MAX_STOCK_IMAGE_ASSETS[slideImagePolicyMode(policy)];
}

export function generatedImageLimitForPolicy(policy?: string): number {
  return PPTX_MAX_GENERATED_IMAGE_ASSETS[slideImagePolicyMode(policy)];
}

export function clampSlideCountValue(value: unknown, max = PPTX_MAX_SLIDES): number | undefined {
  const raw = typeof value === 'number' ? String(value) : typeof value === 'string' ? value : '';
  const match = raw.match(/\d+/);
  if (!match) return undefined;
  const parsed = Number.parseInt(match[0], 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.min(max, parsed);
}

const HR_RE = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const FENCE_RE = /^\s*(```|~~~)/;

export function clampMarkdownSlideDraft(
  markdown: string,
  max = PPTX_MAX_SLIDES,
): { markdown: string; originalCount: number; clamped: boolean } {
  const lines = markdown.split('\n');
  const slides: string[][] = [[]];
  let fence: string | null = null;

  for (const line of lines) {
    const fenceMatch = line.match(FENCE_RE);
    if (fenceMatch) {
      fence = fence === fenceMatch[1] ? null : fence ?? fenceMatch[1];
    }
    if (!fence && HR_RE.test(line)) {
      slides.push([]);
      continue;
    }
    slides[slides.length - 1].push(line);
  }

  const meaningful = slides.filter((slide) => slide.join('\n').trim().length > 0);
  if (meaningful.length <= max) {
    return { markdown, originalCount: meaningful.length, clamped: false };
  }
  return {
    markdown: meaningful
      .slice(0, max)
      .map((slide) => slide.join('\n').trim())
      .join('\n\n---\n\n'),
    originalCount: meaningful.length,
    clamped: true,
  };
}
