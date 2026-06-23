import { describe, expect, it } from 'vitest';
import { MARKMIND_PPTX_FREE_FONTS, pptxFontFaceForText } from './pptxDesignSystem';

describe('pptxDesignSystem', () => {
  it('uses Pretendard for Korean slide text', () => {
    expect(pptxFontFaceForText('문제는 관심 부족이 아니다', 'Theme Font', 'heading')).toBe(
      MARKMIND_PPTX_FREE_FONTS.korean,
    );
  });

  it('uses Noto Sans JP for Japanese slide text', () => {
    expect(pptxFontFaceForText('資料の目的', 'Theme Font')).toBe(MARKMIND_PPTX_FREE_FONTS.japanese);
  });

  it('uses Noto Sans SC/TC for Chinese slide text', () => {
    expect(pptxFontFaceForText('市场机会', 'Theme Font')).toBe(
      MARKMIND_PPTX_FREE_FONTS.chineseSimplified,
    );
    expect(pptxFontFaceForText('臺灣市場機會', 'Theme Font')).toBe(
      MARKMIND_PPTX_FREE_FONTS.chineseTraditional,
    );
  });

  it('keeps the theme font for Latin text and Noto Sans Mono for code', () => {
    expect(pptxFontFaceForText('Market opportunity', 'Noto Sans Display', 'heading')).toBe(
      'Noto Sans Display',
    );
    expect(pptxFontFaceForText('const x = 1', 'Theme Mono', 'mono')).toBe(
      MARKMIND_PPTX_FREE_FONTS.mono,
    );
  });
});
