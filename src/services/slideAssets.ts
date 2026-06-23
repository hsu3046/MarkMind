import type { Slide, SlideImageLicenseStrictness, SlideImageRole, SlideImageSourcePreference } from '../lib/markdownToSlides';
import type { SlideExportOptions, SlideTheme } from '../lib/slideTheme';
import {
  generatedImageLimitForPolicy,
  slideImagePolicyMode,
  stockImageLimitForPolicy,
} from '../lib/slideLimits';
import { getImageAIModelSelection } from './aiModelConfig';
import { generateImage, humanizeImageGenError, type ImageProvider } from './imageGen';
import { isTauri } from './platform';

type AssetProvider = 'openverse' | 'wikimedia' | 'openai' | 'gemini' | 'grok';

export interface SlideImageIntent {
  slideIndex: number;
  slideId: string;
  title: string;
  role: SlideImageRole;
  query?: string;
  entity?: string;
  prompt?: string;
  aspect: string;
  style?: string;
  sourcePreference: SlideImageSourcePreference;
  licenseStrictness: SlideImageLicenseStrictness;
}

export interface ResolvedSlideAsset {
  dataUrl: string;
  provider: AssetProvider;
  sourceUrl?: string;
  attribution?: string;
  license?: string;
  width?: number;
  height?: number;
}

export interface SlideAssetResolutionSummary {
  requested: number;
  resolved: number;
  stockResolved: number;
  generatedResolved: number;
  failed: number;
  skipped: number;
}

export interface ResolveSlideAssetsOptions {
  theme?: SlideTheme;
  onProgress?: (step: string, detail?: string, stepId?: string) => void;
}

const STOCK_CONCURRENCY = 4;
const GENERATED_CONCURRENCY = 2;

function blockTextLength(block: Slide['body'][number]): number {
  if (block.kind === 'bullet' || block.kind === 'text') return block.spans.map((span) => span.text).join('').length;
  if (block.kind === 'subhead' || block.kind === 'code') return block.text.length;
  if (block.kind === 'table') return block.rows.flat().join(' ').length;
  if (block.kind === 'image') return 0;
  return 0;
}

function visibleElementCount(slide: Slide): number {
  const bodyCount = slide.body.filter((block) => block.kind !== 'image').length;
  const columnCount = slide.columns?.reduce((sum, col) => sum + col.filter((block) => block.kind !== 'image').length, 0) ?? 0;
  return Math.max(bodyCount, columnCount);
}

function textLoad(slide: Slide): number {
  const bodyText = slide.body.reduce((sum, block) => sum + blockTextLength(block), 0);
  const columnText = slide.columns?.reduce(
    (sum, col) => sum + col.reduce((colSum, block) => colSum + blockTextLength(block), 0),
    0,
  ) ?? 0;
  return Math.max(bodyText, columnText);
}

function hasExplicitImageIntent(slide: Slide): boolean {
  return Boolean(slide.image?.prompt || slide.image?.query || slide.image?.entity || slide.image?.role || slide.image?.sourcePreference);
}

function hasSourceImage(slide: Slide): boolean {
  return Boolean(slide.image?.src || slide.body.some((b) => b.kind === 'image' && b.src));
}

function roleForSlide(slide: Slide, index: number): SlideImageRole {
  if (slide.image?.role) return slide.image.role;
  if (slide.image?.kind === 'logo') return 'logo';
  if (slide.image?.kind === 'background') return 'background';
  if (slide.layout === 'title' || index === 0) return 'cover';
  if (slide.layout === 'section') return 'background';
  if (slide.layout === 'image-focus') return 'hero';
  return 'support';
}

function aspectForSlide(slide: Slide): string {
  if (slide.image?.aspect) return slide.image.aspect;
  if (slide.layout === 'image-focus' || slide.layout === 'title' || slide.layout === 'section') return '16:9';
  return '4:3';
}

function sourcePreferenceForSlide(slide: Slide): SlideImageSourcePreference {
  if (slide.image?.sourcePreference) return slide.image.sourcePreference;
  if (slide.image?.kind === 'logo') return 'logo';
  return 'auto';
}

function licenseStrictnessForSlide(slide: Slide): SlideImageLicenseStrictness {
  return slide.image?.licenseStrictness ?? 'presentation';
}

function fallbackQuery(slide: Slide): string {
  const path = slide.sectionPath?.filter(Boolean).join(' ');
  const visualHint =
    slide.layout === 'title' || slide.layout === 'section'
      ? 'presentation background'
      : slide.layout === 'stat' || slide.layout === 'quote'
        ? 'editorial concept image'
        : 'presentation supporting visual';
  return [slide.image?.entity, slide.image?.query, slide.title, path, visualHint].filter(Boolean).join(' ').trim();
}

function fallbackPrompt(intent: SlideImageIntent, theme?: SlideTheme): string {
  const tone = theme ? `Match a ${theme.name} presentation theme.` : 'Match a polished modern presentation deck.';
  const topic = intent.entity || intent.query || intent.title;
  const role =
    intent.role === 'cover' || intent.role === 'background'
      ? 'wide cinematic hero background'
      : intent.role === 'icon'
        ? 'simple high-quality editorial icon illustration'
        : 'clean editorial presentation visual';
  return [
    `Create a ${role} for a PowerPoint slide titled "${intent.title}".`,
    `Topic: ${topic}.`,
    tone,
    intent.style ? `Style: ${intent.style}.` : '',
    'No readable text, no captions, no watermarks, no UI screenshots, no fake logos.',
  ]
    .filter(Boolean)
    .join(' ');
}

function slideVisualPriority(slide: Slide, index: number, mode: ReturnType<typeof slideImagePolicyMode>): number {
  const explicit = hasExplicitImageIntent(slide);
  const elements = visibleElementCount(slide);
  const chars = textLoad(slide);
  const spacious = Math.max(0, 6 - elements) * 4 + Math.max(0, 520 - chars) / 80;
  const bodyLayout =
    slide.layout === 'content' ||
    slide.layout === 'two-column' ||
    slide.layout === 'comparison' ||
    slide.layout === 'quote' ||
    slide.layout === 'stat';
  const coverOrDivider = slide.layout === 'title' || slide.layout === 'section' || index === 0;

  let score = explicit ? 80 : 0;
  if (bodyLayout) score += mode === 'active' ? 34 : 18;
  if (slide.layout === 'quote' || slide.layout === 'stat') score += mode === 'active' ? 10 : 4;
  if (slide.layout === 'image-focus') score += 28;
  if (coverOrDivider) score += explicit ? 18 : mode === 'active' ? 6 : 10;
  score += spacious;

  // 문서 앞쪽 편중을 약하게만 반영한다. 표지/섹션이 항상 먼저 먹는 현상을 막는다.
  score -= index * 0.15;
  return score;
}

function shouldAutoAddVisual(slide: Slide, index: number, mode: ReturnType<typeof slideImagePolicyMode>): boolean {
  if (hasExplicitImageIntent(slide)) return true;
  if (mode === 'active') return Boolean(slide.title?.trim()) && !hasSourceImage(slide);
  if (slide.layout === 'image-focus') return true;
  if (index === 0 || slide.layout === 'section') return true;
  return visibleElementCount(slide) <= 3 && textLoad(slide) <= 360;
}

function collectImageIntents(slides: Slide[], options: SlideExportOptions): SlideImageIntent[] {
  const mode = slideImagePolicyMode(options.imagePolicy);
  if (mode === 'sourceOnly') return [];
  return slides
    .map((slide, index): { intent: SlideImageIntent; priority: number } | null => {
      if (hasSourceImage(slide)) return null;
      if (!shouldAutoAddVisual(slide, index, mode)) return null;
      const image = slide.image;
      const query = fallbackQuery(slide);
      const prompt = image?.prompt?.trim();
      if (!query && !prompt) return null;
      return {
        intent: {
          slideIndex: index,
          slideId: slide.sourceIds?.[0] ?? `slide-${index + 1}`,
          title: slide.title || `Slide ${index + 1}`,
          role: roleForSlide(slide, index),
          query: image?.query ?? query,
          entity: image?.entity,
          prompt,
          aspect: aspectForSlide(slide),
          style: image?.style,
          sourcePreference: sourcePreferenceForSlide(slide),
          licenseStrictness: licenseStrictnessForSlide(slide),
        },
        priority: slideVisualPriority(slide, index, mode),
      };
    })
    .filter((item): item is { intent: SlideImageIntent; priority: number } => Boolean(item))
    .sort((a, b) => b.priority - a.priority)
    .map((item) => item.intent);
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const run = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      out[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return out;
}

function canSearchStock(intent: SlideImageIntent): boolean {
  return intent.sourcePreference !== 'none' && intent.sourcePreference !== 'generated' && Boolean(intent.query || intent.entity);
}

function canGenerate(intent: SlideImageIntent): boolean {
  return (
    intent.sourcePreference !== 'none' &&
    intent.sourcePreference !== 'stock' &&
    intent.sourcePreference !== 'logo' &&
    intent.role !== 'logo'
  );
}

async function resolveStockAsset(intent: SlideImageIntent): Promise<ResolvedSlideAsset | null> {
  if (!isTauri() || !canSearchStock(intent)) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<ResolvedSlideAsset | null>('resolve_stock_slide_asset', { intent });
}

async function resolveGeneratedAsset(intent: SlideImageIntent, theme?: SlideTheme): Promise<ResolvedSlideAsset | null> {
  if (!canGenerate(intent)) return null;
  const selection = getImageAIModelSelection();
  const prompt = intent.prompt || fallbackPrompt(intent, theme);
  try {
    const urls = await generateImage({
      provider: selection.company as ImageProvider,
      auth: selection.auth,
      model: selection.model,
      prompt,
      aspectRatio: intent.aspect,
      resolution: '2K',
      quality: 'high',
    });
    const dataUrl = urls.find(Boolean);
    if (!dataUrl) return null;
    return {
      dataUrl,
      provider: selection.company,
      attribution: `${selection.company} ${selection.model} generated image`,
    };
  } catch (err) {
    throw new Error(humanizeImageGenError(err, selection.company as ImageProvider));
  }
}

function applyAsset(slides: Slide[], intent: SlideImageIntent, asset: ResolvedSlideAsset): void {
  const slide = slides[intent.slideIndex];
  if (!slide) return;
  const image = {
    ...slide.image,
    src: asset.dataUrl,
    alt: slide.image?.alt || intent.query || intent.title,
    role: slide.image?.role ?? intent.role,
    aspect: slide.image?.aspect ?? intent.aspect,
  };
  const attribution = asset.attribution || asset.sourceUrl;
  const notes =
    attribution && !slide.notes?.includes(attribution)
      ? [slide.notes, `이미지 출처: ${attribution}`].filter(Boolean).join('\n\n')
      : slide.notes;
  slides[intent.slideIndex] = { ...slide, image, notes };
}

export async function resolveSlideAssets(
  slides: Slide[],
  options: SlideExportOptions,
  resolveOptions: ResolveSlideAssetsOptions = {},
): Promise<{ slides: Slide[]; summary: SlideAssetResolutionSummary }> {
  const stockLimit = stockImageLimitForPolicy(options.imagePolicy);
  const generatedLimit = generatedImageLimitForPolicy(options.imagePolicy);
  const summary: SlideAssetResolutionSummary = {
    requested: 0,
    resolved: 0,
    stockResolved: 0,
    generatedResolved: 0,
    failed: 0,
    skipped: 0,
  };
  if (stockLimit <= 0 && generatedLimit <= 0) {
    return { slides, summary };
  }

  const next = slides.map((slide) => ({ ...slide, body: [...slide.body], columns: slide.columns?.map((c) => [...c]) }));
  const intents = collectImageIntents(next, options).slice(0, stockLimit);
  summary.requested = intents.length;
  if (intents.length === 0) return { slides: next, summary };

  let done = 0;
  let stockOk = 0;
  resolveOptions.onProgress?.('🖼️ 이미지 에셋 준비 중...', `후보 처리 0/${intents.length}`, 'pptx-assets');

  const stockResults = await mapWithConcurrency(intents, STOCK_CONCURRENCY, async (intent) => {
    let asset: ResolvedSlideAsset | null = null;
    try {
      asset = await resolveStockAsset(intent);
      return { intent, asset, error: null as string | null };
    } catch (err) {
      return { intent, asset: null, error: err instanceof Error ? err.message : String(err) };
    } finally {
      done += 1;
      if (asset) stockOk += 1;
      resolveOptions.onProgress?.(
        '🖼️ 이미지 에셋 준비 중...',
        `${stockOk}개 확보 · 후보 처리 ${done}/${intents.length}`,
        'pptx-assets',
      );
    }
  });

  const unresolved: SlideImageIntent[] = [];
  for (const result of stockResults) {
    if (result.asset) {
      applyAsset(next, result.intent, result.asset);
      summary.resolved += 1;
      summary.stockResolved += 1;
    } else {
      unresolved.push(result.intent);
    }
  }

  const generationQueue = unresolved.filter(canGenerate).slice(0, Math.max(0, generatedLimit - summary.generatedResolved));
  summary.skipped += unresolved.length - generationQueue.length;
  if (generationQueue.length > 0) {
    done = 0;
    let generatedOk = 0;
    resolveOptions.onProgress?.('🖼️ 이미지 에셋 추가 중...', `후보 처리 0/${generationQueue.length}`, 'pptx-assets');
    const generatedResults = await mapWithConcurrency(generationQueue, GENERATED_CONCURRENCY, async (intent) => {
      let asset: ResolvedSlideAsset | null = null;
      try {
        asset = await resolveGeneratedAsset(intent, resolveOptions.theme);
        return { intent, asset, error: null as string | null };
      } catch (err) {
        return { intent, asset: null, error: err instanceof Error ? err.message : String(err) };
      } finally {
        done += 1;
        if (asset) generatedOk += 1;
        resolveOptions.onProgress?.(
          '🖼️ 이미지 에셋 추가 중...',
          `${generatedOk}개 확보 · 후보 처리 ${done}/${generationQueue.length}`,
          'pptx-assets',
        );
      }
    });
    for (const result of generatedResults) {
      if (result.asset) {
        applyAsset(next, result.intent, result.asset);
        summary.resolved += 1;
        summary.generatedResolved += 1;
      } else {
        summary.failed += 1;
        console.warn('[slideAssets] 이미지 자산 생성 실패:', result.intent.title, result.error);
      }
    }
  }

  resolveOptions.onProgress?.(
    '✅ 이미지 에셋 준비 완료',
    `${summary.resolved}/${summary.requested}개 확보 · stock ${summary.stockResolved} · 생성 ${summary.generatedResolved}`,
    'pptx-assets',
  );
  return { slides: next, summary };
}
