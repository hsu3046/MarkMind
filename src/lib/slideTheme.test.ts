import { describe, expect, it } from 'vitest';
import { applySlideDesignOptions, DEFAULT_SLIDE_THEME } from './slideTheme';

describe('slideTheme', () => {
  it('uses the selected installed font family for PPTX heading and body text', () => {
    const theme = applySlideDesignOptions(DEFAULT_SLIDE_THEME, {
      themeId: DEFAULT_SLIDE_THEME.id,
      fontFamily: 'Avenir Next',
    });

    expect(theme.fonts.heading).toBe('Avenir Next');
    expect(theme.fonts.body).toBe('Avenir Next');
    expect(theme.fonts.useLanguageFallback).toBe(false);
  });
});
