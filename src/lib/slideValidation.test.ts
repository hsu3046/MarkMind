import { describe, expect, it } from 'vitest';
import type { Slide } from './markdownToSlides';
import { normalizeSlidesForPptx, summarizeSlideIssues, validateSlideDeck } from './slideValidation';

const bullets = (count: number) =>
  Array.from({ length: count }, (_, idx) => ({
    kind: 'bullet' as const,
    indent: 0,
    spans: [{ text: `Point ${idx + 1}` }],
  }));

describe('slideValidation', () => {
  it('splits dense text slides before PPTX rendering', () => {
    const slide: Slide = {
      title: 'Dense plan',
      layout: 'content',
      body: bullets(14),
      sourceIds: ['S1'],
    };

    const normalized = normalizeSlidesForPptx([slide]);

    expect(normalized.length).toBe(2);
    expect(normalized[0].title).toBe('Dense plan');
    expect(normalized[1].title).toBe('Dense plan (2/2)');
    expect(normalized.flatMap((s) => s.body).filter((b) => b.kind === 'bullet')).toHaveLength(14);
  });

  it('keeps image intent only on the first split slide', () => {
    const slide: Slide = {
      title: 'Dense visual plan',
      layout: 'content',
      body: bullets(14),
      sourceIds: ['S1'],
      image: { query: 'team workshop', sourcePreference: 'generated', role: 'support' },
    };

    const normalized = normalizeSlidesForPptx([slide]);

    expect(normalized).toHaveLength(2);
    expect(normalized[0].image?.query).toBe('team workshop');
    expect(normalized[1].image).toBeUndefined();
  });

  it('demotes invalid stat slides to content', () => {
    const slide: Slide = {
      title: 'Metric without metric',
      layout: 'stat',
      body: bullets(2),
    };

    const normalized = normalizeSlidesForPptx([slide]);

    expect(normalized[0].layout).toBe('content');
  });

  it('reports layout and capacity issues', () => {
    const slide: Slide = {
      title: 'A very long title that is intentionally beyond the normal slide title capacity for one page',
      layout: 'content',
      body: [
        {
          kind: 'table',
          rows: [
            ['A', 'B', 'C', 'D', 'E', 'F'],
            ['1', '2', '3', '4', '5', '6'],
            ['1', '2', '3', '4', '5', '6'],
            ['1', '2', '3', '4', '5', '6'],
            ['1', '2', '3', '4', '5', '6'],
            ['1', '2', '3', '4', '5', '6'],
            ['1', '2', '3', '4', '5', '6'],
            ['1', '2', '3', '4', '5', '6'],
          ],
        },
      ],
    };

    const report = validateSlideDeck([slide]);
    const summary = summarizeSlideIssues(report);

    expect(report.warnings).toBeGreaterThanOrEqual(2);
    expect(summary).toContain('long-title');
    expect(summary).toContain('large-table');
  });
});
