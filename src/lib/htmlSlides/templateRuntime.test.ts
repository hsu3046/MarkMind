import { describe, expect, it } from 'vitest';
import { validateHtmlNativeSlidesForTemplate } from './nativeHtmlSlides';
import { applyFrontendTemplateRuntime, coerceTemplateSectionClasses } from './templateRuntime';

const genericHtml = `<!DOCTYPE html>
<html>
<head><style>.deck-stage{width:1920px;height:1080px}.slide{position:absolute}</style></head>
<body>
<main class="deck-stage">
  <section class="slide" data-layout="cover"><h1>Opening</h1></section>
  <section class="slide"><h2>Evidence</h2><p>Body</p></section>
  <section class="slide"><h2>Compare</h2><p>Body</p></section>
  <section class="slide"><h2>Close</h2><p>Body</p></section>
</main>
</body>
</html>`;

describe('templateRuntime', () => {
  it('coerces generic sections into selected template section classes', () => {
    const html = coerceTemplateSectionClasses(genericHtml, 'signal');
    const report = validateHtmlNativeSlidesForTemplate(html, 'signal');

    expect(html).toContain('slide--cover');
    expect(html).toContain('slide--chapter');
    expect(html).toContain('slide--end');
    expect(report.templateClassHits).toBeGreaterThanOrEqual(3);
  });

  it('injects Neo runtime CSS and wraps Neo slide bodies in frames', () => {
    const html = applyFrontendTemplateRuntime(genericHtml, 'neo-grid-bold');
    const report = validateHtmlNativeSlidesForTemplate(html, 'neo-grid-bold');

    expect(html).toContain('id="markmind-template-runtime"');
    expect(html).toContain('id="markmind-template-runtime-script"');
    expect(html).toContain('s-cover');
    expect(html).toContain('<div class="frame">');
    expect(report.templateClassHits).toBeGreaterThanOrEqual(3);
  });

  it('wraps Neo frames even when template class appears before slide class', () => {
    const html = applyFrontendTemplateRuntime(
      '<main class="deck-stage"><section class="s-cover"><h1>Opening</h1></section></main>',
      'neo-grid-bold',
    );

    expect(html).toContain('<section class="s-cover slide"');
    expect(html).toContain('<div class="frame"><h1>Opening</h1></div>');
  });

  it('does not count runtime CSS class definitions as template usage without section classes', () => {
    const html = `<!DOCTYPE html><html><head><style>.deck-stage{width:1920px;height:1080px}.s-cover{color:red}</style></head><body><main class="deck-stage"><section class="slide"></section></main></body></html>`;
    const report = validateHtmlNativeSlidesForTemplate(html, 'neo-grid-bold');

    expect(report.templateClassHits).toBe(0);
  });
});
