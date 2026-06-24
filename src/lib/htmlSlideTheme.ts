import beautifulIndexJson from './htmlSlides/vendor/beautiful-html-templates/index.json?raw';

export type HtmlSlideThemeId = string;

export const HTML_SLIDE_AUTO_THEME_ID = 'auto';

export interface BeautifulHtmlTemplateMetadata {
  slug: string;
  name: string;
  tagline: string;
  mood: string[];
  occasion: string[];
  tone: string[];
  formality: string;
  density: string;
  scheme: 'light' | 'dark' | 'mixed' | string;
  best_for: string;
  avoid_for: string;
  slide_count: number;
}

interface BeautifulHtmlTemplateIndex {
  schema_version: number;
  template_count: number;
  templates: BeautifulHtmlTemplateMetadata[];
}

export interface HtmlSlideTheme {
  id: HtmlSlideThemeId;
  name: string;
  description: string;
  sourceUrl: string;
  fontLinks: string[];
  renderer: 'professional' | 'grid' | 'signal' | 'native';
  mood?: string[];
  tone?: string[];
  occasion?: string[];
  formality?: string;
  density?: string;
  scheme?: string;
  bestFor?: string;
  avoidFor?: string;
  slideCount?: number;
  colors: {
    stage: string;
    bg: string;
    surface: string;
    surfaceAlt: string;
    text: string;
    muted: string;
    accent: string;
    accent2: string;
    border: string;
    inverseText: string;
  };
  fonts: {
    display: string;
    body: string;
    mono: string;
  };
}

export const BEAUTIFUL_HTML_TEMPLATES_SOURCE = 'https://github.com/zarazhangrui/beautiful-html-templates';

const parsedIndex = JSON.parse(beautifulIndexJson) as BeautifulHtmlTemplateIndex;

export const BEAUTIFUL_HTML_TEMPLATE_METADATA: BeautifulHtmlTemplateMetadata[] = parsedIndex.templates;

const DEFAULT_FONT_LINKS = [
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+KR:wght@400;500;700&display=swap',
];

const SCHEME_COLORS: Record<string, HtmlSlideTheme['colors']> = {
  light: {
    stage: 'F5F4EF',
    bg: 'FDFAE7',
    surface: 'FFFFFF',
    surfaceAlt: 'ECECE8',
    text: '111111',
    muted: '6B6B6B',
    accent: '1E2BFA',
    accent2: '0A0A0A',
    border: 'D8D2C4',
    inverseText: 'FFFFFF',
  },
  dark: {
    stage: '080A12',
    bg: '101626',
    surface: '1B2438',
    surfaceAlt: '26324C',
    text: 'F5F0E8',
    muted: '9DA7B8',
    accent: 'F0A6CA',
    accent2: '5EDCF4',
    border: '34415F',
    inverseText: '0A0E17',
  },
  mixed: {
    stage: '0C1324',
    bg: '1C2644',
    surface: 'F0ECE3',
    surfaceAlt: '232F55',
    text: 'E2DCD0',
    muted: '8A96A8',
    accent: 'C8A870',
    accent2: 'F0ECE3',
    border: '2E3D5C',
    inverseText: '1A2030',
  },
};

const LEGACY_OVERRIDES: Record<string, Partial<HtmlSlideTheme>> = {
  'blue-professional': {
    renderer: 'professional',
    fontLinks: [
      'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+KR:wght@400;500;700&family=Space+Grotesk:wght@500;600;700&display=swap',
    ],
    colors: {
      stage: '07111F',
      bg: 'FDFAE7',
      surface: 'F2EFD9',
      surfaceAlt: 'EEF0FF',
      text: '111111',
      muted: '6B6B6B',
      accent: '1E2BFA',
      accent2: '1E2BFA',
      border: 'C8CEF9',
      inverseText: 'FDFAE7',
    },
    fonts: {
      display: "'Space Grotesk', 'Noto Sans KR', sans-serif",
      body: "'Inter', 'Noto Sans KR', sans-serif",
      mono: "'Space Grotesk', 'Noto Sans KR', sans-serif",
    },
  },
  'neo-grid-bold': {
    renderer: 'grid',
    fontLinks: [
      'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Noto+Sans+KR:wght@400;700;900&family=Space+Grotesk:wght@400;500;700&display=swap',
    ],
    colors: {
      stage: '1A1A1A',
      bg: 'ECECE8',
      surface: 'F5F4EF',
      surfaceAlt: '0A0A0A',
      text: '0A0A0A',
      muted: '8A8A85',
      accent: 'E6FF3D',
      accent2: '0A0A0A',
      border: '0A0A0A',
      inverseText: 'F5F4EF',
    },
    fonts: {
      display: "'Space Grotesk', 'Noto Sans KR', sans-serif",
      body: "'Space Grotesk', 'Noto Sans KR', sans-serif",
      mono: "'JetBrains Mono', 'Noto Sans KR', monospace",
    },
  },
  signal: {
    renderer: 'signal',
    fontLinks: [
      'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500&family=Noto+Sans+KR:wght@400;500;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&display=swap',
    ],
    colors: {
      stage: '0C1324',
      bg: '1C2644',
      surface: 'F0ECE3',
      surfaceAlt: '232F55',
      text: 'E2DCD0',
      muted: '8A96A8',
      accent: 'C8A870',
      accent2: 'F0ECE3',
      border: '2E3D5C',
      inverseText: '1A2030',
    },
    fonts: {
      display: "'Source Serif 4', 'Noto Sans KR', serif",
      body: "'DM Sans', 'Noto Sans KR', sans-serif",
      mono: "'IBM Plex Mono', 'Noto Sans KR', monospace",
    },
  },
};

function fallbackColors(scheme?: string): HtmlSlideTheme['colors'] {
  return SCHEME_COLORS[scheme || ''] ?? SCHEME_COLORS.light;
}

function themeFromMetadata(meta: BeautifulHtmlTemplateMetadata): HtmlSlideTheme {
  const override = LEGACY_OVERRIDES[meta.slug] ?? {};
  return {
    id: meta.slug,
    name: meta.name,
    description: meta.tagline,
    sourceUrl: `${BEAUTIFUL_HTML_TEMPLATES_SOURCE}/tree/main/templates/${meta.slug}`,
    fontLinks: override.fontLinks ?? DEFAULT_FONT_LINKS,
    renderer: override.renderer ?? 'native',
    mood: meta.mood,
    tone: meta.tone,
    occasion: meta.occasion,
    formality: meta.formality,
    density: meta.density,
    scheme: meta.scheme,
    bestFor: meta.best_for,
    avoidFor: meta.avoid_for,
    slideCount: meta.slide_count,
    colors: override.colors ?? fallbackColors(meta.scheme),
    fonts: override.fonts ?? {
      display: "'Inter', 'Noto Sans KR', sans-serif",
      body: "'Inter', 'Noto Sans KR', sans-serif",
      mono: "'Menlo', 'Consolas', monospace",
    },
  };
}

export const HTML_SLIDE_THEMES: HtmlSlideTheme[] = BEAUTIFUL_HTML_TEMPLATE_METADATA.map(themeFromMetadata);

export const DEFAULT_HTML_SLIDE_THEME = HTML_SLIDE_THEMES.find((theme) => theme.id === 'blue-professional') ?? HTML_SLIDE_THEMES[0];

export const AUTO_HTML_SLIDE_THEME: HtmlSlideTheme = {
  ...DEFAULT_HTML_SLIDE_THEME,
  id: HTML_SLIDE_AUTO_THEME_ID,
  name: '자동',
  description: '문서의 목적, 톤, 정보 밀도에 맞춰 템플릿을 자동 선택',
  mood: ['auto'],
  tone: ['auto'],
};

export const HTML_SLIDE_THEME_OPTIONS: HtmlSlideTheme[] = [AUTO_HTML_SLIDE_THEME, ...HTML_SLIDE_THEMES];

export function getHtmlSlideTheme(themeId?: string): HtmlSlideTheme {
  if (themeId === HTML_SLIDE_AUTO_THEME_ID) return AUTO_HTML_SLIDE_THEME;
  return HTML_SLIDE_THEMES.find((theme) => theme.id === themeId) ?? DEFAULT_HTML_SLIDE_THEME;
}

export function getConcreteHtmlSlideTheme(themeId?: string): HtmlSlideTheme {
  if (!themeId || themeId === HTML_SLIDE_AUTO_THEME_ID) return DEFAULT_HTML_SLIDE_THEME;
  return getHtmlSlideTheme(themeId);
}

export function isAutoHtmlSlideTheme(themeId?: string): boolean {
  return themeId === HTML_SLIDE_AUTO_THEME_ID;
}
