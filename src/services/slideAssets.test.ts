import { describe, expect, it } from 'vitest';
import type { Slide } from '../lib/markdownToSlides';
import { DEFAULT_SLIDE_THEME } from '../lib/slideTheme';
import {
  buildGeneratedSlideImagePrompt,
  canResolveStockSearch,
  routeSlideImageIntent,
  scoreSlideImageCandidate,
  type SlideImageIntent,
} from './slideAssets';

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
});
