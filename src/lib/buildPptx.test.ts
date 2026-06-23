import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { buildPptx } from './buildPptx';
import { parseInline, type Slide } from './markdownToSlides';

describe('buildPptx', () => {
  it('renders two-column slides without relying on static PptxGenJS ShapeType', async () => {
    const slides: Slide[] = [
      {
        title: 'Two Column',
        layout: 'two-column',
        body: [],
        columns: [
          [{ kind: 'bullet', spans: parseInline('Left point'), indent: 0 }],
          [{ kind: 'bullet', spans: parseInline('Right point'), indent: 0 }],
        ],
      },
    ];

    const pptx = await buildPptx(slides, { title: 'Shape Regression' });
    expect(pptx.byteLength).toBeGreaterThan(0);

    const zip = await JSZip.loadAsync(pptx);
    const slideXml = await zip.file('ppt/slides/slide1.xml')?.async('string');
    expect(slideXml).toContain('<a:spcAft>');
    expect(slideXml).toContain('<a:lnSpc>');
    const paragraphSpace = [...(slideXml?.matchAll(/<a:spcAft><a:spcPts val="(\d+)"/g) ?? [])].map((m) => Number(m[1]));
    expect(Math.max(...paragraphSpace)).toBeGreaterThanOrEqual(1200);
  });
});
