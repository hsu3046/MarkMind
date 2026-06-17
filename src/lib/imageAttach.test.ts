import { describe, it, expect, vi } from 'vitest';
import {
    sanitizeFileName,
    extFromMime,
    isLocalAbsolutePath,
    resolveCollision,
    writeTempImage,
    flushImagesOnSave,
    type TempDeps,
    type FlushDeps,
} from './imageAttach';

describe('sanitizeFileName', () => {
    it('경로 구분자 제거', () => {
        expect(sanitizeFileName('a/b\\c.png')).toBe('abc.png');
    });
    it('금지문자 제거', () => {
        expect(sanitizeFileName('na:me*?.png')).toBe('name.png');
    });
    it('빈 결과 → image 폴백', () => {
        expect(sanitizeFileName('///')).toBe('image');
    });
});

describe('extFromMime', () => {
    it.each([
        ['image/png', 'png'],
        ['image/jpeg', 'jpg'],
        ['image/webp', 'webp'],
        ['image/svg+xml', 'svg'],
        ['', 'png'],
    ])('%s → %s', (mime, ext) => {
        expect(extFromMime(mime)).toBe(ext);
    });
});

describe('isLocalAbsolutePath', () => {
    it.each([
        ['/Users/x/a.png', true],
        ['/var/folders/tmp.png', true],
        ['./assets/a.png', false],
        ['../a.png', false],
        ['https://x.com/a.png', false],
        ['data:image/png;base64,AA', false],
        ['//cdn/a.png', false],
    ])('%s → %s', (p, expected) => {
        expect(isLocalAbsolutePath(p)).toBe(expected);
    });
});

describe('resolveCollision', () => {
    it('충돌 없으면 원본', async () => {
        expect(await resolveCollision('/d/assets', 'a.png', async () => false)).toBe('a.png');
    });
    it('연쇄 충돌 → -2', async () => {
        const taken = new Set(['/d/assets/a.png', '/d/assets/a-1.png']);
        expect(await resolveCollision('/d/assets', 'a.png', async (p) => taken.has(p))).toBe('a-2.png');
    });
});

describe('writeTempImage', () => {
    it('$TEMP 경로에 쓰고 절대경로 반환', async () => {
        const written: unknown[] = [];
        const deps: TempDeps = {
            writeFile: vi.fn(async (p, d) => { written.push([p, d]); }),
            tempFilePath: async (name) => `/tmp/${name}`,
            now: () => 999,
        };
        const bytes = new Uint8Array([1, 2]);
        const path = await writeTempImage(bytes, 'png', deps);
        expect(path).toBe('/tmp/markmind-img-999.png');
        expect(written).toEqual([['/tmp/markmind-img-999.png', bytes]]);
    });
});

function makeFlushDeps(existing: Set<string> = new Set()): FlushDeps & { copied: [string, string][] } {
    const copied: [string, string][] = [];
    return {
        mkdir: vi.fn(async () => {}),
        copyFile: vi.fn(async (s: string, d: string) => { copied.push([s, d]); existing.add(d); }),
        exists: async (p: string) => existing.has(p),
        copied,
    } as never;
}

describe('flushImagesOnSave', () => {
    it('로컬 절대경로 → assets 복사 + 상대경로 치환', async () => {
        const deps = makeFlushDeps(new Set(['/tmp/photo.png']));
        const content = '# 제목\n\n![](/tmp/photo.png)\n\n본문';
        const { content: out, copied } = await flushImagesOnSave(content, '/a/b/doc.md', deps);
        expect(copied).toBe(1);
        expect(out).toBe('# 제목\n\n![](./assets/photo.png)\n\n본문');
        expect(deps.copied).toEqual([['/tmp/photo.png', '/a/b/assets/photo.png']]);
    });

    it('http/data/상대경로는 건드리지 않음', async () => {
        const deps = makeFlushDeps();
        const content = '![](https://x.com/a.png) ![](./assets/b.png) ![](data:image/png;base64,AA)';
        const { content: out, copied } = await flushImagesOnSave(content, '/a/b/doc.md', deps);
        expect(copied).toBe(0);
        expect(out).toBe(content);
    });

    it('이미 assets/ 안의 절대경로는 스킵', async () => {
        const deps = makeFlushDeps(new Set(['/a/b/assets/x.png']));
        const content = '![](/a/b/assets/x.png)';
        const { copied } = await flushImagesOnSave(content, '/a/b/doc.md', deps);
        expect(copied).toBe(0);
    });

    it('원본이 없으면 스킵(경로 유지)', async () => {
        const deps = makeFlushDeps(new Set()); // exists 항상 false
        const content = '![](/tmp/gone.png)';
        const { content: out, copied } = await flushImagesOnSave(content, '/a/b/doc.md', deps);
        expect(copied).toBe(0);
        expect(out).toBe(content);
    });

    it('코드펜스 안의 이미지 문법은 보존', async () => {
        const deps = makeFlushDeps(new Set(['/tmp/p.png']));
        const content = '```\n![](/tmp/p.png)\n```\n\n![](/tmp/p.png)';
        const { content: out, copied } = await flushImagesOnSave(content, '/a/b/doc.md', deps);
        expect(copied).toBe(1);
        // 펜스 안은 그대로, 밖은 치환
        expect(out).toBe('```\n![](/tmp/p.png)\n```\n\n![](./assets/p.png)');
    });

    it('같은 파일명 충돌 시 -1 suffix', async () => {
        const deps = makeFlushDeps(new Set(['/tmp/a.png', '/a/b/assets/a.png']));
        const content = '![](/tmp/a.png)';
        const { content: out } = await flushImagesOnSave(content, '/a/b/doc.md', deps);
        expect(out).toBe('![](./assets/a-1.png)');
    });

    it('이미지 없으면 그대로', async () => {
        const deps = makeFlushDeps();
        const { content: out, copied } = await flushImagesOnSave('# 제목만', '/a/b/doc.md', deps);
        expect(copied).toBe(0);
        expect(out).toBe('# 제목만');
    });
});
