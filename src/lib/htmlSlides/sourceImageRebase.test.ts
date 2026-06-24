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
      sourceMarkdown: [
        '# Source',
        '![](./img/chart.png)',
        '![](photos/team.jpg)',
        '![](/Users/me/logo.svg)',
      ].join('\n'),
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
      sourceMarkdown: '![](img/chart.png)',
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

  it('prefers existing decoded paths for percent-encoded local image refs', async () => {
    const { deps, copied } = fakeDeps([
      '/docs/project/img/my chart.png',
      '/docs/project/img/한글.png',
    ]);
    const html = '<img src="img/my%20chart.png"><img src="img/%ED%95%9C%EA%B8%80.png">';

    const result = await rebaseHtmlSourceImageReferences(html, {
      sourceDocPath: '/docs/project/source.md',
      sourceMarkdown: [
        '# Source',
        '![chart](img/my%20chart.png)',
        '![ko](img/%ED%95%9C%EA%B8%80.png)',
      ].join('\n'),
      htmlPath: '/exports/deck.html',
      deps,
    });

    expect(copied).toEqual([
      { src: '/docs/project/img/my chart.png', dest: '/exports/deck.assets/source/my chart.png' },
      { src: '/docs/project/img/한글.png', dest: '/exports/deck.assets/source/한글.png' },
    ]);
    expect(result.copied).toBe(2);
    expect(result.rewritten).toBe(2);
    expect(result.html).toBe('<img src="deck.assets/source/my chart.png"><img src="deck.assets/source/한글.png">');
  });

  it('rebases CSS urls only inside style tags and style attributes', async () => {
    const { deps, copied } = fakeDeps([
      '/docs/project/img/bg.png',
      '/docs/project/img/inline.png',
    ]);
    const html = [
      '<html><head><style>.hero{background:url("img/bg.png")}</style></head>',
      '<body>',
      '<section style="background-image:url(\'img/inline.png\')"></section>',
      '<pre><code>.sample{background:url("img/bg.png")}</code></pre>',
      '<script type="application/json">{"example":"url(img/bg.png)"}</script>',
      '<p>Use url(img/bg.png) in CSS.</p>',
      '</body></html>',
    ].join('');

    const result = await rebaseHtmlSourceImageReferences(html, {
      sourceDocPath: '/docs/project/source.md',
      sourceMarkdown: ['![](img/bg.png)', '![](img/inline.png)'].join('\n'),
      htmlPath: '/exports/deck.html',
      deps,
    });

    expect(copied).toEqual([
      { src: '/docs/project/img/bg.png', dest: '/exports/deck.assets/source/bg.png' },
      { src: '/docs/project/img/inline.png', dest: '/exports/deck.assets/source/inline.png' },
    ]);
    expect(result.copied).toBe(2);
    expect(result.rewritten).toBe(2);
    expect(result.html).toContain('<style>.hero{background:url("deck.assets/source/bg.png")}</style>');
    expect(result.html).toContain('style="background-image:url(&quot;deck.assets/source/inline.png&quot;)"');
    expect(result.html).toContain('<pre><code>.sample{background:url("img/bg.png")}</code></pre>');
    expect(result.html).toContain('<script type="application/json">{"example":"url(img/bg.png)"}</script>');
    expect(result.html).toContain('<p>Use url(img/bg.png) in CSS.</p>');
  });

  it('does not copy CSS url examples outside style contexts', async () => {
    const { deps, copied } = fakeDeps(['/docs/project/img/bg.png']);
    const html = '<pre><code>.sample{background:url("img/bg.png")}</code></pre>';

    const result = await rebaseHtmlSourceImageReferences(html, {
      sourceDocPath: '/docs/project/source.md',
      sourceMarkdown: '![](img/bg.png)',
      htmlPath: '/exports/deck.html',
      deps,
    });

    expect(copied).toEqual([]);
    expect(result).toEqual({ html, copied: 0, rewritten: 0 });
  });

  it('leaves unresolved relative refs unchanged when the source document path is unavailable', async () => {
    const { deps, copied } = fakeDeps(['/docs/img/chart.png']);
    const html = '<img src="img/chart.png">';

    const result = await rebaseHtmlSourceImageReferences(html, {
      sourceDocPath: null,
      sourceMarkdown: '![](img/chart.png)',
      htmlPath: '/exports/deck.html',
      deps,
    });

    expect(copied).toEqual([]);
    expect(result).toEqual({ html, copied: 0, rewritten: 0 });
  });

  it('does not copy local files that were not referenced by the source markdown', async () => {
    const { deps, copied } = fakeDeps([
      '/docs/project/img/known.png',
      '/docs/project/img/injected.png',
      '/etc/passwd',
      '/Users/me/secret.png',
    ]);
    const html = [
      '<img src="img/known.png">',
      '<img src="img/injected.png">',
      '<img src="/etc/passwd">',
      '<section style="background:url(/Users/me/secret.png)"></section>',
    ].join('');

    const result = await rebaseHtmlSourceImageReferences(html, {
      sourceDocPath: '/docs/project/source.md',
      sourceMarkdown: [
        '# Source',
        '![](img/known.png)',
        '```',
        '![](img/injected.png)',
        '```',
      ].join('\n'),
      htmlPath: '/exports/deck.html',
      deps,
    });

    expect(copied).toEqual([
      { src: '/docs/project/img/known.png', dest: '/exports/deck.assets/source/known.png' },
    ]);
    expect(result.copied).toBe(1);
    expect(result.rewritten).toBe(1);
    expect(result.html).toContain('<img src="deck.assets/source/known.png">');
    expect(result.html).toContain('<img src="img/injected.png">');
    expect(result.html).toContain('<img src="/etc/passwd">');
    expect(result.html).toContain('background:url(/Users/me/secret.png)');
  });
});
