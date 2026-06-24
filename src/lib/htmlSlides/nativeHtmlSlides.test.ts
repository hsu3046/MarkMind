import { describe, expect, it } from 'vitest';
import {
  applyHtmlNativeAssetRecords,
  ensureHtmlNativeDocument,
  htmlNativeDeckFromLlmHtml,
  normalizeHtmlNativeAssetIntents,
  sanitizeHtmlNativeSlides,
  slidesFromHtmlNativeAssetIntents,
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

  it('sanitizes dangerous tags while preserving supported local runtime scripts', () => {
    const dirty = `${nativeHtml}<script src="./deck-stage.js"></script><script src="https://example.com/x.js"></script><iframe src="https://example.com"></iframe><a onclick="x()" href="javascript:alert(1)">x</a>`;
    const clean = ensureHtmlNativeDocument(sanitizeHtmlNativeSlides(dirty));
    const report = validateHtmlNativeSlides(clean);

    expect(clean).toContain('src="./deck-stage.js"');
    expect(clean).not.toContain('https://example.com/x.js');
    expect(clean).not.toContain('<iframe');
    expect(clean).not.toContain('onclick=');
    expect(report.errors).toEqual([]);
    expect(report.slideCount).toBe(2);
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

    expect(localRuntime.errors).toEqual([]);
    expect(templateChartRuntime.errors).toEqual([]);
    expect(unknownRuntime.errors.join('\n')).toContain('지원하지 않는 script src');
    expect(remoteRuntime.errors.join('\n')).toContain('지원하지 않는 script src');
  });
});
