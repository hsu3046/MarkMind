import type { HtmlSlideThemeId } from '../htmlSlideTheme';

export interface FrontendSlidesTemplateProfile {
  id: HtmlSlideThemeId;
  sourceTemplateUrl: string;
  layoutClasses: string[];
  componentGrammar: string[];
  htmlRecipes: string[];
  mustUse: string[];
  avoid: string[];
}

export const FRONTEND_SLIDES_TEMPLATE_PROFILES: Record<HtmlSlideThemeId, FrontendSlidesTemplateProfile> = {
  'blue-professional': {
    id: 'blue-professional',
    sourceTemplateUrl:
      'https://github.com/zarazhangrui/beautiful-html-templates/blob/main/templates/blue-professional/template.html',
    layoutClasses: [
      'layout-cover',
      'layout-agenda',
      'layout-metrics',
      'layout-dashboard',
      'layout-split',
      'layout-bars',
      'layout-quote',
      'layout-timeline',
      'layout-detail',
      'layout-closing',
    ],
    componentGrammar: [
      'Use the original wrapper pattern: <div class="slide layout-*">, <div class="slide-header">, <div class="slide-content">.',
      'Agenda slides use .agenda-grid with six .agenda-item cards, .agenda-num, h3, and concise p copy.',
      'Metrics slides use .metrics-row with .metric-card, .metric-value, .metric-label, .metric-desc, .metric-supports, and .metric-change positive/negative.',
      'Dashboard/detail slides should mix stats grids, detail columns, detail blocks, lists, and highlighted summary modules instead of plain cards.',
      'Bars slides use .bars-container, .bar-item, .bar-label, .bar-track, .bar-fill width percentages, .bar-pct, and .bar-note.',
      'Split slides use .split-body with .split-left insight lists and .split-right .split-highlight / mini-stat support.',
      'Timeline slides use .timeline-track and .timeline-step with .step-circle, h3, and short captions.',
      'Quote/closing slides rely on large decorative elements, quote marks, contact/CTA modules, and sparse text.',
    ],
    htmlRecipes: [
      'For a report/consulting deck, start with cover, then agenda or metrics, then dashboard/detail/bar/timeline evidence, then quote or closing.',
      'Prefer numerical or table-like evidence as .metric-card, .bar-item, .detail-block, or .stats-grid rather than bullets.',
      'If source content has no explicit metrics, derive qualitative metrics as short labels and evidence counts without inventing numbers.',
      'When using images, place them as large editorial panels in split/dashboard/cover areas, not as small thumbnails.',
    ],
    mustUse: [
      'Cream canvas, cobalt accent, strong header line, consulting-grade spacing rhythm.',
      'At least four distinct layout-* classes for decks with seven or more slides.',
      'One chart/table-like slide when the source has comparisons, lists, criteria, or evidence.',
    ],
    avoid: [
      'Do not turn every slide into generic bordered cards.',
      'Do not use arbitrary class names when an original layout-* class fits.',
      'Do not create marketing hero sections; keep it report/presentation oriented.',
    ],
  },
  'neo-grid-bold': {
    id: 'neo-grid-bold',
    sourceTemplateUrl:
      'https://github.com/zarazhangrui/beautiful-html-templates/blob/main/templates/neo-grid-bold/template.html',
    layoutClasses: [
      's-cover',
      's-toc',
      's-stats',
      's-features',
      's-chart',
      's-section',
      's-quote',
      's-cta',
      's-consult',
      's-chart2',
      's-process2',
      's-matrix2',
      's-system',
    ],
    componentGrammar: [
      'Use <section class="slide s-*"> with an inner .frame that is a strict 12-column x 8-row CSS grid.',
      'Every major child must occupy explicit grid-column and grid-row spans; sparse slides should feel intentionally blocked, not empty.',
      'Cover slides use panel-photo-l, panel-mid, panel-titletile, panel-photo-r, panel-cap, QR/blockmark, and hard black/accent panels.',
      'Stats slides use accent-l, copy, stat-a/stat-b/stat-c, and stat-big with oversized numeric type.',
      'Feature slides use .feat panels with .pic image blocks, .tag labels, uppercase h3, and dense supporting p text.',
      'Chart slides use pane-l/pane-r, .legend, .bars/.bar, .xaxis, or .plot with SVG paths and ticks.',
      'Process slides use .s-process2 .node n1-n5/out plus arrows and a bottom .timeline.',
      'Matrix slides use .s-matrix2 .table, .cell, .head-row, .row-label, and pill yes/part/no/note states.',
    ],
    htmlRecipes: [
      'Use block-grid composition first; content should be fitted into panels, not flowed like a document.',
      'For source lists, convert to poster-grid, process nodes, or matrix cells.',
      'For comparisons, use s-matrix2 or s-consult before using paragraph columns.',
      'For numeric or trend content, use s-stats, s-chart, or s-chart2 with simple CSS/SVG charts.',
    ],
    mustUse: [
      '12x8 grid, 40px-ish inset, 12-18px gaps, zero-radius panels, no shadows.',
      'Uppercase Space Grotesk display type and JetBrains Mono labels.',
      'At least one dense grid/data/process/matrix slide for decks with five or more slides.',
    ],
    avoid: [
      'Do not leave large blank areas in Neo-Grid; dense occupancy is part of the style.',
      'Do not use rounded cards or soft SaaS dashboard styling.',
      'Do not center all content in one panel.',
    ],
  },
  signal: {
    id: 'signal',
    sourceTemplateUrl: 'https://github.com/zarazhangrui/beautiful-html-templates/blob/main/templates/signal/template.html',
    layoutClasses: [
      'slide--cover',
      'slide--chapter',
      'slide--statement',
      'slide--split',
      'slide--stats',
      'slide--quote',
      'slide--list',
      'slide--compare',
      'slide--editorial',
      'slide--dense',
      'slide--end',
      'slide--chart',
      'slide--diagram',
      'slide--pie',
      'slide--pyramid',
      'slide--vtimeline',
      'slide--cycle',
      'slide--fullbleed',
    ],
    componentGrammar: [
      'Use <section class="slide dark|light slide--*"> with slide-chrome, slide-body, and slide-foot where the source template uses them.',
      'Headlines use Source Serif display type with gold italic <em> emphasis; body/chrome use DM Sans and IBM Plex Mono.',
      'Chapter slides use chapter-num and chapter-rule; statement slides use statement-body and large literary text blocks.',
      'Split slides use split-text and split-image; stats slides use stats-grid and stat-card.',
      'Chart/pie/pyramid/vtimeline/cycle slides use native CSS/SVG geometry, not screenshots or bullet lists.',
      'Editorial/dense slides use hairline rules, evidence ledgers, mono labels, and asymmetric zones.',
      'Animations should use lightweight data-anim/data-delay attributes only; no external animation library.',
    ],
    htmlRecipes: [
      'Use dark navy for institutional narrative slides and light cream for evidence/comparison slides.',
      'Turn conceptual structure into diagram, pyramid, cycle, vertical timeline, or editorial split whenever possible.',
      'Use quote and statement slides as rhythm changes, not as generic text slides.',
      'Use image panels as atmospheric editorial evidence with captions, not decorative thumbnails.',
    ],
    mustUse: [
      'Gold hairline/accent system, dark/light surface alternation, and editorial chrome.',
      'At least one diagram/chart/pyramid/cycle/vtimeline slide when the deck has analytical structure.',
      'At least four distinct slide--* classes for decks with seven or more slides.',
    ],
    avoid: [
      'Do not flatten Signal into plain cards on navy background.',
      'Do not overfill every slide; Signal should feel editorial and asymmetric.',
      'Do not use generic sans-only SaaS styling.',
    ],
  },
};

export function getFrontendSlidesTemplateProfile(themeId?: string): FrontendSlidesTemplateProfile {
  return (
    FRONTEND_SLIDES_TEMPLATE_PROFILES[(themeId as HtmlSlideThemeId) ?? 'blue-professional'] ??
    FRONTEND_SLIDES_TEMPLATE_PROFILES['blue-professional']
  );
}

export function buildTemplateProfilePrompt(themeId?: string): string {
  const profile = getFrontendSlidesTemplateProfile(themeId);
  return [
    `<beautiful-html-template-profile id="${profile.id}" source="${profile.sourceTemplateUrl}">`,
    `<layout-classes>${profile.layoutClasses.join(', ')}</layout-classes>`,
    '<component-grammar>',
    ...profile.componentGrammar.map((line) => `- ${line}`),
    '</component-grammar>',
    '<html-recipes>',
    ...profile.htmlRecipes.map((line) => `- ${line}`),
    '</html-recipes>',
    '<must-use>',
    ...profile.mustUse.map((line) => `- ${line}`),
    '</must-use>',
    '<avoid>',
    ...profile.avoid.map((line) => `- ${line}`),
    '</avoid>',
    '</beautiful-html-template-profile>',
  ].join('\n');
}
