import { describe, expect, it } from 'vitest';
import { buildFrontendSlidesDesignRules, getFrontendSlidesTemplateDocs } from './frontendSlidesDocs';

describe('frontendSlidesDocs', () => {
  it('loads the selected frontend-slides template docs', () => {
    const docs = getFrontendSlidesTemplateDocs('neo-grid-bold');

    expect(docs.id).toBe('neo-grid-bold');
    expect(docs.previewPath).toContain('neo-grid-bold/preview.md');
    expect(docs.designPath).toContain('neo-grid-bold/design.md');
    expect(docs.designMd).toContain('Neo-Grid Bold');
    expect(docs.designMd.length).toBeGreaterThan(10_000);
  });

  it('falls back to Blue Professional for unknown theme ids', () => {
    const docs = getFrontendSlidesTemplateDocs('unknown-template');

    expect(docs.id).toBe('blue-professional');
    expect(docs.designMd).toContain('Blue Professional');
  });

  it('builds an HTML slide prompt from common docs and the selected design.md', () => {
    const prompt = buildFrontendSlidesDesignRules('signal');

    expect(prompt).toContain('fixed-stage');
    expect(prompt).toContain('html-template.md');
    expect(prompt).toContain('viewport-base.css');
    expect(prompt).toContain('animation-patterns.md');
    expect(prompt).toContain('templates/signal/design.md');
    expect(prompt).toContain('Signal');
    expect(prompt).toContain('beautiful-html-template-profile');
    expect(prompt).toContain('slide--pyramid');
  });

  it('can build native HTML rules without the JSON-only renderer constraint', () => {
    const prompt = buildFrontendSlidesDesignRules('signal', 'html');

    expect(prompt).toContain('output the final HTML/CSS/JS deck directly');
    expect(prompt).not.toContain('Output JSON only. Do not output raw HTML/CSS');
  });
});
