export type HtmlSlideThemeId = 'blue-professional' | 'neo-grid-bold' | 'signal';

export interface HtmlSlideTheme {
  id: HtmlSlideThemeId;
  name: string;
  description: string;
  sourceUrl: string;
  fontLinks: string[];
  renderer: 'professional' | 'grid' | 'signal';
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

export const HTML_SLIDE_THEMES: HtmlSlideTheme[] = [
  {
    id: 'blue-professional',
    name: 'Blue Professional',
    description: '크림 배경과 코발트 단일 포인트의 컨설팅/보고서형 HTML 슬라이드',
    sourceUrl: 'https://github.com/zarazhangrui/beautiful-html-templates/tree/main/templates/blue-professional',
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
  {
    id: 'neo-grid-bold',
    name: 'Neo-Grid Bold',
    description: '12x8 그리드, 블랙/에크루/네온 옐로우 패널의 에디토리얼 포스터형',
    sourceUrl: 'https://github.com/zarazhangrui/beautiful-html-templates/tree/main/templates/neo-grid-bold',
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
  {
    id: 'signal',
    name: 'Signal',
    description: '딥 네이비/크림 이중 표면과 골드 헤어라인의 기관형 에디토리얼 슬라이드',
    sourceUrl: 'https://github.com/zarazhangrui/beautiful-html-templates/tree/main/templates/signal',
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
];

export const DEFAULT_HTML_SLIDE_THEME = HTML_SLIDE_THEMES[0];

export function getHtmlSlideTheme(themeId?: string): HtmlSlideTheme {
  return HTML_SLIDE_THEMES.find((theme) => theme.id === themeId) ?? DEFAULT_HTML_SLIDE_THEME;
}
