import {
  BEAUTIFUL_HTML_TEMPLATE_METADATA,
  BEAUTIFUL_HTML_TEMPLATES_SOURCE,
  DEFAULT_HTML_SLIDE_THEME,
  HTML_SLIDE_AUTO_THEME_ID,
  type BeautifulHtmlTemplateMetadata,
  type HtmlSlideThemeId,
} from '../htmlSlideTheme';
import animationPatternsMd from './vendor/frontend-slides/animation-patterns.md?raw';
import beautifulAgentsMd from './vendor/beautiful-html-templates/AGENTS.md?raw';
import beautifulRuntimeDeckStageJs from './vendor/beautiful-html-templates/runtime/deck-stage.js?raw';

export interface FrontendSlidesTemplateDocs {
  id: HtmlSlideThemeId;
  name: string;
  sourceUrl: string;
  previewPath: string;
  designPath: string;
  previewMd: string;
  designMd: string;
  beautifulDesignMd: string;
  templateJson: string;
  templateHtml: string;
  metadata: BeautifulHtmlTemplateMetadata;
}

export const FRONTEND_SLIDES_VENDOR_SOURCE = 'https://github.com/zarazhangrui/frontend-slides';
export const FRONTEND_SLIDES_SKILL_PATH = 'plugins/frontend-slides/skills/frontend-slides';
export const FRONTEND_SLIDES_SKILL_SOURCE = `${FRONTEND_SLIDES_VENDOR_SOURCE}/tree/main/${FRONTEND_SLIDES_SKILL_PATH}`;

export interface HtmlSlideRuntimeFile {
  path: string;
  content: string;
}

const beautifulDesignModules = import.meta.glob<string>('./vendor/beautiful-html-templates/templates/*/design.md', {
  query: '?raw',
  import: 'default',
});
const beautifulTemplateHtmlModules = import.meta.glob<string>('./vendor/beautiful-html-templates/templates/*/template.html', {
  query: '?raw',
  import: 'default',
});
const beautifulTemplateJsonModules = import.meta.glob<string>('./vendor/beautiful-html-templates/templates/*/template.json', {
  query: '?raw',
  import: 'default',
});
const frontendPreviewModules = import.meta.glob<string>(
  './vendor/frontend-slides/plugins/frontend-slides/skills/frontend-slides/bold-template-pack/templates/*/preview.md',
  { query: '?raw', import: 'default' },
);
const frontendDesignModules = import.meta.glob<string>(
  './vendor/frontend-slides/plugins/frontend-slides/skills/frontend-slides/bold-template-pack/templates/*/design.md',
  { query: '?raw', import: 'default' },
);
const beautifulDeckStageModules = import.meta.glob<string>('./vendor/beautiful-html-templates/templates/*/deck-stage.js', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const metadataBySlug = new Map(BEAUTIFUL_HTML_TEMPLATE_METADATA.map((item) => [item.slug, item]));

function templateSlug(themeId?: string): string {
  if (!themeId || themeId === HTML_SLIDE_AUTO_THEME_ID) return DEFAULT_HTML_SLIDE_THEME.id;
  return metadataBySlug.has(themeId) ? themeId : DEFAULT_HTML_SLIDE_THEME.id;
}

function modulePath(slug: string, file: 'design.md' | 'template.html' | 'template.json' | 'deck-stage.js'): string {
  return `./vendor/beautiful-html-templates/templates/${slug}/${file}`;
}

function frontendModulePath(slug: string, file: 'preview.md' | 'design.md'): string {
  return `./vendor/frontend-slides/plugins/frontend-slides/skills/frontend-slides/bold-template-pack/templates/${slug}/${file}`;
}

async function loadRequiredRaw(modules: Record<string, () => Promise<string>>, path: string): Promise<string> {
  const loader = modules[path];
  if (!loader) throw new Error(`HTML 템플릿 파일을 찾지 못했습니다: ${path}`);
  return loader();
}

async function loadOptionalRaw(modules: Record<string, () => Promise<string>>, path: string): Promise<string> {
  const loader = modules[path];
  return loader ? loader() : '';
}

export function getHtmlSlideTemplateMetadata(themeId?: string): BeautifulHtmlTemplateMetadata {
  const slug = templateSlug(themeId);
  return metadataBySlug.get(slug) ?? metadataBySlug.get(DEFAULT_HTML_SLIDE_THEME.id)!;
}

export function getHtmlSlideTemplateCatalogForPrompt(): string {
  const compact = BEAUTIFUL_HTML_TEMPLATE_METADATA.map((item) => ({
    slug: item.slug,
    name: item.name,
    tagline: item.tagline,
    mood: item.mood,
    tone: item.tone,
    occasion: item.occasion,
    formality: item.formality,
    density: item.density,
    scheme: item.scheme,
    best_for: item.best_for,
    avoid_for: item.avoid_for,
    slide_count: item.slide_count,
  }));
  return JSON.stringify(compact, null, 2);
}

export async function getFrontendSlidesTemplateDocs(themeId?: string): Promise<FrontendSlidesTemplateDocs> {
  const slug = templateSlug(themeId);
  const metadata = getHtmlSlideTemplateMetadata(slug);
  const [beautifulDesignMd, templateHtml, templateJson, previewMd, designMd] = await Promise.all([
    loadRequiredRaw(beautifulDesignModules, modulePath(slug, 'design.md')),
    loadRequiredRaw(beautifulTemplateHtmlModules, modulePath(slug, 'template.html')),
    loadRequiredRaw(beautifulTemplateJsonModules, modulePath(slug, 'template.json')),
    loadOptionalRaw(frontendPreviewModules, frontendModulePath(slug, 'preview.md')),
    loadOptionalRaw(frontendDesignModules, frontendModulePath(slug, 'design.md')),
  ]);

  return {
    id: slug,
    name: metadata.name,
    sourceUrl: `${BEAUTIFUL_HTML_TEMPLATES_SOURCE}/tree/main/templates/${slug}`,
    previewPath: `${FRONTEND_SLIDES_SKILL_PATH}/bold-template-pack/templates/${slug}/preview.md`,
    designPath: `templates/${slug}/design.md`,
    previewMd,
    designMd,
    beautifulDesignMd,
    templateJson,
    templateHtml,
    metadata,
  };
}

export type FrontendSlidesOutputMode = 'json' | 'html';

function scriptSrcs(html: string): string[] {
  return [...html.matchAll(/<script\b(?=[^>]*\bsrc\s*=)[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi)]
    .map((match) => (match[1] ?? match[2] ?? match[3])?.trim())
    .filter((src): src is string => Boolean(src));
}

function runtimePathForScriptSrc(src: string): string | null {
  const clean = src.split(/[?#]/, 1)[0]?.trim().replace(/\\/g, '/') ?? '';
  if (!clean || /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(clean) || clean.split('/').includes('..')) return null;
  if (!/(?:^|\/)deck-stage\.js$/i.test(clean)) return null;
  return clean.replace(/^\.\//, '');
}

export function getHtmlSlideRuntimeFilesForHtml(html: string, themeId?: string): HtmlSlideRuntimeFile[] {
  const slug = templateSlug(themeId);
  const themeDeckStage = beautifulDeckStageModules[modulePath(slug, 'deck-stage.js')];
  const paths = new Set<string>();
  for (const src of scriptSrcs(html)) {
    const path = runtimePathForScriptSrc(src);
    if (path) paths.add(path);
  }
  return [...paths].map((path) => ({ path, content: themeDeckStage ?? beautifulRuntimeDeckStageJs }));
}

export async function buildFrontendSlidesDesignRules(
  themeId?: string,
  outputMode: FrontendSlidesOutputMode = 'json',
): Promise<string> {
  const docs = await getFrontendSlidesTemplateDocs(themeId);
  const outputRule =
    outputMode === 'html'
      ? 'For HTML export, output one complete HTML document directly: <!DOCTYPE html>, <html>, <head>, template CSS/runtime, and all slides. Do not output MarkMind Slide[] JSON, PPTX JSON, markdown, or a partial fragment. Local sibling JavaScript files are allowed for provided template runtimes such as deck-stage.js. Remote JavaScript is allowed only when it already appears in the selected template.html, such as Chart.js in chart-heavy templates. Custom deck logic should stay inline. You may include a markmind-asset-intents JSON script for image placeholders; MarkMind will only resolve those image assets after generation.'
      : 'Output the app-requested structured data only. Do not output raw HTML/CSS.';
  return [
    `Adopt the vendored beautiful-html-templates template "${docs.name}" as the primary HTML slide design authority.`,
    `Source: ${docs.sourceUrl}`,
    'Use the beautiful-html-templates AGENTS.md workflow as the implementation contract: clone/adapt the selected template, replace placeholder content, duplicate/drop layouts as needed, and extend missing layouts inside the same visual system.',
    'Preserve fonts, palette, layout grid, slide-level CSS classes, decorative elements, spacing rhythm, component grammar, sizing model, viewport behavior, and the selected template navigation runtime. Replace demo content with the user document content.',
    'If the selected template uses deck-stage.js, keep the local script reference and MarkMind will save the supplied deck-stage.js next to the HTML file. Do not reference unknown local JS files or remote JavaScript that was not present in the selected template.html.',
    outputRule,
    `<beautiful-html-templates-agents path="AGENTS.md">\n${beautifulAgentsMd}\n</beautiful-html-templates-agents>`,
    `<beautiful-html-template-metadata path="templates/${docs.id}/template.json">\n${docs.templateJson}\n</beautiful-html-template-metadata>`,
    `<beautiful-html-template-design path="${docs.designPath}">\n${docs.beautifulDesignMd}\n</beautiful-html-template-design>`,
    `<beautiful-html-template-source path="templates/${docs.id}/template.html">\n${docs.templateHtml}\n</beautiful-html-template-source>`,
    `<beautiful-html-template-runtime path="runtime/deck-stage.js">\n${beautifulRuntimeDeckStageJs}\n</beautiful-html-template-runtime>`,
    docs.previewMd ? `<frontend-slides-template-preview path="${docs.previewPath}">\n${docs.previewMd}\n</frontend-slides-template-preview>` : '',
    docs.designMd
      ? `<frontend-slides-template-design-reference path="${FRONTEND_SLIDES_SKILL_PATH}/bold-template-pack/templates/${docs.id}/design.md">\n${docs.designMd}\n</frontend-slides-template-design-reference>`
      : '',
    `<frontend-slides-animation-reference path="${FRONTEND_SLIDES_SKILL_PATH}/animation-patterns.md">\n${animationPatternsMd}\n</frontend-slides-animation-reference>`,
  ]
    .filter(Boolean)
    .join('\n\n');
}
