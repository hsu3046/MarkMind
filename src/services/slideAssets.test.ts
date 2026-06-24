import { describe, expect, it, vi } from 'vitest';
import type { Slide } from '../lib/markdownToSlides';
import { DEFAULT_SLIDE_THEME } from '../lib/slideTheme';
import {
  buildGeneratedSlideImagePrompt,
  canResolveStockSearch,
  resolveSlideAssets,
  routeSlideImageIntent,
  scoreSlideImageCandidate,
  type SlideImageIntent,
} from './slideAssets';

const { generateImageMock } = vi.hoisted(() => ({
  generateImageMock: vi.fn(async () => ['data:image/png;base64,AAAA']),
}));

vi.mock('./imageGen', async () => {
  const actual = await vi.importActual<typeof import('./imageGen')>('./imageGen');
  return {
    ...actual,
    generateImage: generateImageMock,
  };
});

describe('slideAssets', () => {
  it('중요도와 밀도를 합쳐 이미지 후보 점수를 계산', () => {
    const importantSparse: Slide = {
      title: '핵심 전략 결론',
      layout: 'stat',
      importance: 90,
      body: [{ kind: 'text', spans: [{ text: '가장 중요한 의사결정 포인트' }] }],
      stat: { value: '3x', label: '효율 개선' },
    };
    const denseAppendix: Slide = {
      title: '부록 상세 로그',
      layout: 'content',
      importance: 25,
      body: Array.from({ length: 10 }, (_, i) => ({
        kind: 'bullet' as const,
        spans: [{ text: `상세 항목 ${i + 1} `.repeat(18) }],
        indent: 0,
      })),
    };

    const high = scoreSlideImageCandidate(importantSparse, 0, 2, 'needed');
    const low = scoreSlideImageCandidate(denseAppendix, 1, 2, 'needed');

    expect(high.importance).toBeGreaterThanOrEqual(90);
    expect(high.score).toBeGreaterThan(low.score);
    expect(low.score).toBeLessThan(65);
  });

  it('생성 이미지는 검색어가 아니라 슬라이드 문맥 기반 프롬프트를 사용', () => {
    const intent: SlideImageIntent = {
      slideIndex: 2,
      slideId: 'S3',
      title: '문제는 관심 부족이 아니라 조건 부족입니다',
      role: 'support',
      query: 'team collaboration',
      prompt: 'abstract workplace conditions enabling better AI adoption',
      aspect: '4:3',
      sourcePreference: 'generated',
      licenseStrictness: 'presentation',
      importance: 84,
      imageScore: 78,
      textSummary: '안전하게 질문할 공간과 다시 시도할 계기가 부족하다.',
    };

    const prompt = buildGeneratedSlideImagePrompt(intent, DEFAULT_SLIDE_THEME);

    expect(prompt).toContain('Slide title');
    expect(prompt).toContain('Creative brief');
    expect(prompt).toContain('negative space');
    expect(prompt).toContain('Do not include readable text');
    expect(prompt).toContain(DEFAULT_SLIDE_THEME.name);
  });

  it('Stock만 모드는 generated 선호 intent도 검색으로 라우팅', () => {
    const intent: SlideImageIntent = {
      slideIndex: 1,
      slideId: 'S2',
      title: 'AI adoption conditions',
      role: 'support',
      query: 'workplace collaboration training',
      prompt: 'abstract workplace conditions',
      aspect: '16:9',
      sourcePreference: 'generated',
      licenseStrictness: 'presentation',
      importance: 72,
      imageScore: 69,
    };

    expect(routeSlideImageIntent(intent, 'stockOnly')).toBe('stock');
    expect(canResolveStockSearch(intent)).toBe(true);
    expect(routeSlideImageIntent({ ...intent, sourcePreference: 'none' }, 'stockOnly')).toBeNull();
    expect(canResolveStockSearch({ ...intent, sourcePreference: 'none' })).toBe(false);
  });

  it('생성만 모드는 stock 선호 일반 intent도 생성으로 라우팅', () => {
    const intent: SlideImageIntent = {
      slideIndex: 1,
      slideId: 'S2',
      title: 'AI adoption conditions',
      role: 'support',
      query: 'workplace collaboration training',
      aspect: '16:9',
      sourcePreference: 'stock',
      licenseStrictness: 'presentation',
      importance: 72,
      imageScore: 69,
    };

    expect(routeSlideImageIntent(intent, 'generatedOnly')).toBe('generated');
    expect(routeSlideImageIntent({ ...intent, role: 'logo' }, 'generatedOnly')).toBeNull();
    expect(routeSlideImageIntent({ ...intent, sourcePreference: 'logo' }, 'generatedOnly')).toBeNull();
    expect(routeSlideImageIntent({ ...intent, sourcePreference: 'none' }, 'generatedOnly')).toBeNull();
  });

  it('stock fallback이 생성 이미지 cap을 초과하지 않는다', async () => {
    generateImageMock.mockClear();
    const generatedSlides: Slide[] = Array.from({ length: 3 }, (_, index) => ({
      title: `생성 후보 ${index + 1}`,
      layout: 'content',
      sourceIds: [`generated-${index + 1}`],
      body: [{ kind: 'text', spans: [{ text: '생성 이미지가 필요한 추상 개념 슬라이드' }] }],
      image: {
        prompt: `abstract generated concept ${index + 1}`,
        query: `abstract generated concept ${index + 1}`,
        sourcePreference: 'generated',
        role: 'support',
      },
    }));
    const stockSlides: Slide[] = Array.from({ length: 3 }, (_, index) => ({
      title: `Stock 후보 ${index + 1}`,
      layout: 'content',
      sourceIds: [`stock-${index + 1}`],
      body: [{ kind: 'text', spans: [{ text: 'stock 검색이 실패하면 fallback 후보가 되는 슬라이드' }] }],
      image: {
        query: `stock search ${index + 1}`,
        sourcePreference: 'stock',
        role: 'support',
      },
    }));

    const result = await resolveSlideAssets([...generatedSlides, ...stockSlides], {
      themeId: DEFAULT_SLIDE_THEME.id,
      imagePolicy: 'add image intent only when it materially improves the slide',
      imageSourceMode: 'auto choose stock photos, logos, or generated images based on slide intent',
    });

    expect(generateImageMock).toHaveBeenCalledTimes(3);
    expect(result.summary.generatedResolved).toBe(3);
    expect(result.assets.filter((asset) => asset.sourceMode === 'generated')).toHaveLength(3);
  });

  it('HTML-native 호출은 placeholder 개수에 맞춰 생성 이미지 예산을 올릴 수 있다', async () => {
    generateImageMock.mockClear();
    const slides: Slide[] = Array.from({ length: 10 }, (_, index) => ({
      title: `HTML placeholder ${index + 1}`,
      layout: 'content',
      sourceIds: [`html-placeholder-${index + 1}`],
      body: [{ kind: 'text', spans: [{ text: 'HTML-native placeholder 슬라이드' }] }],
      image: {
        prompt: `abstract generated HTML visual ${index + 1}`,
        sourcePreference: 'generated',
        role: 'support',
      },
    }));

    const result = await resolveSlideAssets(
      slides,
      {
        themeId: DEFAULT_SLIDE_THEME.id,
        imagePolicy:
          'actively add ambient, editorial, and supporting visual intent to most HTML slides, including spacious body slides, cover, section, quote, stat, conclusion, and core argument slides',
        imageSourceMode: 'generated only',
      },
      { generatedLimitOverride: slides.length },
    );

    expect(generateImageMock).toHaveBeenCalledTimes(10);
    expect(result.summary.generatedResolved).toBe(10);
    expect(result.summary.skipped).toBe(0);
  });

  it('HTML-native raw asset id aliases survive asset resolution', async () => {
    generateImageMock.mockClear();
    const slides: Slide[] = [
      {
        title: 'Opening',
        layout: 'title',
        sourceIds: ['cover-hero'],
        body: [{ kind: 'text', spans: [{ text: 'opening context' }] }],
        image: {
          prompt: 'cover image',
          rawAssetId: 'cover hero',
          sourcePreference: 'generated',
          role: 'cover',
        },
      },
    ];

    const result = await resolveSlideAssets(slides, {
      themeId: DEFAULT_SLIDE_THEME.id,
      imagePolicy: 'add image intent only when it materially improves the slide',
      imageSourceMode: 'generated only',
    });

    expect(result.assets[0].slideId).toBe('cover-hero');
    expect(result.assets[0].rawSlideId).toBe('cover hero');
  });

  it('취소된 작업은 이미지 생성 요청을 시작하지 않는다', async () => {
    generateImageMock.mockClear();
    const slides: Slide[] = [
      {
        title: 'Cancelled visual',
        layout: 'content',
        sourceIds: ['cancelled-visual'],
        body: [{ kind: 'text', spans: [{ text: '이미지 생성을 시작하면 안 되는 슬라이드' }] }],
        image: {
          prompt: 'abstract generated concept',
          sourcePreference: 'generated',
          role: 'support',
        },
      },
    ];

    await expect(
      resolveSlideAssets(
        slides,
        {
          themeId: DEFAULT_SLIDE_THEME.id,
          imagePolicy: 'add image intent only when it materially improves the slide',
          imageSourceMode: 'generated only',
        },
        { isCancelled: () => true },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(generateImageMock).not.toHaveBeenCalled();
  });

  it('이미지 생성 큐 사이에서 취소되면 다음 생성 요청을 시작하지 않는다', async () => {
    let cancelled = false;
    generateImageMock.mockClear();
    generateImageMock.mockImplementationOnce(async () => {
      cancelled = true;
      return ['data:image/png;base64,BBBB'];
    });
    const slides: Slide[] = Array.from({ length: 3 }, (_, index) => ({
      title: `Generated visual ${index + 1}`,
      layout: 'content',
      sourceIds: [`generated-visual-${index + 1}`],
      body: [{ kind: 'text', spans: [{ text: '생성 이미지 후보 슬라이드' }] }],
      image: {
        prompt: `abstract generated concept ${index + 1}`,
        sourcePreference: 'generated',
        role: 'support',
      },
    }));

    await expect(
      resolveSlideAssets(
        slides,
        {
          themeId: DEFAULT_SLIDE_THEME.id,
          imagePolicy: 'add image intent only when it materially improves the slide',
          imageSourceMode: 'generated only',
        },
        { isCancelled: () => cancelled },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(generateImageMock).toHaveBeenCalledTimes(1);
  });
});
