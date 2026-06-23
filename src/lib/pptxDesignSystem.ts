export const MARKMIND_PPTX_FREE_FONTS = {
  latinHeading: 'Noto Sans Display',
  latinBody: 'Noto Sans',
  serifHeading: 'Noto Serif Display',
  serifBody: 'Noto Serif',
  korean: 'Pretendard',
  japanese: 'Noto Sans JP',
  chineseSimplified: 'Noto Sans SC',
  chineseTraditional: 'Noto Sans TC',
  panCjk: 'Noto Sans CJK KR',
  mono: 'Noto Sans Mono',
} as const;

const HANGUL_RE = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/;
const KANA_RE = /[\u3040-\u30ff]/;
const CJK_IDEOGRAPH_RE = /[\u3400-\u9fff]/;
const TRADITIONAL_HINT_RE = /[臺灣體國學會與門開關廣東華]/;

export function pptxFontFaceForText(
  text: string,
  themeFont: string,
  role: 'heading' | 'body' | 'mono' = 'body',
): string {
  if (role === 'mono') return MARKMIND_PPTX_FREE_FONTS.mono;
  if (HANGUL_RE.test(text)) return MARKMIND_PPTX_FREE_FONTS.korean;
  if (KANA_RE.test(text)) return MARKMIND_PPTX_FREE_FONTS.japanese;
  if (CJK_IDEOGRAPH_RE.test(text)) {
    return TRADITIONAL_HINT_RE.test(text)
      ? MARKMIND_PPTX_FREE_FONTS.chineseTraditional
      : MARKMIND_PPTX_FREE_FONTS.chineseSimplified;
  }
  return themeFont;
}

export const MARKMIND_PPTX_DESIGN_RULES = [
  'Renderer-owned design: the LLM chooses slide role, layout enum, semantic blocks, and image intent only; MarkMind code owns colors, typography, spacing, coordinates, contrast, and overflow.',
  'Output must remain editable PowerPoint: use native text boxes, shapes, tables, charts, and image objects; never flatten a whole slide into one generated image.',
  'Every content slide needs visible structure beyond title plus floating text: card grid, two-column cards, comparison blocks, stat callout, quote treatment, timeline/process, image-focus, or framed evidence.',
  'Use one motif per deck and make it structural: side rail, corner block, frame, or subtle band. Avoid thick full-width footer bars and decorative title underlines.',
  'Use the user-selected installed font family for headings and body text when provided; otherwise use high-quality free/open fonts by language: Pretendard for Korean, Noto Sans JP for Japanese, Noto Sans SC/TC or Noto Sans CJK for Chinese, Noto Sans/Noto Sans Display for Latin, and Noto Sans Mono for code.',
  'Hide implementation artifacts: never show (root), source IDs such as S1/S2, hidden draft markers, renderer notes, raw design tokens, or JSON fields on a slide.',
  'Fit check wins over style: if content would overflow, shorten, split, or choose a denser layout; do not rely on tiny body text.',
  'Image policy: prefer source/user images for factual content, stock/logo providers for real-world subjects, and generated images for abstract or custom concept visuals.',
  'QA each slide for text, layout, color, image relevance, and narrative coherence before final output.',
] as const;

export function markMindPptxDesignRulesText(extraRules?: string): string {
  const lines = [
    'MarkMind PPTX design system:',
    ...MARKMIND_PPTX_DESIGN_RULES.map((rule) => `- ${rule}`),
  ];
  const extra = extraRules?.trim();
  if (extra) {
    lines.push('User-added design rules:');
    lines.push(extra);
  }
  return lines.join('\n');
}
