import { describe, expect, it } from 'vitest';
import { rebaseHtmlSourceImageReferences, type HtmlSourceImageRebaseDeps } from './sourceImageRebase';

function fakeDeps(initialExisting: string[]) {
  const existing = new Set(initialExisting);
  const copied: Array<{ src: string; dest: string }> = [];
  const mkdirs: string[] = [];
  const deps: HtmlSourceImageRebaseDeps = {
    mkdir: async (path) => {
      mkdirs.push(path);
    },
    copyFile: async (src, dest) => {
      copied.push({ src, dest });
      existing.add(dest);
    },
    exists: async (path) => existing.has(path),
  };
  return { deps, copied, mkdirs, existing };
}

describe('sourceImageRebase', () => {
  it('copies source-only HTML image paths next to the exported deck', async () => {
    const { deps, copied, mkdirs } = fakeDeps([
      '/docs/project/img/chart.png',
      '/docs/project/photos/team.jpg',
      '/Users/me/logo.svg',
    ]);
    const html = [
      '<html><head><style>',
      '.hero{background-image:url("photos/team.jpg")}',
      '.font{src:url("fonts/display.woff2")}',
      '</style></head><body>',
      '<img src="./img/chart.png" alt="">',
      '<img src="/Users/me/logo.svg" alt="">',
      '<img src="https://example.com/remote.png" alt="">',
      '<img src="{{markmind_asset:cover}}" alt="">',
      '</body></html>',
    ].join('');

    const result = await rebaseHtmlSourceImageReferences(html, {
      sourceDocPath: '/docs/project/source.md',
      htmlPath: '/exports/deck.html',
      deps,
    });

    expect(mkdirs).toEqual(['/exports/deck.assets/source']);
    expect(copied).toEqual([
      { src: '/docs/project/img/chart.png', dest: '/exports/deck.assets/source/chart.png' },
      { src: '/Users/me/logo.svg', dest: '/exports/deck.assets/source/logo.svg' },
      { src: '/docs/project/photos/team.jpg', dest: '/exports/deck.assets/source/team.jpg' },
    ]);
    expect(result.copied).toBe(3);
    expect(result.rewritten).toBe(3);
    expect(result.html).toContain('<img src="deck.assets/source/chart.png" alt="">');
    expect(result.html).toContain('<img src="deck.assets/source/logo.svg" alt="">');
    expect(result.html).toContain('background-image:url("deck.assets/source/team.jpg")');
    expect(result.html).toContain('src:url("fonts/display.woff2")');
    expect(result.html).toContain('https://example.com/remote.png');
    expect(result.html).toContain('{{markmind_asset:cover}}');
  });

  it('uses collision-safe names and reuses the same copied file for repeated refs', async () => {
    const { deps, copied } = fakeDeps([
      '/docs/img/chart.png',
      '/exports/deck.assets/source/chart.png',
    ]);
    const html = '<img src="img/chart.png"><img src="img/chart.png">';

    const result = await rebaseHtmlSourceImageReferences(html, {
      sourceDocPath: '/docs/source.md',
      htmlPath: '/exports/deck.html',
      deps,
    });

    expect(copied).toEqual([
      { src: '/docs/img/chart.png', dest: '/exports/deck.assets/source/chart-1.png' },
    ]);
    expect(result.copied).toBe(1);
    expect(result.rewritten).toBe(2);
    expect(result.html).toBe('<img src="deck.assets/source/chart-1.png"><img src="deck.assets/source/chart-1.png">');
  });

  it('leaves unresolved relative refs unchanged when the source document path is unavailable', async () => {
    const { deps, copied } = fakeDeps(['/docs/img/chart.png']);
    const html = '<img src="img/chart.png">';

    const result = await rebaseHtmlSourceImageReferences(html, {
      sourceDocPath: null,
      htmlPath: '/exports/deck.html',
      deps,
    });

    expect(copied).toEqual([]);
    expect(result).toEqual({ html, copied: 0, rewritten: 0 });
  });
});
