import { MARKMIND_PPTX_FREE_FONTS } from './pptxDesignSystem';

export type SlideThemeId = 'midnight-surge' | 'bold-sunrise' | 'mono-edge';

export type SlideMotif = 'band' | 'corner-block' | 'frame';

export interface SlideTheme {
  id: SlideThemeId | string;
  name: string;
  description: string;
  palette: {
    bg: string;
    surface: string;
    surfaceAlt: string;
    title: string;
    body: string;
    muted: string;
    accent: string;
    accent2: string;
    inverseText: string;
    codeBg: string;
    codeFg: string;
    border: string;
    chart: string[];
  };
  fonts: {
    heading: string;
    body: string;
    mono: string;
    useLanguageFallback?: boolean;
  };
  typeScale: {
    coverTitle: number;
    title: number;
    section: number;
    body: number;
    caption: number;
    stat: number;
  };
  spacing: {
    marginX: number;
    titleY: number;
    bodyTop: number;
    bodyBottom: number;
    gap: number;
    columnGap: number;
  };
  shape: {
    radius: number;
    motif: SlideMotif;
  };
  rules: string[];
}

export interface SlideExportOptions {
  themeId: string;
  audience?: string;
  tone?: string;
  language?: string;
  slideCountHint?: string;
  draftPurpose?: string;
  draftStructure?: string;
  draftDepth?: string;
  draftRevisionMode?: string;
  draftReviewMode?: string;
  designLayout?: string;
  visualDensity?: string;
  imagePolicy?: string;
  imageSourceMode?: string;
  fontPreference?: string;
  fontFamily?: string;
  marginPreference?: string;
  htmlThemeId?: string;
  htmlTransition?: string;
  extraInstructions?: string;
  designRules?: string;
}

const cleanHex = (value: string, fallback = '000000') => {
  const normalized = value.trim().replace(/^#/, '').toUpperCase();
  return /^[0-9A-F]{6}$/.test(normalized) ? normalized : fallback;
};

function theme(input: SlideTheme): SlideTheme {
  return {
    ...input,
    palette: {
      ...input.palette,
      bg: cleanHex(input.palette.bg, 'FFFFFF'),
      surface: cleanHex(input.palette.surface, 'FFFFFF'),
      surfaceAlt: cleanHex(input.palette.surfaceAlt, 'F4F5F7'),
      title: cleanHex(input.palette.title, '1A1A2E'),
      body: cleanHex(input.palette.body, '2D2D3A'),
      muted: cleanHex(input.palette.muted, '7A8190'),
      accent: cleanHex(input.palette.accent, '2F6FED'),
      accent2: cleanHex(input.palette.accent2, '00A896'),
      inverseText: cleanHex(input.palette.inverseText, 'FFFFFF'),
      codeBg: cleanHex(input.palette.codeBg, 'F4F5F7'),
      codeFg: cleanHex(input.palette.codeFg, '24292F'),
      border: cleanHex(input.palette.border, 'D7DAE0'),
      chart: input.palette.chart.map((c) => cleanHex(c, '2F6FED')),
    },
  };
}

export const BUILTIN_SLIDE_THEMES: SlideTheme[] = [
  theme({
    id: 'midnight-surge',
    name: 'Midnight Surge',
    description: '어두운 커버와 선명한 시안 포인트의 피치덱 스타일',
    palette: {
      bg: 'F7FAFC',
      surface: 'FFFFFF',
      surfaceAlt: 'EAF1F7',
      title: '101827',
      body: '283447',
      muted: '6A7485',
      accent: '007294',
      accent2: '6EE7B7',
      inverseText: 'F8FBFF',
      codeBg: 'E8EEF5',
      codeFg: '172033',
      border: 'D3DCE8',
      chart: ['007294', '6EE7B7', '7C8CF8', 'FBBF24'],
    },
    fonts: {
      heading: MARKMIND_PPTX_FREE_FONTS.latinHeading,
      body: MARKMIND_PPTX_FREE_FONTS.latinBody,
      mono: MARKMIND_PPTX_FREE_FONTS.mono,
    },
    typeScale: { coverTitle: 44, title: 28, section: 34, body: 16, caption: 11, stat: 62 },
    spacing: { marginX: 0.72, titleY: 0.42, bodyTop: 1.52, bodyBottom: 7.0, gap: 0.16, columnGap: 0.42 },
    shape: { radius: 0.08, motif: 'corner-block' },
    rules: [
      'Use dark title and divider slides with light content slides.',
      'Use cyan as a sharp accent, not as a full-slide wash.',
      'Avoid decorative title underlines.',
      'Use free multilingual fonts: Pretendard for Korean and Noto Sans families for other languages.',
    ],
  }),
  theme({
    id: 'bold-sunrise',
    name: 'Bold Sunrise',
    description: '따뜻한 배경과 강한 코랄/네이비 대비의 발표 자료',
    palette: {
      bg: 'FFF8ED',
      surface: 'FFFFFF',
      surfaceAlt: 'FFE8CF',
      title: '18253D',
      body: '2E3545',
      muted: '7C6F63',
      accent: 'F05A43',
      accent2: 'F7B731',
      inverseText: 'FFFFFF',
      codeBg: 'F8E8D7',
      codeFg: '2B2118',
      border: 'E8CFB3',
      chart: ['F05A43', 'F7B731', '18253D', '65A30D'],
    },
    fonts: {
      heading: MARKMIND_PPTX_FREE_FONTS.latinHeading,
      body: MARKMIND_PPTX_FREE_FONTS.latinBody,
      mono: MARKMIND_PPTX_FREE_FONTS.mono,
    },
    typeScale: { coverTitle: 42, title: 27, section: 33, body: 16, caption: 11, stat: 64 },
    spacing: { marginX: 0.74, titleY: 0.44, bodyTop: 1.54, bodyBottom: 7.0, gap: 0.17, columnGap: 0.46 },
    shape: { radius: 0.06, motif: 'band' },
    rules: [
      'Use warm light slides with dark, editorial title slides.',
      'Use coral for emphasis and calls to action.',
      'Keep body text restrained and left-aligned.',
      'Avoid serif display fonts for Korean titles; use Pretendard/Noto Sans unless a Latin-only serif option is explicitly selected.',
    ],
  }),
  theme({
    id: 'mono-edge',
    name: 'Mono Edge',
    description: '고대비 흑백 구조에 라임 포인트를 더한 기술/분석형 테마',
    palette: {
      bg: 'F2F4F1',
      surface: 'FFFFFF',
      surfaceAlt: 'E2E7DE',
      title: '111111',
      body: '242424',
      muted: '6F756B',
      accent: 'B6E600',
      accent2: '111111',
      inverseText: 'FFFFFF',
      codeBg: '111111',
      codeFg: 'EAF9B8',
      border: 'C9D1C2',
      chart: ['111111', 'B6E600', '6F756B', 'D8E2D0'],
    },
    fonts: {
      heading: MARKMIND_PPTX_FREE_FONTS.latinHeading,
      body: MARKMIND_PPTX_FREE_FONTS.latinBody,
      mono: MARKMIND_PPTX_FREE_FONTS.mono,
    },
    typeScale: { coverTitle: 40, title: 26, section: 32, body: 15, caption: 10, stat: 60 },
    spacing: { marginX: 0.7, titleY: 0.42, bodyTop: 1.48, bodyBottom: 7.02, gap: 0.15, columnGap: 0.4 },
    shape: { radius: 0, motif: 'frame' },
    rules: [
      'Use monochrome structure with lime accents only for hierarchy.',
      'Prefer framed content blocks and strong alignment.',
      'Avoid soft gradients and decorative title underlines.',
      'Use Noto Sans Display and Noto Sans Mono rather than heavy system display fonts.',
    ],
  }),
];

export const DEFAULT_SLIDE_THEME = BUILTIN_SLIDE_THEMES[0];

export function getSlideTheme(themeId?: string): SlideTheme {
  return BUILTIN_SLIDE_THEMES.find((t) => t.id === themeId) ?? DEFAULT_SLIDE_THEME;
}

export function applySlideDesignOptions(theme: SlideTheme, options: SlideExportOptions): SlideTheme {
  const next: SlideTheme = {
    ...theme,
    fonts: { ...theme.fonts },
    spacing: { ...theme.spacing },
    typeScale: { ...theme.typeScale },
    rules: [...theme.rules],
  };

  if (
    options.fontPreference === 'modern sans-serif font pairing' ||
    options.fontPreference === 'free multilingual sans font pairing'
  ) {
    next.fonts = {
      heading: MARKMIND_PPTX_FREE_FONTS.latinHeading,
      body: MARKMIND_PPTX_FREE_FONTS.latinBody,
      mono: MARKMIND_PPTX_FREE_FONTS.mono,
    };
  } else if (
    options.fontPreference === 'serif headline with clean body font' ||
    options.fontPreference === 'free editorial serif headline with sans body'
  ) {
    next.fonts = {
      heading: MARKMIND_PPTX_FREE_FONTS.serifHeading,
      body: MARKMIND_PPTX_FREE_FONTS.latinBody,
      mono: MARKMIND_PPTX_FREE_FONTS.mono,
    };
  } else if (
    options.fontPreference === 'bold editorial headline font pairing' ||
    options.fontPreference === 'technical sans and mono font pairing'
  ) {
    next.fonts = {
      heading: MARKMIND_PPTX_FREE_FONTS.latinHeading,
      body: MARKMIND_PPTX_FREE_FONTS.latinBody,
      mono: MARKMIND_PPTX_FREE_FONTS.mono,
    };
  }

  if (options.fontFamily?.trim()) {
    const fontFamily = options.fontFamily.trim();
    next.fonts = {
      ...next.fonts,
      heading: fontFamily,
      body: fontFamily,
      useLanguageFallback: false,
    };
    next.rules.push(`Use installed font family "${fontFamily}" for headings and body text.`);
  }

  if (options.marginPreference === 'wide margins with generous whitespace') {
    next.spacing.marginX = Math.min(0.98, theme.spacing.marginX + 0.16);
    next.spacing.bodyTop = Math.min(1.72, theme.spacing.bodyTop + 0.08);
    next.spacing.gap = Math.min(0.24, theme.spacing.gap + 0.04);
    next.spacing.columnGap = Math.min(0.58, theme.spacing.columnGap + 0.08);
  } else if (options.marginPreference === 'compact margins for information-heavy decks') {
    next.spacing.marginX = Math.max(0.56, theme.spacing.marginX - 0.12);
    next.spacing.bodyTop = Math.max(1.34, theme.spacing.bodyTop - 0.06);
    next.spacing.gap = Math.max(0.12, theme.spacing.gap - 0.02);
    next.spacing.columnGap = Math.max(0.34, theme.spacing.columnGap - 0.04);
  }

  if (options.visualDensity === 'minimal text with strong whitespace and visual hierarchy') {
    next.typeScale.body = theme.typeScale.body + 1;
    next.typeScale.caption = theme.typeScale.caption + 1;
    next.spacing.gap = Math.min(0.25, next.spacing.gap + 0.03);
  } else if (options.visualDensity === 'information-dense but still readable slide composition') {
    next.typeScale.body = Math.max(13, theme.typeScale.body - 1);
    next.typeScale.caption = Math.max(9, theme.typeScale.caption - 1);
    next.spacing.gap = Math.max(0.11, next.spacing.gap - 0.02);
  }

  return next;
}
