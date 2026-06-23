import { describe, expect, it } from 'vitest';
import { buildHtmlSlides } from './buildHtmlSlides';
import { getHtmlSlideTheme } from './htmlSlideTheme';
import { parseInline, type Slide } from './markdownToSlides';

describe('buildHtmlSlides', () => {
  it('renders a fixed-stage HTML deck with slide navigation runtime', async () => {
    const slides: Slide[] = [
      { title: 'Deck title', layout: 'title', body: [{ kind: 'text', spans: parseInline('Opening line') }] },
      { title: 'Content', layout: 'content', body: [{ kind: 'bullet', spans: parseInline('First point'), indent: 0 }] },
    ];

    const html = await buildHtmlSlides(slides, { title: 'HTML Deck', theme: getHtmlSlideTheme('blue-professional') });

    expect(html).toContain('<div class="deck-viewport">');
    expect(html).toContain('width: 1920px;');
    expect(html).toContain('height: 1080px;');
    expect(html).toContain('.slide.active');
    expect(html).toContain('class SlidePresentation');
    expect(html).toContain('setupWheelNav');
    expect(html).toContain('setupTouchNav');
    expect(html).toContain('id="fullscreenToggle"');
    expect(html).toContain('setupFullscreen');
    expect(html).toContain('requestFullscreen');
    expect(html).toContain('body.is-fullscreen .deck-controls { display: none; }');
    expect(html).toContain('Deck title');
    expect(html).toContain('First point');
  });

  it('escapes slide text before writing HTML', async () => {
    const slides: Slide[] = [
      {
        title: '<script>alert(1)</script>',
        layout: 'content',
        body: [{ kind: 'text', spans: parseInline('5 < 7 & "safe"') }],
      },
    ];

    const html = await buildHtmlSlides(slides);

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('5 &lt; 7 &amp; &quot;safe&quot;');
  });

  it('serializes speaker notes as valid script JSON', async () => {
    const slides: Slide[] = [
      {
        title: 'Notes',
        layout: 'content',
        body: [],
        notes: 'Close tag </script> & keep quotes "literal"',
      },
    ];

    const html = await buildHtmlSlides(slides);

    expect(html).toContain('<script type="application/json" id="speaker-notes">');
    expect(html).toContain('\\u003C/script\\u003E');
    expect(html).toContain('\\"literal\\"');
    expect(html).not.toContain('&quot;literal&quot;');
  });

  it('applies a selected font family to generated HTML theme variables', async () => {
    const slides: Slide[] = [{ title: 'Font', layout: 'content', body: [] }];

    const html = await buildHtmlSlides(slides, {
      theme: getHtmlSlideTheme('blue-professional'),
      fontFamily: 'Pretendard',
    });

    expect(html).toContain('--font-display: "Pretendard",');
    expect(html).toContain('--font-body: "Pretendard",');
  });

  it('applies the selected slide transition effect', async () => {
    const slides: Slide[] = [{ title: 'Transition', layout: 'content', body: [] }];

    const html = await buildHtmlSlides(slides, { transition: 'cross-fade' });

    expect(html).toContain('/* === SLIDE TRANSITION: cross-fade === */');
    expect(html).toContain('.slide { transition: opacity 520ms ease; }');
    expect(html).toContain('.slide:not(.active) { transform: none; }');
  });

  it('sanitizes selected font family before writing CSS', async () => {
    const slides: Slide[] = [{ title: 'Font', layout: 'content', body: [] }];

    const html = await buildHtmlSlides(slides, { fontFamily: 'Bad</style>{Font};' });

    expect(html).not.toContain('</style>{Font};');
    expect(html).toContain('--font-display: "Bad/styleFont"');
  });

  it('renders the selected template recipe class', async () => {
    const slide: Slide = {
      title: 'Grid idea',
      layout: 'comparison',
      body: [],
      columns: [
        [{ kind: 'bullet', spans: parseInline('One'), indent: 0 }],
        [{ kind: 'bullet', spans: parseInline('Two'), indent: 0 }],
        [{ kind: 'bullet', spans: parseInline('Three'), indent: 0 }],
      ],
    };

    const html = await buildHtmlSlides([slide], { theme: getHtmlSlideTheme('neo-grid-bold') });

    expect(html).toContain('grid-theme');
    expect(html).toContain('ng-frame');
    expect(html).toContain('Three');
  });

  it('uses large HTML image treatments when image intent is present', async () => {
    const image = {
      src: 'data:image/png;base64,AAA=',
      alt: 'Abstract strategy background',
      role: 'cover' as const,
      aspect: '16:9',
    };
    const slides: Slide[] = [
      { title: 'Visual cover', layout: 'title', body: [{ kind: 'text', spans: parseInline('Opening') }], image },
      { title: 'Visual point', layout: 'image-focus', body: [{ kind: 'bullet', spans: parseInline('One clear point'), indent: 0 }], image },
    ];

    const html = await buildHtmlSlides(slides, { theme: getHtmlSlideTheme('blue-professional') });

    expect(html).toContain('cover has-image');
    expect(html).toContain('cover-image');
    expect(html).toContain('image-focus-slide');
    expect(html).toContain('image-focus-bg');
  });

  it('renders explicit HTML variants for richer template layouts', async () => {
    const image = {
      src: 'data:image/png;base64,AAA=',
      alt: 'Editorial visual',
      role: 'support' as const,
      aspect: '16:9',
    };
    const body = ['One', 'Two', 'Three', 'Four', 'Five'].map((text) => ({
      kind: 'bullet' as const,
      spans: parseInline(text),
      indent: 0,
    }));

    const blue = await buildHtmlSlides(
      [{ title: 'Agenda', layout: 'content', htmlVariant: 'blue.agenda-grid', body }],
      { theme: getHtmlSlideTheme('blue-professional') },
    );
    const grid = await buildHtmlSlides(
      [{ title: 'Poster', layout: 'content', htmlVariant: 'neo.poster-grid-6', body }],
      { theme: getHtmlSlideTheme('neo-grid-bold') },
    );
    const signal = await buildHtmlSlides(
      [{ title: 'Timeline', layout: 'timeline', htmlVariant: 'signal.timeline-spine', body }],
      { theme: getHtmlSlideTheme('signal') },
    );
    const blueMetric = await buildHtmlSlides(
      [{ title: 'Metrics', layout: 'content', htmlVariant: 'blue.metric-row', body }],
      { theme: getHtmlSlideTheme('blue-professional') },
    );
    const blueBar = await buildHtmlSlides(
      [{ title: 'Bars', layout: 'content', htmlVariant: 'blue.bar-insight', body }],
      { theme: getHtmlSlideTheme('blue-professional') },
    );
    const blueTension = await buildHtmlSlides(
      [{ title: 'Tension', layout: 'content', htmlVariant: 'blue.tension-resolution', body }],
      { theme: getHtmlSlideTheme('blue-professional') },
    );
    const blueClosing = await buildHtmlSlides(
      [{ title: 'Close', layout: 'content', htmlVariant: 'blue.closing-circles', body }],
      { theme: getHtmlSlideTheme('blue-professional') },
    );
    const bluePhoto = await buildHtmlSlides(
      [{ title: 'Photo', layout: 'content', htmlVariant: 'blue.editorial-photo', body, image }],
      { theme: getHtmlSlideTheme('blue-professional') },
    );
    const bluePhotoBand = await buildHtmlSlides(
      [{ title: 'Photo Band', layout: 'content', htmlVariant: 'blue.photo-band', body, image }],
      { theme: getHtmlSlideTheme('blue-professional') },
    );
    const gridWall = await buildHtmlSlides(
      [{ title: 'Wall', layout: 'content', htmlVariant: 'neo.stat-wall', body }],
      { theme: getHtmlSlideTheme('neo-grid-bold') },
    );
    const gridProcess = await buildHtmlSlides(
      [{ title: 'Process', layout: 'timeline', htmlVariant: 'neo.process-arrows', body }],
      { theme: getHtmlSlideTheme('neo-grid-bold') },
    );
    const gridMatrix = await buildHtmlSlides(
      [{ title: 'Matrix', layout: 'comparison', htmlVariant: 'neo.matrix-table', body }],
      { theme: getHtmlSlideTheme('neo-grid-bold') },
    );
    const gridManifesto = await buildHtmlSlides(
      [{ title: 'Manifesto', layout: 'content', htmlVariant: 'neo.manifesto-grid', body }],
      { theme: getHtmlSlideTheme('neo-grid-bold') },
    );
    const gridImage = await buildHtmlSlides(
      [{ title: 'Billboard', layout: 'content', htmlVariant: 'neo.image-billboard', body, image }],
      { theme: getHtmlSlideTheme('neo-grid-bold') },
    );
    const signalStatement = await buildHtmlSlides(
      [{ title: 'Statement', layout: 'content', htmlVariant: 'signal.statement', body: body.slice(0, 1) }],
      { theme: getHtmlSlideTheme('signal') },
    );
    const signalColumns = await buildHtmlSlides(
      [{ title: 'Columns', layout: 'content', htmlVariant: 'signal.editorial-columns', body }],
      { theme: getHtmlSlideTheme('signal') },
    );
    const signalCompare = await buildHtmlSlides(
      [{ title: 'Compare', layout: 'comparison', htmlVariant: 'signal.compare-hairline', body }],
      { theme: getHtmlSlideTheme('signal') },
    );
    const signalLedger = await buildHtmlSlides(
      [{ title: 'Ledger', layout: 'content', htmlVariant: 'signal.evidence-ledger', body }],
      { theme: getHtmlSlideTheme('signal') },
    );
    const signalPhoto = await buildHtmlSlides(
      [{ title: 'Photo Essay', layout: 'content', htmlVariant: 'signal.photo-essay', body, image }],
      { theme: getHtmlSlideTheme('signal') },
    );
    const signalDossier = await buildHtmlSlides(
      [{ title: 'Image Dossier', layout: 'content', htmlVariant: 'signal.image-dossier', body, image }],
      { theme: getHtmlSlideTheme('signal') },
    );

    expect(blue).toContain('agenda-grid');
    expect(grid).toContain('ng-poster-title');
    expect(signal).toContain('signal-timeline');
    expect(blueMetric).toContain('metric-row');
    expect(blueBar).toContain('bar-insight-layout');
    expect(blueTension).toContain('blue-tension-slide');
    expect(blueClosing).toContain('closing-circles-slide');
    expect(bluePhoto).toContain('blue-editorial-photo-slide');
    expect(bluePhotoBand).toContain('blue-photo-band-slide');
    expect(gridWall).toContain('ng-wall-stat');
    expect(gridProcess).toContain('ng-process-title');
    expect(gridMatrix).toContain('ng-matrix-title');
    expect(gridManifesto).toContain('ng-manifesto-title');
    expect(gridImage).toContain('ng-billboard-photo');
    expect(signalStatement).toContain('signal-statement-slide');
    expect(signalColumns).toContain('signal-columns-layout');
    expect(signalCompare).toContain('signal-compare-layout');
    expect(signalLedger).toContain('signal-ledger-layout');
    expect(signalPhoto).toContain('signal-photo-essay-slide');
    expect(signalDossier).toContain('signal-dossier-slide');
  });

  it('diversifies repeated body slides across the deck', async () => {
    const body = ['One', 'Two', 'Three', 'Four'].map((text) => ({
      kind: 'bullet' as const,
      spans: parseInline(text),
      indent: 0,
    }));
    const textSlides: Slide[] = Array.from({ length: 6 }, (_, index) => ({
      title: `Point ${index + 1}`,
      layout: 'content',
      body,
    }));
    const image = {
      src: 'data:image/png;base64,AAA=',
      alt: 'Editorial visual',
      role: 'support' as const,
      aspect: '16:9',
    };
    const imageSlides: Slide[] = Array.from({ length: 4 }, (_, index) => ({
      title: `Visual point ${index + 1}`,
      layout: 'content',
      body,
      image,
    }));

    const blueText = await buildHtmlSlides(textSlides, { theme: getHtmlSlideTheme('blue-professional') });
    const blueImages = await buildHtmlSlides(imageSlides, { theme: getHtmlSlideTheme('blue-professional') });
    const signalImages = await buildHtmlSlides(imageSlides, { theme: getHtmlSlideTheme('signal') });

    const blueTextVariants = [
      'agenda-grid',
      'metric-row',
      'bar-insight-layout',
      'blue-tension-slide',
      'split-highlight-layout',
      'closing-circles-slide',
    ].filter((className) => blueText.includes(className));

    expect(blueTextVariants.length).toBeGreaterThanOrEqual(3);
    expect(blueImages).toContain('blue-editorial-photo-slide');
    expect(blueImages).toContain('blue-photo-band-slide');
    expect(signalImages).toContain('signal-photo-essay-slide');
    expect(signalImages).toContain('signal-dossier-slide');
  });

  it('applies autonomous design direction, density classes, and image art direction', async () => {
    const image = {
      src: 'data:image/png;base64,AAA=',
      alt: 'Editorial visual',
      role: 'support' as const,
      aspect: '16:9',
    };
    const highPriority: Slide = {
      title: 'Core argument',
      layout: 'content',
      importance: 92,
      body: [
        { kind: 'bullet', spans: parseInline('The key point should become a designed statement'), indent: 0 },
        { kind: 'bullet', spans: parseInline('The second point supports the argument'), indent: 0 },
      ],
    };
    const visualSlide: Slide = {
      title: 'Visual evidence',
      layout: 'content',
      importance: 82,
      body: [{ kind: 'bullet', spans: parseInline('Image should drive the composition'), indent: 0 }],
      image,
    };

    const blue = await buildHtmlSlides([highPriority], { theme: getHtmlSlideTheme('blue-professional') });
    const grid = await buildHtmlSlides([visualSlide], { theme: getHtmlSlideTheme('neo-grid-bold') });

    expect(blue).toContain('blue-tension-slide');
    expect(blue).toContain('slide-density-low');
    expect(blue).toContain('visual-priority-high');
    expect(grid).toContain('ng-billboard-photo');
    expect(grid).toContain('image-treatment-poster');
    expect(grid).toMatch(/image-crop-(center|left|right|top)/);
  });
});
