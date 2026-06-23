import type { HtmlSlideThemeId } from '../htmlSlideTheme';
import animationPatternsMd from './vendor/frontend-slides/animation-patterns.md?raw';
import htmlTemplateMd from './vendor/frontend-slides/html-template.md?raw';
import viewportBaseCss from './vendor/frontend-slides/viewport-base.css?raw';
import blueProfessionalDesignMd from './vendor/frontend-slides/bold-template-pack/templates/blue-professional/design.md?raw';
import blueProfessionalPreviewMd from './vendor/frontend-slides/bold-template-pack/templates/blue-professional/preview.md?raw';
import neoGridBoldDesignMd from './vendor/frontend-slides/bold-template-pack/templates/neo-grid-bold/design.md?raw';
import neoGridBoldPreviewMd from './vendor/frontend-slides/bold-template-pack/templates/neo-grid-bold/preview.md?raw';
import signalDesignMd from './vendor/frontend-slides/bold-template-pack/templates/signal/design.md?raw';
import signalPreviewMd from './vendor/frontend-slides/bold-template-pack/templates/signal/preview.md?raw';

export interface FrontendSlidesTemplateDocs {
  id: HtmlSlideThemeId;
  name: string;
  sourceUrl: string;
  previewPath: string;
  designPath: string;
  previewMd: string;
  designMd: string;
}

export const FRONTEND_SLIDES_VENDOR_SOURCE = 'https://github.com/zarazhangrui/frontend-slides';

const TEMPLATE_DOCS: Record<HtmlSlideThemeId, FrontendSlidesTemplateDocs> = {
  'blue-professional': {
    id: 'blue-professional',
    name: 'Blue Professional',
    sourceUrl: `${FRONTEND_SLIDES_VENDOR_SOURCE}/tree/main/bold-template-pack/templates/blue-professional`,
    previewPath: 'bold-template-pack/templates/blue-professional/preview.md',
    designPath: 'bold-template-pack/templates/blue-professional/design.md',
    previewMd: blueProfessionalPreviewMd,
    designMd: blueProfessionalDesignMd,
  },
  'neo-grid-bold': {
    id: 'neo-grid-bold',
    name: 'Neo-Grid Bold',
    sourceUrl: `${FRONTEND_SLIDES_VENDOR_SOURCE}/tree/main/bold-template-pack/templates/neo-grid-bold`,
    previewPath: 'bold-template-pack/templates/neo-grid-bold/preview.md',
    designPath: 'bold-template-pack/templates/neo-grid-bold/design.md',
    previewMd: neoGridBoldPreviewMd,
    designMd: neoGridBoldDesignMd,
  },
  signal: {
    id: 'signal',
    name: 'Signal',
    sourceUrl: `${FRONTEND_SLIDES_VENDOR_SOURCE}/tree/main/bold-template-pack/templates/signal`,
    previewPath: 'bold-template-pack/templates/signal/preview.md',
    designPath: 'bold-template-pack/templates/signal/design.md',
    previewMd: signalPreviewMd,
    designMd: signalDesignMd,
  },
};

export function getFrontendSlidesTemplateDocs(themeId?: string): FrontendSlidesTemplateDocs {
  return TEMPLATE_DOCS[(themeId as HtmlSlideThemeId) ?? 'blue-professional'] ?? TEMPLATE_DOCS['blue-professional'];
}

export function buildFrontendSlidesDesignRules(themeId?: string): string {
  const docs = getFrontendSlidesTemplateDocs(themeId);
  return [
    `Adopt the vendored frontend-slides template "${docs.name}" as the primary HTML slide design authority.`,
    `Source: ${docs.sourceUrl}`,
    'Preserve its visual grammar: typography roles, color constraints, spacing rhythm, layout vocabulary, image treatment, and anti-patterns. If generic MarkMind rules conflict with the selected template design.md, follow the selected template design.md.',
    'MarkMind runs this in autonomous generation mode: use preview.md only as a visual reference for the selected template, not as a request to create multiple style previews or ask the user to choose.',
    'Infer the final deck art direction yourself, then apply it consistently across cover, section, content, evidence, quote, image, and closing slides.',
    'Use the fixed-stage browser slide model described by frontend-slides. Plan for a 1920x1080 canvas scaled to the viewport, not for editable PowerPoint placeholders.',
    'Prefer distinctive HTML-native slide structures: full-bleed or large media regions, poster-like grids, dense editorial panels, strong section dividers, and progressive visual hierarchy.',
    'Output JSON only. Do not output raw HTML/CSS. The MarkMind HTML renderer will implement the style.',
    `<frontend-slides-html-template path="html-template.md">\n${htmlTemplateMd}\n</frontend-slides-html-template>`,
    `<frontend-slides-viewport-base path="viewport-base.css">\n${viewportBaseCss}\n</frontend-slides-viewport-base>`,
    `<frontend-slides-animation-patterns path="animation-patterns.md">\n${animationPatternsMd}\n</frontend-slides-animation-patterns>`,
    `<frontend-slides-template-preview path="${docs.previewPath}">\n${docs.previewMd}\n</frontend-slides-template-preview>`,
    `<frontend-slides-template-design path="${docs.designPath}">\n${docs.designMd}\n</frontend-slides-template-design>`,
  ].join('\n\n');
}
