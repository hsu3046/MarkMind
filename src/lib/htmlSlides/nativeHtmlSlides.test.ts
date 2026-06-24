import { describe, expect, it } from 'vitest';
import {
  applyHtmlNativeAssetRecords,
  ensureHtmlNativeDocument,
  htmlNativeDeckFromLlmHtml,
  normalizeHtmlNativeAssetIntents,
  sanitizeHtmlNativeSlides,
  shouldRepairHtmlNativeSlides,
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

  it('sanitizes dangerous tags and validates fixed-stage slides', () => {
    const dirty = `${nativeHtml}<script src="https://example.com/x.js"></script><iframe src="https://example.com"></iframe><a onclick="x()" href="javascript:alert(1)">x</a>`;
    const clean = ensureHtmlNativeDocument(sanitizeHtmlNativeSlides(dirty));
    const report = validateHtmlNativeSlides(clean);

    expect(clean).not.toContain('script src=');
    expect(clean).not.toContain('<iframe');
    expect(clean).not.toContain('onclick=');
    expect(report.errors).toEqual([]);
    expect(report.slideCount).toBe(2);
  });

  it('rejects truncated native HTML before accepting partial streamed output', () => {
    const report = validateHtmlNativeSlides('<html><head><style>.deck-stage{width:1920px;height:1080px}</style></head><body><div class="deck-stage"><section class="slide" data-layout="cover">');

    expect(report.errors.join('\n')).toContain('HTML 문서가 끝까지 닫히지 않았습니다');
    expect(report.errors.join('\n')).toContain('일부 slide section이 닫히지 않았습니다');
  });

  it('flags native HTML that does not trace the selected template class grammar', () => {
    const generic = `<!DOCTYPE html><html><head><style>.deck-stage{width:1920px;height:1080px}</style></head><body><main class="deck-stage">
      <section class="slide generic" data-layout="a"></section>
      <section class="slide generic" data-layout="b"></section>
      <section class="slide generic" data-layout="c"></section>
      <section class="slide generic" data-layout="d"></section>
      <section class="slide generic" data-layout="e"></section>
    </main></body></html>`;
    const report = validateHtmlNativeSlidesForTemplate(generic, 'neo-grid-bold');

    expect(report.templateClassHits).toBe(0);
    expect(shouldRepairHtmlNativeSlides(report)).toBe(true);
  });
});
