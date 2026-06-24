import type { Slide, SlideImageLicenseStrictness, SlideImageRole, SlideImageSourcePreference } from '../markdownToSlides';
import type { ResolvedSlideAsset, SlideAssetRecord, SlideImageIntent } from '../../services/slideAssets';

export interface HtmlNativeAssetIntentInput {
  id?: unknown;
  slideIndex?: unknown;
  slideTitle?: unknown;
  title?: unknown;
  role?: unknown;
  query?: unknown;
  entity?: unknown;
  prompt?: unknown;
  aspect?: unknown;
  style?: unknown;
  sourcePreference?: unknown;
  licenseStrictness?: unknown;
  importance?: unknown;
  importanceReason?: unknown;
  imageScore?: unknown;
  textSummary?: unknown;
  alt?: unknown;
}

export interface HtmlNativeDeck {
  html: string;
  assetIntents: HtmlNativeAssetIntentInput[];
}

export interface HtmlNativeValidationReport {
  slideCount: number;
  layoutCount: number;
  templateClassHits: number;
  templateClassHitRatio: number;
  errors: string[];
  warnings: string[];
}

export interface HtmlNativeResolvedAsset {
  intent: SlideImageIntent;
  asset: ResolvedSlideAsset;
}

const ROLE_SET = new Set<SlideImageRole>(['cover', 'hero', 'support', 'logo', 'icon', 'background']);
const SOURCE_SET = new Set<SlideImageSourcePreference>(['auto', 'stock', 'logo', 'generated', 'none']);
const LICENSE_SET = new Set<SlideImageLicenseStrictness>(['presentation', 'open', 'internal-only']);

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function safeAssetId(value: unknown, index: number): string {
  const raw = stringValue(value) ?? `asset-${index + 1}`;
  return raw.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || `asset-${index + 1}`;
}

function stripOuterFence(raw: string): string {
  const trimmed = raw.trim();
  const first = trimmed.split(/\r?\n/, 1)[0]?.trimStart() ?? '';
  if (!first.startsWith('```') && !first.startsWith('~~~')) return trimmed;
  const marker = first.startsWith('~~~') ? '~~~' : '```';
  const lines = trimmed.split(/\r?\n/);
  if (lines.length >= 2 && lines[lines.length - 1].trimStart().startsWith(marker)) {
    return lines.slice(1, -1).join('\n').trim();
  }
  return trimmed;
}

function keepHtmlDocument(raw: string): string {
  const unfenced = stripOuterFence(raw);
  const doctypeAt = unfenced.search(/<!doctype\s+html/i);
  if (doctypeAt >= 0) return unfenced.slice(doctypeAt).trim();
  const htmlAt = unfenced.search(/<html[\s>]/i);
  if (htmlAt >= 0) return unfenced.slice(htmlAt).trim();
  return unfenced.trim();
}

function scriptSrcs(html: string): string[] {
  return [...html.matchAll(/<script\b(?=[^>]*\bsrc\s*=)[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi)]
    .map((match) => (match[1] ?? match[2] ?? match[3])?.trim())
    .filter((src): src is string => Boolean(src));
}

function isAllowedLocalRuntimeScript(src: string): boolean {
  const clean = src.split(/[?#]/, 1)[0]?.trim().replace(/\\/g, '/') ?? '';
  if (!clean || /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(clean)) return false;
  if (clean.split('/').includes('..')) return false;
  return /(?:^|\/)deck-stage\.js$/i.test(clean);
}

function extractAssetIntents(html: string): HtmlNativeAssetIntentInput[] {
  const scriptMatch = html.match(/<script\b(?=[^>]*\bid=(["'])markmind-asset-intents\1)[^>]*>([\s\S]*?)<\/script>/i);
  if (!scriptMatch) return [];
  const raw = scriptMatch[2]?.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function htmlNativeDeckFromLlmHtml(raw: string): HtmlNativeDeck | null {
  const html = keepHtmlDocument(raw);
  if (!html || !/<html[\s>]/i.test(html)) return null;
  return { html, assetIntents: extractAssetIntents(html) };
}

function normalizeRole(value: unknown, fallback: SlideImageRole): SlideImageRole {
  const role = stringValue(value) as SlideImageRole | undefined;
  return role && ROLE_SET.has(role) ? role : fallback;
}

function normalizeSourcePreference(value: unknown): SlideImageSourcePreference {
  const pref = stringValue(value) as SlideImageSourcePreference | undefined;
  return pref && SOURCE_SET.has(pref) ? pref : 'auto';
}

function normalizeLicense(value: unknown): SlideImageLicenseStrictness {
  const license = stringValue(value) as SlideImageLicenseStrictness | undefined;
  return license && LICENSE_SET.has(license) ? license : 'presentation';
}

export function normalizeHtmlNativeAssetIntents(inputs: HtmlNativeAssetIntentInput[]): SlideImageIntent[] {
  return inputs
    .map((input, index): SlideImageIntent | null => {
      const id = safeAssetId(input.id, index);
      const slideIndex = Math.max(0, Math.round(numberValue(input.slideIndex) ?? index));
      const title = stringValue(input.slideTitle) ?? stringValue(input.title) ?? `Slide ${slideIndex + 1}`;
      const query = stringValue(input.query);
      const prompt = stringValue(input.prompt);
      const entity = stringValue(input.entity);
      if (!query && !prompt && !entity) return null;
      const importance = clamp(Math.round(numberValue(input.importance) ?? 70), 0, 100);
      return {
        slideIndex,
        slideId: id,
        title,
        role: normalizeRole(input.role, slideIndex === 0 ? 'cover' : 'support'),
        query,
        entity,
        prompt,
        aspect: stringValue(input.aspect) ?? '16:9',
        style: stringValue(input.style),
        sourcePreference: normalizeSourcePreference(input.sourcePreference),
        licenseStrictness: normalizeLicense(input.licenseStrictness),
        importance,
        importanceReason: stringValue(input.importanceReason),
        imageScore: clamp(Math.round(numberValue(input.imageScore) ?? importance), 0, 100),
        textSummary: stringValue(input.textSummary) ?? stringValue(input.alt),
      };
    })
    .filter((intent): intent is SlideImageIntent => Boolean(intent));
}

function tokenPatterns(id: string): RegExp[] {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [
    new RegExp(`\\{\\{\\s*markmind_asset:${escaped}\\s*\\}\\}`, 'g'),
    new RegExp(`markmind-asset://${escaped}`, 'g'),
  ];
}

export function applyHtmlNativeAssets(
  html: string,
  resolvedAssets: HtmlNativeResolvedAsset[],
): { html: string; insertedIds: Set<string> } {
  let next = html;
  const insertedIds = new Set<string>();
  for (const item of resolvedAssets) {
    const id = item.intent.slideId;
    let inserted = false;
    for (const pattern of tokenPatterns(id)) {
      if (pattern.test(next)) {
        inserted = true;
        next = next.replace(pattern, item.asset.dataUrl);
      }
    }
    if (inserted) insertedIds.add(id);
  }
  return { html: next, insertedIds };
}

export function applyHtmlNativeAssetRecords(
  html: string,
  records: SlideAssetRecord[],
): { html: string; insertedIds: Set<string> } {
  return applyHtmlNativeAssets(
    html,
    records.map((record) => ({
      intent: {
        slideIndex: record.slideIndex,
        slideId: record.slideId,
        title: record.slideTitle,
        role: record.role,
        query: record.query,
        prompt: record.prompt,
        aspect: record.width && record.height && record.width < record.height ? '3:4' : '16:9',
        sourcePreference: record.sourceMode === 'generated' ? 'generated' : 'stock',
        licenseStrictness: 'presentation',
        importance: record.importance,
        importanceReason: record.importanceReason,
        imageScore: record.imageScore,
      },
      asset: {
        dataUrl: record.dataUrl,
        provider: record.provider,
        sourceUrl: record.sourceUrl,
        attribution: record.attribution,
        license: record.license,
        width: record.width,
        height: record.height,
      },
    })),
  );
}

export function slidesFromHtmlNativeAssetIntents(intents: SlideImageIntent[]): Slide[] {
  return intents.map((intent): Slide => ({
    title: intent.title,
    layout: intent.slideIndex === 0 || intent.role === 'cover' ? 'title' : intent.role === 'hero' ? 'image-focus' : 'content',
    sourceIds: [intent.slideId],
    importance: intent.importance,
    importanceReason: intent.importanceReason,
    body: intent.textSummary
      ? [
          {
            kind: 'text',
            spans: [{ text: intent.textSummary }],
          },
        ]
      : [],
    image: {
      role: intent.role,
      query: intent.query,
      entity: intent.entity,
      prompt: intent.prompt,
      aspect: intent.aspect,
      style: intent.style,
      sourcePreference: intent.sourcePreference,
      licenseStrictness: intent.licenseStrictness,
      alt: intent.title,
    },
  }));
}

export function sanitizeHtmlNativeSlides(html: string): string {
  return html
    .replace(/<script\b(?=[^>]*\bsrc\s*=)[^>]*>[\s\S]*?<\/script>/gi, (script) => {
      const src = scriptSrcs(script)[0];
      return src && isAllowedLocalRuntimeScript(src) ? script : '';
    })
    .replace(/<\s*(iframe|object|embed|applet)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(iframe|object|embed|applet)\b[^>]*\/?>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\b(href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi, '$1="#"')
    .trim();
}

export function ensureHtmlNativeDocument(html: string, title = 'MarkMind HTML Slides'): string {
  const kept = keepHtmlDocument(html);
  if (/<html[\s>]/i.test(kept)) return kept;
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title.replace(/[<>&"]/g, '')}</title>
</head>
<body>
${kept}
</body>
</html>`;
}

export function validateHtmlNativeSlides(html: string): HtmlNativeValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const slideMatches = html.match(/<(?:section|div)\b(?=[^>]*\bclass=(["'])[^"']*\bslide\b[^"']*\1)[^>]*>/gi);
  const fallbackSections = html.match(/<section\b/gi);
  const slideCount = slideMatches?.length ?? fallbackSections?.length ?? 0;
  const layouts = new Set<string>();
  for (const match of html.matchAll(/\bdata-layout=(["'])(.*?)\1/gi)) {
    const layout = match[2]?.trim();
    if (layout) layouts.add(layout);
  }

  if (slideCount === 0) errors.push('슬라이드를 찾지 못했습니다.');
  if (/<html[\s>]/i.test(html) && !/<\/html>/i.test(html)) errors.push('HTML 문서가 끝까지 닫히지 않았습니다.');
  if (/<style\b/i.test(html) && !/<\/style>/i.test(html)) errors.push('style 태그가 닫히지 않았습니다.');
  if (/<script\b/i.test(html) && !/<\/script>/i.test(html)) errors.push('script 태그가 닫히지 않았습니다.');
  const sectionOpenCount = html.match(/<section\b/gi)?.length ?? 0;
  const sectionCloseCount = html.match(/<\/section>/gi)?.length ?? 0;
  if (sectionOpenCount > 0 && sectionCloseCount < sectionOpenCount) errors.push('일부 slide section이 닫히지 않았습니다.');
  const blockedScriptSrcs = scriptSrcs(html).filter((src) => !isAllowedLocalRuntimeScript(src));
  if (blockedScriptSrcs.length > 0) {
    errors.push(`지원하지 않는 script src가 있습니다: ${blockedScriptSrcs.join(', ')}`);
  }
  if (/<\s*(iframe|object|embed|applet)\b/i.test(html)) errors.push('iframe/object/embed/applet 태그는 허용하지 않습니다.');
  if (/\{\{\s*markmind_asset:/i.test(html) || /markmind-asset:\/\//i.test(html)) {
    warnings.push('치환되지 않은 이미지 placeholder가 남아 있습니다.');
  }
  if (slideCount >= 6 && layouts.size > 0 && layouts.size < 3) {
    warnings.push('HTML-native 레이아웃 종류가 적습니다.');
  }

  return { slideCount, layoutCount: layouts.size, templateClassHits: 0, templateClassHitRatio: 0, errors, warnings };
}

export function validateHtmlNativeSlidesForTemplate(html: string, _themeId?: string): HtmlNativeValidationReport {
  const report = validateHtmlNativeSlides(html);
  return report;
}

export function summarizeHtmlNativeValidation(report: HtmlNativeValidationReport): string {
  return [...report.errors.map((item) => `오류: ${item}`), ...report.warnings.map((item) => `경고: ${item}`)].join('\n');
}
