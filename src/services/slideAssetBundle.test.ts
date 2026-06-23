import { describe, expect, it } from 'vitest';
import type { SlideAssetRecord } from './slideAssets';
import { slideAssetBundleDir, slideAssetFileStem } from './slideAssetBundle';

const baseRecord: SlideAssetRecord = {
  slideIndex: 2,
  slideTitle: '문제는 관심 부족이 아니라 조건 부족입니다',
  slideId: 'S3',
  role: 'support',
  sourceMode: 'stock',
  provider: 'openverse',
  sourceUrl: 'https://pixabay.com/photos/workshop-team-123',
  inserted: true,
  importance: 84,
  imageScore: 78,
  dataUrl: 'data:image/png;base64,AA==',
};

describe('slideAssetBundle', () => {
  it('검색 이미지 파일명에 슬라이드 번호, search, 출처를 포함', () => {
    expect(slideAssetFileStem(baseRecord)).toContain('slide-03-search-pixabay-support');
  });

  it('생성 이미지 파일명에 슬라이드 번호, generated, 공급사를 포함', () => {
    expect(slideAssetFileStem({ ...baseRecord, sourceMode: 'generated', provider: 'openai' })).toContain(
      'slide-03-generated-openai-support',
    );
  });

  it('Windows PPTX 경로 옆에 asset bundle 경로를 만든다', () => {
    expect(slideAssetBundleDir('C:\\Users\\me\\Decks\\demo.pptx')).toBe(
      'C:\\Users\\me\\Decks\\demo.assets',
    );
  });

  it('POSIX PPTX 경로 옆에 asset bundle 경로를 만든다', () => {
    expect(slideAssetBundleDir('/Users/me/Decks/demo.pptx')).toBe('/Users/me/Decks/demo.assets');
  });

  it('HTML 슬라이드 경로 옆에도 같은 asset bundle 규칙을 쓴다', () => {
    expect(slideAssetBundleDir('/Users/me/Decks/demo.html')).toBe('/Users/me/Decks/demo.assets');
  });
});
