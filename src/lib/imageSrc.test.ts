import { describe, it, expect } from 'vitest';
import { resolveImageSrc, resolveRelativePath, type ResolveDeps } from './imageSrc';

// Tauri 환경을 가정한 deps — convertFileSrc 는 식별 가능한 prefix 로 모킹
const tauriDeps: ResolveDeps = {
    isTauri: () => true,
    convertFileSrc: (p) => `asset://localhost/${p}`,
};
const webDeps: ResolveDeps = {
    isTauri: () => false,
    convertFileSrc: (p) => `asset://localhost/${p}`,
};

describe('resolveRelativePath (순수 경로 정규화)', () => {
    it('./ 결합', () => {
        expect(resolveRelativePath('./a.png', '/d')).toBe('/d/a.png');
    });
    it('../ 상위 이동', () => {
        expect(resolveRelativePath('../a/b.png', '/d/e')).toBe('/d/a/b.png');
    });
    it('중간 ../ 정규화', () => {
        expect(resolveRelativePath('a/../b.png', '/d')).toBe('/d/b.png');
    });
    it('prefix 없는 상대경로', () => {
        expect(resolveRelativePath('img.png', '/d/docs')).toBe('/d/docs/img.png');
    });
    it('연속 슬래시/끝 슬래시', () => {
        expect(resolveRelativePath('./x.png', '/d/')).toBe('/d/x.png');
    });
    it('루트 초과 ../ 안전 처리', () => {
        expect(resolveRelativePath('../../../x.png', '/d')).toBe('/x.png');
    });
    it('다중 ../', () => {
        expect(resolveRelativePath('../../assets/a.png', '/d/e/f')).toBe('/d/assets/a.png');
    });
});

describe('resolveImageSrc (URL 통과 / 변환)', () => {
    it.each([
        'https://x.com/a.png',
        'http://x.com/a.png',
        'data:image/png;base64,AAAA',
        'blob:abc',
        'asset://localhost/x.png',
        'http://asset.localhost/x.png',
        '#section',
        'mailto:a@b.c',
    ])('통과: %s', (src) => {
        expect(resolveImageSrc(src, '/d', tauriDeps)).toBe(src);
    });

    it('비-Tauri면 상대경로도 원본 그대로', () => {
        expect(resolveImageSrc('./a.png', '/d', webDeps)).toBe('./a.png');
    });

    it('절대경로 → convertFileSrc', () => {
        expect(resolveImageSrc('/Users/x/img.png', '/d', tauriDeps)).toBe(
            'asset://localhost//Users/x/img.png',
        );
    });

    it('상대경로 + docDir → 결합 후 변환', () => {
        expect(resolveImageSrc('./img.png', '/Users/x/docs', tauriDeps)).toBe(
            'asset://localhost//Users/x/docs/img.png',
        );
    });

    it('../ 상대경로 + docDir', () => {
        expect(resolveImageSrc('../assets/a.png', '/Users/x/docs', tauriDeps)).toBe(
            'asset://localhost//Users/x/assets/a.png',
        );
    });

    it('상대경로 + docDir null → 원본(해석 불가)', () => {
        expect(resolveImageSrc('./a.png', null, tauriDeps)).toBe('./a.png');
    });

    it('빈 문자열 → 그대로', () => {
        expect(resolveImageSrc('', '/d', tauriDeps)).toBe('');
    });

    it('이미 변환된 asset URL 재변환 방지', () => {
        const url = 'asset://localhost//Users/x/a.png';
        expect(resolveImageSrc(url, '/d', tauriDeps)).toBe(url);
    });
});
