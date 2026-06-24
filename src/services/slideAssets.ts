import type { Slide, SlideImageLicenseStrictness, SlideImageRole, SlideImageSourcePreference } from '../lib/markdownToSlides';
import type { SlideExportOptions, SlideTheme } from '../lib/slideTheme';
import {
  generatedImageLimitForPolicy,
  slideImagePolicyMode,
  slideImageSourceMode,
  stockImageLimitForPolicy,
  type SlideImageSourceMode,
} from '../lib/slideLimits';
import { getImageAIModelSelection } from './aiModelConfig';
import { generateImage, humanizeImageGenError, type ImageProvider } from './imageGen';
import { isTauri } from './platform';

type AssetProvider = 'openverse' | 'wikimedia' | 'unsplash' | 'pexels' | 'brandfetch' | 'openai' | 'gemini' | 'grok';
type AssetSourceKind = 'stock' | 'generated';

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
  importance: number;
  importanceReason?: string;
  imageScore: number;
  textSummary?: string;
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

export interface SlideAssetRecord {
  slideIndex: number;
  slideTitle: string;
  slideId: string;
  role: SlideImageRole;
  sourceMode: AssetSourceKind;
  provider: AssetProvider;
  inserted: boolean;
  importance: number;
  importanceReason?: string;
  imageScore: number;
  query?: string;
  prompt?: string;
  generatedPrompt?: string;
  sourceUrl?: string;
  attribution?: string;
  license?: string;
  width?: number;
  height?: number;
  dataUrl: string;
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
const IMPORTANT_TITLE_RE =
  /(결론|요약|핵심|제안|추천|권고|실행|계획|다음 단계|의사결정|결정|성과|문제|전략|conclusion|summary|recommend|proposal|action|next step|decision|strategy|key)/i;
const CONCEPTUAL_RE =
  /(전략|성장|전환|리스크|문제|해결|협업|혁신|효율|생산성|미래|변화|갈등|균형|strategy|growth|transition|risk|problem|solution|collaboration|innovation|productivity|future|change|balance)/i;
const FACTUAL_RE =
  /(logo|로고|brand|브랜드|company|기업|product|제품|place|장소|city|도시|map|지도|building|건물|person|인물|founder|ceo|university|school|hospital|government|기관)/i;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function blockText(block: Slide['body'][number]): string {
  if (block.kind === 'bullet' || block.kind === 'text') return block.spans.map((span) => span.text).join('');
  if (block.kind === 'subhead' || block.kind === 'code') return block.text;
  if (block.kind === 'table') return block.rows.flat().join(' ');
  if (block.kind === 'image') return block.alt || '';
  return '';
}

function blockTextLength(block: Slide['body'][number]): number {
  return blockText(block).length;
}

function visibleElementCount(slide: Slide): number {
  const bodyCount = slide.body.filter((block) => block.kind !== 'image').length;
  const columnCount =
    slide.columns?.reduce((sum, col) => sum + col.filter((block) => block.kind !== 'image').length, 0) ?? 0;
  return Math.max(bodyCount, columnCount);
}

function textLoad(slide: Slide): number {
  const bodyText = slide.body.reduce((sum, block) => sum + blockTextLength(block), 0);
  const columnText =
    slide.columns?.reduce(
      (sum, col) => sum + col.reduce((colSum, block) => colSum + blockTextLength(block), 0),
      0,
    ) ?? 0;
  return Math.max(bodyText, columnText);
}

function slideTextSummary(slide: Slide): string {
  const parts = [
    slide.title,
    slide.quote?.text,
    slide.stat ? [slide.stat.value, slide.stat.label, slide.stat.context].filter(Boolean).join(' ') : '',
    ...slide.body.map(blockText),
    ...(slide.columns?.flat().map(blockText) ?? []),
  ].filter(Boolean);
  return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 520);
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

function slideImportance(slide: Slide, index: number, total: number): number {
  let score = slide.importance ?? 45;
  if (slide.layout === 'title' || index === 0) score = Math.max(score, 90);
  if (index === total - 1) score = Math.max(score, 72);
  if (slide.layout === 'section') score = Math.max(score, 58);
  if (slide.layout === 'stat') score = Math.max(score, 76);
  if (slide.layout === 'quote') score = Math.max(score, 68);
  if (slide.layout === 'image-focus') score = Math.max(score, 80);
  if (slide.sourceLevel && slide.sourceLevel <= 1) score = Math.max(score, 70);
  if (IMPORTANT_TITLE_RE.test([slide.title, slide.sectionPath?.join(' ')].filter(Boolean).join(' '))) {
    score = Math.max(score, 82);
  }
  return clamp(Math.round(score), 0, 100);
}

function visualOpportunity(slide: Slide): number {
  const elements = visibleElementCount(slide);
  const chars = textLoad(slide);
  const elementRoom = clamp(((7 - elements) / 7) * 100, 0, 100);
  const textRoom = clamp(((720 - chars) / 720) * 100, 0, 100);
  return clamp(elementRoom * 0.52 + textRoom * 0.48, 0, 100);
}

function visualFit(slide: Slide): number {
  const explicit = hasExplicitImageIntent(slide);
  if (slide.image?.sourcePreference === 'none') return 0;
  if (slide.image?.sourcePreference === 'logo' || slide.image?.kind === 'logo') return 88;
  if (explicit) return 86;
  if (slide.layout === 'title' || slide.layout === 'image-focus') return 88;
  if (slide.layout === 'section') return 76;
  if (slide.layout === 'stat' || slide.layout === 'quote') return 72;
  if (CONCEPTUAL_RE.test(slideTextSummary(slide))) return 70;
  return 54;
}

function layoutBenefit(slide: Slide): number {
  if (slide.layout === 'title' || slide.layout === 'section' || slide.layout === 'image-focus') return 86;
  if (slide.layout === 'stat' || slide.layout === 'quote') return 74;
  if (slide.layout === 'content' || slide.layout === 'two-column' || slide.layout === 'comparison') return 60;
  return 38;
}

export function scoreSlideImageCandidate(
  slide: Slide,
  index: number,
  total: number,
  policyMode: ReturnType<typeof slideImagePolicyMode>,
): { score: number; importance: number } {
  if (hasSourceImage(slide) || policyMode === 'sourceOnly') return { score: 0, importance: 0 };
  const importance = slideImportance(slide, index, total);
  const chars = textLoad(slide);
  const elements = visibleElementCount(slide);
  const densityPenalty = (chars > 900 ? 24 : chars > 680 ? 14 : chars > 520 ? 7 : 0) + (elements > 8 ? 12 : 0);
  let score =
    importance * 0.45 +
    visualOpportunity(slide) * 0.3 +
    visualFit(slide) * 0.2 +
    layoutBenefit(slide) * 0.05 -
    densityPenalty;
  if (hasExplicitImageIntent(slide)) score = Math.max(score, 75);
  return { score: clamp(Math.round(score), 0, 100), importance };
}

function shouldAddVisual(slide: Slide, index: number, total: number, mode: ReturnType<typeof slideImagePolicyMode>): boolean {
  if (hasSourceImage(slide) || mode === 'sourceOnly') return false;
  if (hasExplicitImageIntent(slide)) return true;
  const threshold = mode === 'active' ? 45 : 65;
  return scoreSlideImageCandidate(slide, index, total, mode).score >= threshold;
}

function collectImageIntents(slides: Slide[], options: SlideExportOptions): SlideImageIntent[] {
  const mode = slideImagePolicyMode(options.imagePolicy);
  if (mode === 'sourceOnly') return [];
  const total = slides.length;
  return slides
    .map((slide, index): SlideImageIntent | null => {
      if (!shouldAddVisual(slide, index, total, mode)) return null;
      const image = slide.image;
      const query = fallbackQuery(slide);
      const prompt = image?.prompt?.trim();
      if (!query && !prompt) return null;
      const score = scoreSlideImageCandidate(slide, index, total, mode);
      return {
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
        importance: score.importance,
        importanceReason: slide.importanceReason,
        imageScore: score.score,
        textSummary: slideTextSummary(slide),
      };
    })
    .filter((item): item is SlideImageIntent => Boolean(item))
    .sort((a, b) => b.imageScore - a.imageScore || b.importance - a.importance || a.slideIndex - b.slideIndex);
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

export function canResolveStockSearch(intent: SlideImageIntent): boolean {
  return intent.sourcePreference !== 'none' && Boolean(intent.query || intent.entity);
}

function canGenerate(intent: SlideImageIntent): boolean {
  return (
    intent.sourcePreference !== 'none' &&
    intent.sourcePreference !== 'logo' &&
    intent.role !== 'logo'
  );
}

function preferGeneratedForAuto(intent: SlideImageIntent): boolean {
  if (intent.sourcePreference === 'generated') return true;
  if (intent.sourcePreference === 'stock' || intent.sourcePreference === 'logo' || intent.role === 'logo') return false;
  const text = [intent.title, intent.query, intent.entity, intent.textSummary, intent.prompt].filter(Boolean).join(' ');
  if (FACTUAL_RE.test(text)) return false;
  if (intent.prompt) return true;
  if (intent.role === 'cover' || intent.role === 'background' || intent.role === 'icon') return true;
  return CONCEPTUAL_RE.test(text);
}

export function routeSlideImageIntent(intent: SlideImageIntent, mode: SlideImageSourceMode): AssetSourceKind | null {
  if (intent.sourcePreference === 'none') return null;
  if (mode === 'generatedOnly') return canGenerate(intent) ? 'generated' : null;
  if (mode === 'stockOnly') return canResolveStockSearch(intent) ? 'stock' : null;
  if (intent.sourcePreference === 'generated') return canGenerate(intent) ? 'generated' : null;
  if (intent.sourcePreference === 'stock' || intent.sourcePreference === 'logo' || intent.role === 'logo') {
    return canSearchStock(intent) ? 'stock' : null;
  }
  if (mode === 'generatedFirst') return canGenerate(intent) ? 'generated' : canSearchStock(intent) ? 'stock' : null;
  if (mode === 'stockFirst') return canSearchStock(intent) ? 'stock' : canGenerate(intent) ? 'generated' : null;
  return preferGeneratedForAuto(intent) && canGenerate(intent)
    ? 'generated'
    : canSearchStock(intent)
      ? 'stock'
      : canGenerate(intent)
        ? 'generated'
        : null;
}

function splitQueues(
  intents: SlideImageIntent[],
  sourceMode: SlideImageSourceMode,
  stockLimit: number,
  generatedLimit: number,
): { stock: SlideImageIntent[]; generated: SlideImageIntent[]; skipped: number } {
  const stock: SlideImageIntent[] = [];
  const generated: SlideImageIntent[] = [];
  let skipped = 0;
  for (const intent of intents) {
    const route = routeSlideImageIntent(intent, sourceMode);
    if (route === 'stock' && stock.length < stockLimit) stock.push(intent);
    else if (route === 'generated' && generated.length < generatedLimit) generated.push(intent);
    else skipped += 1;
  }
  return { stock, generated, skipped };
}

async function resolveStockAsset(intent: SlideImageIntent): Promise<ResolvedSlideAsset | null> {
  if (!isTauri() || !canResolveStockSearch(intent)) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<ResolvedSlideAsset | null>('resolve_stock_slide_asset', { intent });
}

export function buildGeneratedSlideImagePrompt(intent: SlideImageIntent, theme?: SlideTheme): string {
  const role =
    intent.role === 'cover' || intent.role === 'background'
      ? 'wide cinematic presentation background'
      : intent.role === 'hero'
        ? 'hero image for a presentation slide'
        : intent.role === 'icon'
          ? 'simple editorial icon-style illustration'
          : 'supporting editorial presentation visual';
  const topic = [intent.entity, intent.title, intent.textSummary || intent.query].filter(Boolean).join(' - ');
  return [
    `Create a ${role}.`,
    `Slide title: "${intent.title}".`,
    topic ? `Slide context: ${topic}.` : '',
    intent.prompt ? `Creative brief: ${intent.prompt}.` : '',
    `Composition: clean, professional, presentation-ready, strong focal point, useful negative space for surrounding slide content.`,
    theme ? `Visual tone: match the "${theme.name}" deck theme. ${theme.description}.` : 'Visual tone: polished modern presentation deck.',
    intent.style ? `Style guidance: ${intent.style}.` : '',
    intent.importance >= 80 ? 'This is a high-importance slide, so make the image memorable and visually strong.' : '',
    `Aspect ratio: ${intent.aspect}.`,
    'Do not include readable text, captions, watermarks, UI screenshots, charts, fake logos, or brand marks.',
    'Do not invent a real person, company logo, product screenshot, document, or data visualization.',
  ]
    .filter(Boolean)
    .join('\n');
}

async function resolveGeneratedAsset(
  intent: SlideImageIntent,
  theme?: SlideTheme,
): Promise<{ asset: ResolvedSlideAsset | null; generatedPrompt: string }> {
  if (!canGenerate(intent)) return { asset: null, generatedPrompt: '' };
  const selection = getImageAIModelSelection();
  const generatedPrompt = buildGeneratedSlideImagePrompt(intent, theme);
  try {
    const urls = await generateImage({
      provider: selection.company as ImageProvider,
      auth: selection.auth,
      model: selection.model,
      prompt: generatedPrompt,
      aspectRatio: intent.aspect,
      resolution: '2K',
      quality: 'high',
    });
    const dataUrl = urls.find(Boolean);
    if (!dataUrl) return { asset: null, generatedPrompt };
    return {
      generatedPrompt,
      asset: {
        dataUrl,
        provider: selection.company,
        attribution: `${selection.company} ${selection.model} generated image`,
      },
    };
  } catch (err) {
    throw new Error(humanizeImageGenError(err, selection.company as ImageProvider));
  }
}

function applyAsset(slides: Slide[], intent: SlideImageIntent, asset: ResolvedSlideAsset): boolean {
  const slide = slides[intent.slideIndex];
  if (!slide) return false;
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
  return true;
}

function makeAssetRecord(
  intent: SlideImageIntent,
  asset: ResolvedSlideAsset,
  sourceMode: AssetSourceKind,
  inserted: boolean,
  generatedPrompt?: string,
): SlideAssetRecord {
  return {
    slideIndex: intent.slideIndex,
    slideTitle: intent.title,
    slideId: intent.slideId,
    role: intent.role,
    sourceMode,
    provider: asset.provider,
    inserted,
    importance: intent.importance,
    importanceReason: intent.importanceReason,
    imageScore: intent.imageScore,
    query: intent.query,
    prompt: intent.prompt,
    generatedPrompt,
    sourceUrl: asset.sourceUrl,
    attribution: asset.attribution,
    license: asset.license,
    width: asset.width,
    height: asset.height,
    dataUrl: asset.dataUrl,
  };
}

async function resolveStockQueue(
  items: SlideImageIntent[],
  resolveOptions: ResolveSlideAssetsOptions,
): Promise<Array<{ intent: SlideImageIntent; asset: ResolvedSlideAsset | null; error: string | null }>> {
  if (items.length === 0) return [];
  let done = 0;
  let ok = 0;
  resolveOptions.onProgress?.('🖼️ Stock 이미지 검색 중...', `후보 처리 0/${items.length}`, 'pptx-assets-stock');
  return mapWithConcurrency(items, STOCK_CONCURRENCY, async (intent) => {
    let asset: ResolvedSlideAsset | null = null;
    try {
      asset = await resolveStockAsset(intent);
      return { intent, asset, error: null };
    } catch (err) {
      return { intent, asset: null, error: err instanceof Error ? err.message : String(err) };
    } finally {
      done += 1;
      if (asset) ok += 1;
      resolveOptions.onProgress?.(
        '🖼️ Stock 이미지 검색 중...',
        `${ok}개 확보 · 후보 처리 ${done}/${items.length}`,
        'pptx-assets-stock',
      );
    }
  });
}

async function resolveGeneratedQueue(
  items: SlideImageIntent[],
  resolveOptions: ResolveSlideAssetsOptions,
): Promise<
  Array<{ intent: SlideImageIntent; asset: ResolvedSlideAsset | null; generatedPrompt?: string; error: string | null }>
> {
  if (items.length === 0) return [];
  let done = 0;
  let ok = 0;
  resolveOptions.onProgress?.('🖼️ AI 이미지 생성 중...', `후보 처리 0/${items.length}`, 'pptx-assets-generated');
  return mapWithConcurrency(items, GENERATED_CONCURRENCY, async (intent) => {
    let asset: ResolvedSlideAsset | null = null;
    let generatedPrompt = '';
    try {
      const result = await resolveGeneratedAsset(intent, resolveOptions.theme);
      asset = result.asset;
      generatedPrompt = result.generatedPrompt;
      return { intent, asset, generatedPrompt, error: null };
    } catch (err) {
      return { intent, asset: null, generatedPrompt, error: err instanceof Error ? err.message : String(err) };
    } finally {
      done += 1;
      if (asset) ok += 1;
      resolveOptions.onProgress?.(
        '🖼️ AI 이미지 생성 중...',
        `${ok}개 확보 · 후보 처리 ${done}/${items.length}`,
        'pptx-assets-generated',
      );
    }
  });
}

export async function resolveSlideAssets(
  slides: Slide[],
  options: SlideExportOptions,
  resolveOptions: ResolveSlideAssetsOptions = {},
): Promise<{ slides: Slide[]; summary: SlideAssetResolutionSummary; assets: SlideAssetRecord[] }> {
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
    return { slides, summary, assets: [] };
  }

  const next = slides.map((slide) => ({ ...slide, body: [...slide.body], columns: slide.columns?.map((c) => [...c]) }));
  const intents = collectImageIntents(next, options);
  const sourceMode = slideImageSourceMode(options.imageSourceMode);
  const queues = splitQueues(intents, sourceMode, stockLimit, generatedLimit);
  const assets: SlideAssetRecord[] = [];
  summary.requested = queues.stock.length + queues.generated.length;
  summary.skipped += queues.skipped;
  if (summary.requested === 0) return { slides: next, summary, assets };

  const stockResults = await resolveStockQueue(queues.stock, resolveOptions);
  const stockUnresolved: SlideImageIntent[] = [];
  for (const result of stockResults) {
    if (result.asset) {
      const inserted = applyAsset(next, result.intent, result.asset);
      assets.push(makeAssetRecord(result.intent, result.asset, 'stock', inserted));
      summary.resolved += inserted ? 1 : 0;
      summary.stockResolved += 1;
    } else {
      stockUnresolved.push(result.intent);
      if (result.error) console.warn('[slideAssets] Stock 이미지 검색 실패:', result.intent.title, result.error);
    }
  }

  const generatedResults = await resolveGeneratedQueue(queues.generated, resolveOptions);
  const generatedUnresolved: SlideImageIntent[] = [];
  for (const result of generatedResults) {
    if (result.asset) {
      const inserted = applyAsset(next, result.intent, result.asset);
      assets.push(makeAssetRecord(result.intent, result.asset, 'generated', inserted, result.generatedPrompt));
      summary.resolved += inserted ? 1 : 0;
      summary.generatedResolved += 1;
    } else {
      generatedUnresolved.push(result.intent);
      summary.failed += result.error ? 1 : 0;
      if (result.error) console.warn('[slideAssets] AI 이미지 생성 실패:', result.intent.title, result.error);
    }
  }

  const remainingGenerated = Math.max(0, generatedLimit - queues.generated.length);
  const generatedFallbackCapacity = remainingGenerated;
  const shouldGeneratedFallback = sourceMode !== 'generatedOnly' && sourceMode !== 'stockOnly' && generatedFallbackCapacity > 0;
  if (shouldGeneratedFallback) {
    const fallbackQueue = stockUnresolved.filter(canGenerate).slice(0, generatedFallbackCapacity);
    summary.skipped += stockUnresolved.length - fallbackQueue.length;
    const fallbackResults = await resolveGeneratedQueue(fallbackQueue, resolveOptions);
    for (const result of fallbackResults) {
      if (result.asset) {
        const inserted = applyAsset(next, result.intent, result.asset);
        assets.push(makeAssetRecord(result.intent, result.asset, 'generated', inserted, result.generatedPrompt));
        summary.resolved += inserted ? 1 : 0;
        summary.generatedResolved += 1;
      } else {
        summary.failed += result.error ? 1 : 0;
        if (result.error) console.warn('[slideAssets] AI 이미지 fallback 실패:', result.intent.title, result.error);
      }
    }
  } else {
    summary.skipped += stockUnresolved.length;
  }

  const remainingStock = Math.max(0, stockLimit - queues.stock.length);
  const shouldStockFallback = sourceMode === 'generatedFirst' && remainingStock > 0;
  if (shouldStockFallback) {
    const fallbackQueue = generatedUnresolved.filter(canSearchStock).slice(0, remainingStock);
    summary.skipped += generatedUnresolved.length - fallbackQueue.length;
    const fallbackResults = await resolveStockQueue(fallbackQueue, resolveOptions);
    for (const result of fallbackResults) {
      if (result.asset) {
        const inserted = applyAsset(next, result.intent, result.asset);
        assets.push(makeAssetRecord(result.intent, result.asset, 'stock', inserted));
        summary.resolved += inserted ? 1 : 0;
        summary.stockResolved += 1;
      } else if (result.error) {
        console.warn('[slideAssets] Stock 이미지 fallback 실패:', result.intent.title, result.error);
      }
    }
  } else {
    summary.skipped += generatedUnresolved.length;
  }

  resolveOptions.onProgress?.(
    '✅ 이미지 에셋 준비 완료',
    `${summary.resolved}/${summary.requested}개 삽입 · stock ${summary.stockResolved} · 생성 ${summary.generatedResolved}`,
    'pptx-assets',
  );
  return { slides: next, summary, assets };
}
