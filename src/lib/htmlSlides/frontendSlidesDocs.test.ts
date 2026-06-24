import { describe, expect, it } from 'vitest';
import {
  buildFrontendSlidesDesignRules,
  getFrontendSlidesTemplateDocs,
  getHtmlSlideRuntimeFilesForHtml,
} from './frontendSlidesDocs';
import { getHtmlSlideTheme } from '../htmlSlideTheme';

describe('frontendSlidesDocs', () => {
  it('loads the selected beautiful-html-templates docs', async () => {
    const docs = await getFrontendSlidesTemplateDocs('neo-grid-bold');

    expect(docs.id).toBe('neo-grid-bold');
    expect(docs.previewPath).toContain('neo-grid-bold/preview.md');
    expect(docs.designPath).toContain('neo-grid-bold/design.md');
    expect(docs.designMd).toContain('Neo-Grid Bold');
    expect(docs.beautifulDesignMd).toContain('Neo-Grid Bold');
    expect(docs.templateJson).toContain('"slug": "neo-grid-bold"');
    expect(docs.templateHtml).toContain('<deck-stage');
    expect(docs.designMd.length).toBeGreaterThan(10_000);
  });

  it('falls back to Blue Professional for unknown theme ids', async () => {
    const docs = await getFrontendSlidesTemplateDocs('unknown-template');

    expect(docs.id).toBe('blue-professional');
    expect(docs.beautifulDesignMd).toContain('Blue Professional');
  });

  it('exposes GitHub screenshot previews on HTML themes', () => {
    const signal = getHtmlSlideTheme('signal');
    const softEditorial = getHtmlSlideTheme('soft-editorial');

    expect(signal.previewImageUrl).toContain('signal.png');
    expect(softEditorial.previewImageUrl).toContain('soft-editorial.png');
  });

  it('builds an HTML slide prompt from selected template docs', async () => {
    const prompt = await buildFrontendSlidesDesignRules('signal');

    expect(prompt).toContain('beautiful-html-templates AGENTS.md');
    expect(prompt).toContain('AGENTS.md');
    expect(prompt).toContain('template.json');
    expect(prompt).toContain('templates/signal/design.md');
    expect(prompt).toContain('templates/signal/template.html');
    expect(prompt).toContain('Signal');
    expect(prompt).toContain('slide--pyramid');
    expect(prompt).toContain('sizing model, viewport behavior');
    expect(prompt).toContain('deck-stage.js');
  });

  it('can build native HTML rules without the JSON-only renderer constraint', async () => {
    const prompt = await buildFrontendSlidesDesignRules('signal', 'html');

    expect(prompt).toContain('output one complete HTML document directly');
    expect(prompt).toContain('<!DOCTYPE html>');
    expect(prompt).toContain('Local sibling JavaScript files are allowed');
    expect(prompt).toContain('Do not output MarkMind Slide[] JSON');
    expect(prompt).toContain('partial fragment');
    expect(prompt).not.toContain('Output JSON only. Do not output raw HTML/CSS');
  });

  it('detects local template runtime files referenced by generated HTML', () => {
    const files = getHtmlSlideRuntimeFilesForHtml(
      [
        '<html><head>',
        '<script src="./deck-stage.js"></script>',
        '<script src=deck-stage.js></script>',
        '<script src="h&Tab;ttps://attacker.example/deck-stage.js"></script>',
        '</head></html>',
      ].join(''),
      'neo-grid-bold',
    );

    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('deck-stage.js');
    expect(files[0].content).toContain('customElements.define');
  });
});
