import { describe, expect, it } from 'vitest';
import {
  applyHtmlNativeAssetRecords,
  ensureHtmlNativeDocument,
  htmlNativeDeckFromLlmHtml,
  normalizeHtmlNativeAssetIntents,
  sanitizeHtmlNativeSlides,
  slidesFromHtmlNativeAssetIntents,
  unresolvedHtmlNativeAssetPlaceholders,
  validateHtmlNativeSlides,
  validateHtmlNativeSlidesForTemplate,
} from './nativeHtmlSlides';
import type { SlideAssetRecord } from '../../services/slideAssets';

const nativeHtml = `<!DOCTYPE html>
<html>
<head><style>.deck-stage{width:1920px;height:1080px}.slide{position:absolute}</style></head>
<body>
<div class="deck-stage">
  <section class="slide cover" data-layout="cover"><img src="{{markmind_asset:cover-hero}}" alt=""></section>
  <section class="slide matrix" data-layout="matrix"></section>
</div>
<script type="application/json" id="markmind-asset-intents">
[
  {
    "id": "cover-hero",
    "slideIndex": 0,
    "slideTitle": "Opening",
    "role": "cover",
    "prompt": "Editorial abstract background for an AI strategy deck",
    "aspect": "16:9",
    "sourcePreference": "generated",
    "licenseStrictness": "presentation",
    "importance": 92
  }
]
</script>
</body>
</html>`;

describe('nativeHtmlSlides', () => {
  it('extracts and normalizes asset intents from native HTML', () => {
    const deck = htmlNativeDeckFromLlmHtml(nativeHtml);
    const intents = normalizeHtmlNativeAssetIntents(deck?.assetIntents ?? []);

    expect(deck?.html).toContain('deck-stage');
    expect(intents).toHaveLength(1);
    expect(intents[0].slideId).toBe('cover-hero');
    expect(intents[0].sourcePreference).toBe('generated');
    expect(intents[0].importance).toBe(92);
  });

  it('converts native asset intents to temporary slides for the existing resolver', () => {
    const deck = htmlNativeDeckFromLlmHtml(nativeHtml);
    const intents = normalizeHtmlNativeAssetIntents(deck?.assetIntents ?? []);
    const slides = slidesFromHtmlNativeAssetIntents(intents);

    expect(slides[0].layout).toBe('title');
    expect(slides[0].sourceIds).toEqual(['cover-hero']);
    expect(slides[0].image?.prompt).toContain('Editorial abstract');
  });

  it('replaces MarkMind asset placeholders from saved asset records', () => {
    const record: SlideAssetRecord = {
      slideIndex: 0,
      slideTitle: 'Opening',
      slideId: 'cover-hero',
      role: 'cover',
      sourceMode: 'generated',
      provider: 'openai',
      inserted: false,
      importance: 92,
      imageScore: 92,
      dataUrl: 'data:image/png;base64,AAAA',
    };

    const applied = applyHtmlNativeAssetRecords(nativeHtml, [record]);

    expect(applied.html).toContain('data:image/png;base64,AAAA');
    expect(applied.html).not.toContain('{{markmind_asset:cover-hero}}');
    expect(applied.insertedIds.has('cover-hero')).toBe(true);
  });

  it('replaces raw asset placeholders when normalized ids differ', () => {
    const deck = htmlNativeDeckFromLlmHtml(`<!DOCTYPE html><html><body>
      <section class="slide"><img src="{{markmind_asset:cover hero}}" alt=""></section>
      <script type="application/json" id="markmind-asset-intents">[
        {"id":"cover hero","slideIndex":0,"slideTitle":"Opening","prompt":"cover image"}
      ]</script>
    </body></html>`);
    const intents = normalizeHtmlNativeAssetIntents(deck?.assetIntents ?? []);
    const record: SlideAssetRecord = {
      slideIndex: 0,
      slideTitle: 'Opening',
      slideId: 'cover-hero',
      rawSlideId: 'cover hero',
      role: 'cover',
      sourceMode: 'generated',
      provider: 'openai',
      inserted: false,
      importance: 70,
      imageScore: 70,
      dataUrl: 'data:image/png;base64,BBBB',
    };

    const applied = applyHtmlNativeAssetRecords(deck?.html ?? '', [record]);

    expect(intents[0].slideId).toBe('cover-hero');
    expect(intents[0].rawSlideId).toBe('cover hero');
    expect(applied.html).toContain('data:image/png;base64,BBBB');
    expect(unresolvedHtmlNativeAssetPlaceholders(applied.html)).toEqual([]);
  });

  it('keeps normalized asset ids unique when raw ids collide', () => {
    const deck = htmlNativeDeckFromLlmHtml(`<!DOCTYPE html><html><body>
      <section class="slide"><img src="{{markmind_asset:cover hero}}" alt=""></section>
      <section class="slide"><img src="{{markmind_asset:cover-hero}}" alt=""></section>
      <script type="application/json" id="markmind-asset-intents">[
        {"id":"cover hero","slideIndex":0,"slideTitle":"Opening","prompt":"first image"},
        {"id":"cover-hero","slideIndex":1,"slideTitle":"Second","prompt":"second image"}
      ]</script>
    </body></html>`);
    const intents = normalizeHtmlNativeAssetIntents(deck?.assetIntents ?? []);
    const records: SlideAssetRecord[] = intents.map((intent, index) => ({
      slideIndex: intent.slideIndex,
      slideTitle: intent.title,
      slideId: intent.slideId,
      rawSlideId: intent.rawSlideId,
      role: intent.role,
      sourceMode: 'generated',
      provider: 'openai',
      inserted: false,
      importance: intent.importance,
      imageScore: intent.imageScore,
      dataUrl: `data:image/png;base64,IMAGE${index + 1}`,
    }));

    const applied = applyHtmlNativeAssetRecords(deck?.html ?? '', records);

    expect(intents.map((intent) => intent.slideId)).toEqual(['cover-hero-1', 'cover-hero-2']);
    expect(intents.map((intent) => intent.rawSlideId)).toEqual(['cover hero', 'cover-hero']);
    expect(applied.html).toContain('data:image/png;base64,IMAGE1');
    expect(applied.html).toContain('data:image/png;base64,IMAGE2');
    expect(applied.insertedIds.has('cover-hero-1')).toBe(true);
    expect(applied.insertedIds.has('cover-hero-2')).toBe(true);
    expect(unresolvedHtmlNativeAssetPlaceholders(applied.html)).toEqual([]);
  });

  it('does not use duplicate raw asset ids as replacement aliases', () => {
    const deck = htmlNativeDeckFromLlmHtml(`<!DOCTYPE html><html><body>
      <section class="slide"><img src="{{markmind_asset:photo}}" alt=""></section>
      <section class="slide"><img src="{{markmind_asset:photo}}" alt=""></section>
      <script type="application/json" id="markmind-asset-intents">[
        {"id":"photo","slideIndex":0,"slideTitle":"First","prompt":"first image"},
        {"id":"photo","slideIndex":1,"slideTitle":"Second","prompt":"second image"}
      ]</script>
    </body></html>`);
    const intents = normalizeHtmlNativeAssetIntents(deck?.assetIntents ?? []);
    const records: SlideAssetRecord[] = intents.map((intent, index) => ({
      slideIndex: intent.slideIndex,
      slideTitle: intent.title,
      slideId: intent.slideId,
      rawSlideId: intent.rawSlideId,
      role: intent.role,
      sourceMode: 'generated',
      provider: 'openai',
      inserted: false,
      importance: intent.importance,
      imageScore: intent.imageScore,
      dataUrl: `data:image/png;base64,DUP${index + 1}`,
    }));

    const applied = applyHtmlNativeAssetRecords(deck?.html ?? '', records);

    expect(intents.map((intent) => intent.slideId)).toEqual(['photo-1', 'photo-2']);
    expect(intents.map((intent) => intent.rawSlideId)).toEqual([undefined, undefined]);
    expect(applied.html).not.toContain('data:image/png;base64,DUP1');
    expect(applied.html).not.toContain('data:image/png;base64,DUP2');
    expect(unresolvedHtmlNativeAssetPlaceholders(applied.html)).toEqual(['photo']);
  });

  it('does not partially replace markmind asset URL ids with shared prefixes', () => {
    const html = '<img src="markmind-asset://hero-wide"><img src="markmind-asset://hero">';
    const records: SlideAssetRecord[] = [
      {
        slideIndex: 0,
        slideTitle: 'Hero',
        slideId: 'hero',
        role: 'support',
        sourceMode: 'generated',
        provider: 'openai',
        inserted: false,
        importance: 70,
        imageScore: 70,
        dataUrl: 'data:image/png;base64,HERO',
      },
      {
        slideIndex: 0,
        slideTitle: 'Wide',
        slideId: 'hero-wide',
        role: 'support',
        sourceMode: 'generated',
        provider: 'openai',
        inserted: false,
        importance: 70,
        imageScore: 70,
        dataUrl: 'data:image/png;base64,WIDE',
      },
    ];

    const applied = applyHtmlNativeAssetRecords(html, records);

    expect(applied.html).toBe('<img src="data:image/png;base64,WIDE"><img src="data:image/png;base64,HERO">');
    expect(applied.html).not.toContain('data:image/png;base64,HERO-wide');
    expect(applied.insertedIds.has('hero')).toBe(true);
    expect(applied.insertedIds.has('hero-wide')).toBe(true);
  });

  it('reports unresolved MarkMind asset placeholders after asset application', () => {
    const applied = applyHtmlNativeAssetRecords(nativeHtml, []);

    expect(unresolvedHtmlNativeAssetPlaceholders(applied.html)).toEqual(['cover-hero']);
    expect(validateHtmlNativeSlides(applied.html).warnings.join('\n')).toContain('이미지 placeholder');
  });

  it('reports malformed unresolved MarkMind asset placeholders', () => {
    const html = '<section class="slide"><img src="{{markmind_asset:cover hero}}"><img src="markmind-asset://wide-hero"></section>';

    expect(unresolvedHtmlNativeAssetPlaceholders(html)).toEqual(['cover hero', 'wide-hero']);
  });

  it('sanitizes dangerous tags while preserving supported local runtime scripts', () => {
    const dirty = [
      nativeHtml,
      '<script src="./deck-stage.js"></script>',
      '<script src="https://example.com/x.js"></script>',
      '<script src="h&Tab;ttps://attacker.example/deck-stage.js"></script>',
      '<iframe src="https://example.com"></iframe>',
      '<a onclick="x()" href="javascript:alert(1)">x</a>',
      '<img onerror=alert(1) src=javascript:alert(2)>',
      '<a href="jav&#x61;script:alert(3)">encoded</a>',
      '<button formaction="java&Tab;script&colon;alert(4)">encoded</button>',
    ].join('');
    const clean = ensureHtmlNativeDocument(sanitizeHtmlNativeSlides(dirty));
    const report = validateHtmlNativeSlides(clean);

    expect(clean).toContain('src="./deck-stage.js"');
    expect(clean).not.toContain('https://example.com/x.js');
    expect(clean).not.toContain('attacker.example');
    expect(clean).not.toContain('<iframe');
    expect(clean).not.toContain('onclick=');
    expect(clean).not.toContain('onerror=');
    expect(clean).not.toContain('javascript:');
    expect(clean).not.toContain('jav&#x61;script');
    expect(clean).not.toContain('java&Tab;script');
    expect(clean).toContain('href="#"');
    expect(clean).toContain('formaction="#"');
    expect(report.errors).toEqual([]);
    expect(report.slideCount).toBe(2);
  });

  it('rewrites trusted template navigation handlers without allowing arbitrary inline events', () => {
    const dirty = `<!DOCTYPE html><html><body>
      <section class="slide active" data-layout="cover"></section>
      <button class="nav-btn" onclick="changeSlide(-1)">Prev</button>
      <button class="nav-btn" onclick="changeSlide(1)">Next</button>
      <a class="nav-btn" onclick="prevSlide()">Previous link</a>
      <button class="nav-btn" onclick="nextSlide()">Next button</button>
      <button class="bad" onclick="alert(1)">Bad</button>
      <script>
        function changeSlide(dir) {}
        function prevSlide() {}
        function nextSlide() {}
      </script>
    </body></html>`;

    const clean = ensureHtmlNativeDocument(sanitizeHtmlNativeSlides(dirty));
    const report = validateHtmlNativeSlides(clean);

    expect(clean.match(/<(?:button|a)\b[^>]*data-markmind-nav="prev"/g)).toHaveLength(2);
    expect(clean.match(/<(?:button|a)\b[^>]*data-markmind-nav="next"/g)).toHaveLength(2);
    expect(clean).toContain('markmind-template-nav-bindings');
    expect(clean).not.toContain('onclick=');
    expect(clean).not.toContain('alert(1)');
    expect(report.errors).toEqual([]);
  });

  it('rejects unsanitized inline event handlers and javascript URLs', () => {
    const report = validateHtmlNativeSlides(
      '<!DOCTYPE html><html><body><section class="slide"><img src=x onerror="alert(1)"><a href=javascript:alert(1)>x</a></section></body></html>',
    );

    expect(report.errors.join('\n')).toContain('inline on* 이벤트 핸들러');
    expect(report.errors.join('\n')).toContain('javascript: URL');
  });

  it('rejects entity-encoded dangerous URL schemes before browser decoding', () => {
    const html = [
      '<!DOCTYPE html><html><head>',
      '<script src="jav&#x61;script:alert(3)"></script>',
      '</head><body><section class="slide">',
      '<a href="jav&#97;script:alert(1)">x</a>',
      '<button formaction="java&Tab;script&colon;alert(2)">go</button>',
      '</section></body></html>',
    ].join('');

    const report = validateHtmlNativeSlides(html);

    expect(report.errors.join('\n')).toContain('지원하지 않는 script src');
    expect(report.errors.join('\n')).toContain('javascript: URL');
  });

  it('rejects deck-stage fragments from LLM output before accepting them as complete documents', () => {
    const fragment = `<main class="deck-stage">
      <section class="slide s-cover" data-layout="cover"><h1>Opening</h1></section>
      <section class="slide s-chart" data-layout="chart"><h2>Evidence</h2></section>
    </main>`;
    const deck = htmlNativeDeckFromLlmHtml(fragment);
    const wrapped = ensureHtmlNativeDocument(fragment, 'Fragment Deck');
    const report = validateHtmlNativeSlidesForTemplate(wrapped, 'neo-grid-bold');

    expect(deck).toBeNull();
    expect(wrapped).toContain('<html lang="ko">');
    expect(report.errors).toEqual([]);
    expect(report.slideCount).toBe(2);
  });

  it('rejects truncated native HTML before accepting partial streamed output', () => {
    const report = validateHtmlNativeSlides('<html><head><style>.deck-stage{width:1920px;height:1080px}</style></head><body><div class="deck-stage"><section class="slide" data-layout="cover">');

    expect(report.errors.join('\n')).toContain('HTML 문서가 끝까지 닫히지 않았습니다');
    expect(report.errors.join('\n')).toContain('일부 slide section이 닫히지 않았습니다');
  });

  it('keeps design-style warnings non-fatal', () => {
    const generic = `<!DOCTYPE html><html><head><style>.deck-stage{width:1920px;height:1080px}</style></head><body><main class="deck-stage">
      <section class="slide generic" data-layout="a"></section>
      <section class="slide generic" data-layout="b"></section>
      <section class="slide generic" data-layout="c"></section>
      <section class="slide generic" data-layout="d"></section>
      <section class="slide generic" data-layout="e"></section>
    </main></body></html>`;
    const report = validateHtmlNativeSlidesForTemplate(generic, 'neo-grid-bold');

    expect(report.templateClassHits).toBe(0);
    expect(report.errors).toEqual([]);
  });

  it('allows local deck-stage runtime but rejects remote or unknown scripts', () => {
    const localRuntime = validateHtmlNativeSlides(
      '<!DOCTYPE html><html><head><script src=deck-stage.js></script></head><body><section class="slide"></section></body></html>',
    );
    const templateChartRuntime = validateHtmlNativeSlides(
      '<!DOCTYPE html><html><head><script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script></head><body><section class="slide"></section></body></html>',
    );
    const unknownRuntime = validateHtmlNativeSlides(
      '<!DOCTYPE html><html><head><script src="custom.js"></script></head><body><section class="slide"></section></body></html>',
    );
    const remoteRuntime = validateHtmlNativeSlides(
      '<!DOCTYPE html><html><head><script src="https://example.com/deck-stage.js"></script></head><body><section class="slide"></section></body></html>',
    );
    const encodedRemoteRuntime = validateHtmlNativeSlides(
      '<!DOCTYPE html><html><head><script src="h&Tab;ttps://example.com/deck-stage.js"></script></head><body><section class="slide"></section></body></html>',
    );

    expect(localRuntime.errors).toEqual([]);
    expect(templateChartRuntime.errors).toEqual([]);
    expect(unknownRuntime.errors.join('\n')).toContain('지원하지 않는 script src');
    expect(remoteRuntime.errors.join('\n')).toContain('지원하지 않는 script src');
    expect(encodedRemoteRuntime.errors.join('\n')).toContain('지원하지 않는 script src');
  });
});
