import { describe, expect, it } from 'vitest';
import {
  clampMarkdownSlideDraft,
  clampSlideCountValue,
  generatedImageLimitForPolicy,
  PPTX_MAX_SLIDES,
  stockImageLimitForPolicy,
} from './slideLimits';

describe('slideLimits', () => {
  it('슬라이드 장수 힌트를 하드 리밋으로 clamp', () => {
    expect(clampSlideCountValue('10')).toBe(10);
    expect(clampSlideCountValue('about 100 slides')).toBe(PPTX_MAX_SLIDES);
    expect(clampSlideCountValue('')).toBeUndefined();
  });

  it('이미지 정책별 자산 상한을 반환', () => {
    expect(stockImageLimitForPolicy('use source images only; do not add new image intent')).toBe(0);
    expect(stockImageLimitForPolicy('add image intent only when it materially improves the slide')).toBe(6);
    expect(stockImageLimitForPolicy('actively add ambient and supporting visuals to spacious body slides')).toBe(18);
    expect(generatedImageLimitForPolicy('actively add ambient and supporting visuals to spacious body slides')).toBe(8);
  });

  it('AI가 반환한 Markdown 초안을 slide separator 기준으로 clamp', () => {
    const draft = Array.from({ length: PPTX_MAX_SLIDES + 2 }, (_, i) => `# Slide ${i + 1}`).join('\n\n---\n\n');
    const result = clampMarkdownSlideDraft(draft);
    expect(result.clamped).toBe(true);
    expect(result.originalCount).toBe(PPTX_MAX_SLIDES + 2);
    expect(result.markdown).toContain('# Slide 32');
    expect(result.markdown).not.toContain('# Slide 33');
  });
});
