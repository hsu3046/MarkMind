import { describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { buildPptx } from './buildPptx';
import { parseInline, type Slide } from './markdownToSlides';

describe('buildPptx', () => {
  const tinyPng =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l0cZ1QAAAABJRU5ErkJggg==';
  const widePng =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAJCAYAAAA7KqwyAAAAFklEQVR4nGOQm/D/PyWYYdSAUQOAGADaQ4DQ/rxYmwAAAABJRU5ErkJggg==';

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

  it('renders deck-wide master chrome from SlideMasterSpec', async () => {
    const slides: Slide[] = [
      {
        title: 'Master Chrome',
        layout: 'content',
        body: [{ kind: 'bullet', spans: parseInline('Shared footer should live on the master'), indent: 0 }],
      },
    ];

    const pptx = await buildPptx(slides, {
      title: 'Master Chrome',
      masterSpec: {
        slideNumber: { enabled: true, includeOn: ['content', 'section'], position: 'bottom-center' },
        footer: { text: 'Confidential', includeOn: ['content'], position: 'bottom-left' },
      },
    });

    const zip = await JSZip.loadAsync(pptx);
    const pptxXmlPaths = Object.keys(zip.files).filter(
      (path) =>
        (path.startsWith('ppt/slideMasters/') || path.startsWith('ppt/slideLayouts/') || path.startsWith('ppt/slides/')) &&
        path.endsWith('.xml'),
    );
    const pptxXml = (
      await Promise.all(pptxXmlPaths.map((path) => zip.file(path)?.async('string')))
    ).join('\n');

    expect(pptxXml).toContain('Confidential');
    expect(pptxXml).toContain('type="sldNum"');
  });

  it('adds structural spacing before subsequent subhead groups', async () => {
    const slides: Slide[] = [
      {
        title: 'Grouped Content',
        layout: 'content',
        body: [
          { kind: 'subhead', text: 'First group', level: 3 },
          { kind: 'bullet', spans: parseInline('First point'), indent: 0 },
          { kind: 'subhead', text: 'Second group', level: 3 },
          { kind: 'bullet', spans: parseInline('Second point'), indent: 0 },
        ],
      },
    ];

    const pptx = await buildPptx(slides, { title: 'Subhead Spacing' });
    const zip = await JSZip.loadAsync(pptx);
    const slideXml = await zip.file('ppt/slides/slide1.xml')?.async('string');
    const beforeSpaces = [...(slideXml?.matchAll(/<a:spcBef><a:spcPts val="(\d+)"/g) ?? [])].map((m) => Number(m[1]));

    expect(Math.max(...beforeSpaces)).toBeGreaterThanOrEqual(1000);
  });

  it('renders resolved slide image assets on ordinary content slides', async () => {
    const slides: Slide[] = [
      {
        title: 'Visual Content',
        layout: 'content',
        body: [{ kind: 'bullet', spans: parseInline('Generated image should be visible'), indent: 0 }],
        image: { src: tinyPng, alt: 'generated visual', role: 'support' },
      },
    ];

    const pptx = await buildPptx(slides, { title: 'Resolved Image' });
    const zip = await JSZip.loadAsync(pptx);
    const mediaPaths = Object.keys(zip.files).filter((path) => path.startsWith('ppt/media/'));
    const slideXml = await zip.file('ppt/slides/slide1.xml')?.async('string');

    expect(mediaPaths.length).toBeGreaterThan(0);
    expect(slideXml).toContain('Generated image should be visible');
  });

  it('preserves resolved image aspect ratio instead of stretching to the slot', async () => {
    const slides: Slide[] = [
      {
        title: 'Wide Visual',
        layout: 'content',
        body: [{ kind: 'bullet', spans: parseInline('Wide image should keep its original ratio'), indent: 0 }],
        image: { src: widePng, alt: 'wide visual', role: 'support' },
      },
    ];

    const pptx = await buildPptx(slides, { title: 'Image Ratio' });
    const zip = await JSZip.loadAsync(pptx);
    const slideXml = await zip.file('ppt/slides/slide1.xml')?.async('string');
    const pic = slideXml?.match(/<p:pic>[\s\S]*?<a:ext cx="(\d+)" cy="(\d+)"/);
    expect(pic).toBeTruthy();
    const ratio = Number(pic?.[1]) / Number(pic?.[2]);
    expect(ratio).toBeGreaterThan(1.72);
    expect(ratio).toBeLessThan(1.83);
  });

  it('renders resolved slide image assets on special visual layouts', async () => {
    const slides: Slide[] = [
      {
        title: 'Two Column Visual',
        layout: 'two-column',
        body: [],
        columns: [
          [{ kind: 'bullet', spans: parseInline('Left point'), indent: 0 }],
          [{ kind: 'bullet', spans: parseInline('Right point'), indent: 0 }],
        ],
        image: { src: tinyPng, alt: 'supporting visual', role: 'support' },
      },
      {
        title: 'Quote Visual',
        layout: 'quote',
        body: [],
        quote: { text: 'Visuals should not be dropped.', attribution: 'MarkMind' },
        image: { src: tinyPng, alt: 'quote visual', role: 'support' },
      },
      {
        title: 'Stat Visual',
        layout: 'stat',
        body: [],
        stat: { value: '8/8', label: 'Image assets resolved', context: 'Every resolved asset should have a render path.' },
        image: { src: tinyPng, alt: 'stat visual', role: 'support' },
      },
    ];

    const pptx = await buildPptx(slides, { title: 'Special Layout Images' });
    const zip = await JSZip.loadAsync(pptx);
    const slideXml = await Promise.all(
      [1, 2, 3].map((n) => zip.file(`ppt/slides/slide${n}.xml`)?.async('string')),
    );

    for (const xml of slideXml) {
      expect(xml).toContain('<p:pic>');
    }
  });

  it('does not leave an empty special-layout image panel when image resolution fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const slides: Slide[] = [
      {
        title: 'Broken Quote Visual',
        layout: 'quote',
        body: [],
        quote: { text: 'Text should use the full visual area.', attribution: 'MarkMind' },
        image: { src: 'missing-quote-image.png', alt: 'missing visual', role: 'support' },
      },
      {
        title: 'Broken Stat Visual',
        layout: 'stat',
        body: [],
        stat: { value: '0', label: 'No visual should leave an empty panel' },
        image: { src: 'missing-stat-image.png', alt: 'missing visual', role: 'support' },
      },
    ];

    try {
      const pptx = await buildPptx(slides, { title: 'Broken Special Layout Images' });
      const zip = await JSZip.loadAsync(pptx);
      const slideXml = await Promise.all(
        [1, 2].map((n) => zip.file(`ppt/slides/slide${n}.xml`)?.async('string')),
      );

      for (const xml of slideXml) {
        expect(xml).not.toContain('<p:pic>');
        expect(xml).not.toContain('EAF1F7');
      }
    } finally {
      warn.mockRestore();
    }
  });
});
