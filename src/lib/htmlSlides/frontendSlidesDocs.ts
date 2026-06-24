import type { HtmlSlideThemeId } from '../htmlSlideTheme';
import blueProfessionalDesignMd from './vendor/frontend-slides/plugins/frontend-slides/skills/frontend-slides/bold-template-pack/templates/blue-professional/design.md?raw';
import blueProfessionalPreviewMd from './vendor/frontend-slides/plugins/frontend-slides/skills/frontend-slides/bold-template-pack/templates/blue-professional/preview.md?raw';
import animationPatternsMd from './vendor/frontend-slides/animation-patterns.md?raw';
import neoGridBoldDesignMd from './vendor/frontend-slides/plugins/frontend-slides/skills/frontend-slides/bold-template-pack/templates/neo-grid-bold/design.md?raw';
import neoGridBoldPreviewMd from './vendor/frontend-slides/plugins/frontend-slides/skills/frontend-slides/bold-template-pack/templates/neo-grid-bold/preview.md?raw';
import signalDesignMd from './vendor/frontend-slides/plugins/frontend-slides/skills/frontend-slides/bold-template-pack/templates/signal/design.md?raw';
import signalPreviewMd from './vendor/frontend-slides/plugins/frontend-slides/skills/frontend-slides/bold-template-pack/templates/signal/preview.md?raw';
import beautifulAgentsMd from './vendor/beautiful-html-templates/AGENTS.md?raw';
import beautifulIndexJson from './vendor/beautiful-html-templates/index.json?raw';
import beautifulRuntimeDeckStageJs from './vendor/beautiful-html-templates/runtime/deck-stage.js?raw';
import blueProfessionalOriginalDesignMd from './vendor/beautiful-html-templates/templates/blue-professional/design.md?raw';
import blueProfessionalTemplateHtml from './vendor/beautiful-html-templates/templates/blue-professional/template.html?raw';
import blueProfessionalTemplateJson from './vendor/beautiful-html-templates/templates/blue-professional/template.json?raw';
import neoGridBoldOriginalDesignMd from './vendor/beautiful-html-templates/templates/neo-grid-bold/design.md?raw';
import neoGridBoldTemplateHtml from './vendor/beautiful-html-templates/templates/neo-grid-bold/template.html?raw';
import neoGridBoldTemplateJson from './vendor/beautiful-html-templates/templates/neo-grid-bold/template.json?raw';
import signalOriginalDesignMd from './vendor/beautiful-html-templates/templates/signal/design.md?raw';
import signalTemplateHtml from './vendor/beautiful-html-templates/templates/signal/template.html?raw';
import signalTemplateJson from './vendor/beautiful-html-templates/templates/signal/template.json?raw';

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
}

export const FRONTEND_SLIDES_VENDOR_SOURCE = 'https://github.com/zarazhangrui/frontend-slides';
export const FRONTEND_SLIDES_SKILL_PATH = 'plugins/frontend-slides/skills/frontend-slides';
export const FRONTEND_SLIDES_SKILL_SOURCE = `${FRONTEND_SLIDES_VENDOR_SOURCE}/tree/main/${FRONTEND_SLIDES_SKILL_PATH}`;
export const BEAUTIFUL_HTML_TEMPLATES_VENDOR_SOURCE = 'https://github.com/zarazhangrui/beautiful-html-templates';

export interface HtmlSlideRuntimeFile {
  path: string;
  content: string;
}

const TEMPLATE_DOCS: Record<HtmlSlideThemeId, FrontendSlidesTemplateDocs> = {
  'blue-professional': {
    id: 'blue-professional',
    name: 'Blue Professional',
    sourceUrl: `${BEAUTIFUL_HTML_TEMPLATES_VENDOR_SOURCE}/tree/main/templates/blue-professional`,
    previewPath: `${FRONTEND_SLIDES_SKILL_PATH}/bold-template-pack/templates/blue-professional/preview.md`,
    designPath: 'templates/blue-professional/design.md',
    previewMd: blueProfessionalPreviewMd,
    designMd: blueProfessionalDesignMd,
    beautifulDesignMd: blueProfessionalOriginalDesignMd,
    templateJson: blueProfessionalTemplateJson,
    templateHtml: blueProfessionalTemplateHtml,
  },
  'neo-grid-bold': {
    id: 'neo-grid-bold',
    name: 'Neo-Grid Bold',
    sourceUrl: `${BEAUTIFUL_HTML_TEMPLATES_VENDOR_SOURCE}/tree/main/templates/neo-grid-bold`,
    previewPath: `${FRONTEND_SLIDES_SKILL_PATH}/bold-template-pack/templates/neo-grid-bold/preview.md`,
    designPath: 'templates/neo-grid-bold/design.md',
    previewMd: neoGridBoldPreviewMd,
    designMd: neoGridBoldDesignMd,
    beautifulDesignMd: neoGridBoldOriginalDesignMd,
    templateJson: neoGridBoldTemplateJson,
    templateHtml: neoGridBoldTemplateHtml,
  },
  signal: {
    id: 'signal',
    name: 'Signal',
    sourceUrl: `${BEAUTIFUL_HTML_TEMPLATES_VENDOR_SOURCE}/tree/main/templates/signal`,
    previewPath: `${FRONTEND_SLIDES_SKILL_PATH}/bold-template-pack/templates/signal/preview.md`,
    designPath: 'templates/signal/design.md',
    previewMd: signalPreviewMd,
    designMd: signalDesignMd,
    beautifulDesignMd: signalOriginalDesignMd,
    templateJson: signalTemplateJson,
    templateHtml: signalTemplateHtml,
  },
};

export function getFrontendSlidesTemplateDocs(themeId?: string): FrontendSlidesTemplateDocs {
  return TEMPLATE_DOCS[(themeId as HtmlSlideThemeId) ?? 'blue-professional'] ?? TEMPLATE_DOCS['blue-professional'];
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

export function getHtmlSlideRuntimeFilesForHtml(html: string): HtmlSlideRuntimeFile[] {
  const paths = new Set<string>();
  for (const src of scriptSrcs(html)) {
    const path = runtimePathForScriptSrc(src);
    if (path) paths.add(path);
  }
  return [...paths].map((path) => ({ path, content: beautifulRuntimeDeckStageJs }));
}

export function buildFrontendSlidesDesignRules(themeId?: string, outputMode: FrontendSlidesOutputMode = 'json'): string {
  const docs = getFrontendSlidesTemplateDocs(themeId);
  const outputRule =
    outputMode === 'html'
      ? 'For HTML export, output one complete HTML document directly: <!DOCTYPE html>, <html>, <head>, template CSS/runtime, and all slides. Do not output MarkMind Slide[] JSON, PPTX JSON, markdown, or a partial fragment. Local sibling JavaScript files are allowed only for provided template runtimes such as deck-stage.js; custom deck logic should stay inline. You may include a markmind-asset-intents JSON script for image placeholders; MarkMind will only resolve those image assets after generation.'
      : 'Output the app-requested structured data only. Do not output raw HTML/CSS.';
  return [
    `Adopt the vendored beautiful-html-templates template "${docs.name}" as the primary HTML slide design authority.`,
    `Source: ${docs.sourceUrl}`,
    'Use the beautiful-html-templates AGENTS.md workflow as the implementation contract: clone/adapt the selected template, replace placeholder content, duplicate/drop layouts as needed, and extend missing layouts inside the same visual system.',
    'Preserve fonts, palette, layout grid, slide-level CSS classes, decorative elements, spacing rhythm, component grammar, sizing model, viewport behavior, and the selected template navigation runtime. Replace demo content with the user document content.',
    'If the selected template uses deck-stage.js, keep the local script reference and MarkMind will save the supplied deck-stage.js next to the HTML file. Do not reference unknown local JS files or remote JavaScript.',
    outputRule,
    `<beautiful-html-templates-agents path="AGENTS.md">\n${beautifulAgentsMd}\n</beautiful-html-templates-agents>`,
    `<beautiful-html-templates-index path="index.json">\n${beautifulIndexJson}\n</beautiful-html-templates-index>`,
    `<beautiful-html-template-metadata path="templates/${docs.id}/template.json">\n${docs.templateJson}\n</beautiful-html-template-metadata>`,
    `<beautiful-html-template-design path="${docs.designPath}">\n${docs.beautifulDesignMd}\n</beautiful-html-template-design>`,
    `<beautiful-html-template-source path="templates/${docs.id}/template.html">\n${docs.templateHtml}\n</beautiful-html-template-source>`,
    `<beautiful-html-template-runtime path="runtime/deck-stage.js">\n${beautifulRuntimeDeckStageJs}\n</beautiful-html-template-runtime>`,
    `<frontend-slides-template-preview path="${docs.previewPath}">\n${docs.previewMd}\n</frontend-slides-template-preview>`,
    `<frontend-slides-animation-reference path="${FRONTEND_SLIDES_SKILL_PATH}/animation-patterns.md">\n${animationPatternsMd}\n</frontend-slides-animation-reference>`,
  ].join('\n\n');
}
