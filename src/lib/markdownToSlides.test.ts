import { describe, it, expect } from 'vitest';
import {
  markdownToSlides,
  parseInline,
  preserveSourceImagesForPptx,
  slideDeckFromLlmJson,
  slidesFromLlmJson,
} from './markdownToSlides';
import { normalizeSlidesForPptx } from './slideValidation';

describe('markdownToSlides — 분할 규칙', () => {
  it('수평선(---) 으로 슬라이드를 나눈다', () => {
    const md = ['# A', 'alpha', '', '---', '', '# B', 'beta'].join('\n');
    const slides = markdownToSlides(md);
    expect(slides.map((s) => s.title)).toEqual(['A', 'B']);
  });

  it('--- 없어도 slide-level 헤딩(H1)으로 폴백 분할', () => {
    const md = ['# One', 'x', '# Two', 'y', '# Three', 'z'].join('\n');
    const slides = markdownToSlides(md);
    expect(slides.length).toBe(3);
    expect(slides.map((s) => s.title)).toEqual(['One', 'Two', 'Three']);
  });

  it('frontmatter 의 --- 를 슬라이드 경계로 오인하지 않는다', () => {
    const md = [
      '---',
      'title: Deck',
      'author: me',
      '---',
      '# First',
      'content',
      '---',
      '# Second',
      'more',
    ].join('\n');
    const slides = markdownToSlides(md);
    expect(slides.map((s) => s.title)).toEqual(['First', 'Second']);
  });

  it('MarkMind 슬라이드 초안 마커는 PPTX 변환 대상에서 제외한다', () => {
    const md = ['<!-- markmind:slide-draft v1 -->', '# First', 'content', '---', '# Second'].join('\n');
    const slides = markdownToSlides(md);
    expect(slides.map((s) => s.title)).toEqual(['First', 'Second']);
    expect(slides[0].body.map((b) => ('spans' in b ? b.spans.map((s) => s.text).join('') : ''))).not.toContain(
      '<!-- markmind:slide-draft v1 -->',
    );
  });

  it('H1 이 바로 H2 로 이어지면 slide-level=2, H1 은 타이틀 슬라이드', () => {
    const md = ['# Cover', '## Section A', 'a', '## Section B', 'b'].join('\n');
    const slides = markdownToSlides(md);
    // Cover(title) + Section A + Section B
    expect(slides.map((s) => s.title)).toEqual([
      'Cover',
      'Section A',
      'Section B',
    ]);
    expect(slides[0].layout).toBe('title');
    expect(slides[1].layout).toBe('content');
  });

  it('마크다운 헤딩 계층을 슬라이드 출처 정보로 보존', () => {
    const md = [
      '# Strategy',
      '## Problem',
      'Market is fragmented.',
      '### Evidence',
      '- Teams duplicate work',
      '## Solution',
      'Create a shared deck pipeline.',
    ].join('\n');
    const slides = markdownToSlides(md);

    expect(slides.map((s) => s.title)).toEqual(['Strategy', 'Problem', 'Solution']);
    expect(slides[0].sourceLevel).toBe(1);
    expect(slides[0].sectionPath).toBeUndefined();
    expect(slides[1].sourceLevel).toBe(2);
    expect(slides[1].sectionPath).toEqual(['Strategy']);
    expect(slides[2].sectionPath).toEqual(['Strategy']);

    const subhead = slides[1].body.find((b) => b.kind === 'subhead');
    expect(subhead).toMatchObject({ kind: 'subhead', text: 'Evidence', level: 3 });
  });

  it('펜스 코드블록 안의 --- 와 # 은 경계/헤딩이 아니다', () => {
    const md = [
      '# Code',
      '```',
      '# not a heading',
      '---',
      '```',
      'after',
    ].join('\n');
    const slides = markdownToSlides(md);
    expect(slides.length).toBe(1);
    expect(slides[0].body.some((b) => b.kind === 'code')).toBe(true);
  });
});

describe('markdownToSlides — 본문 블록', () => {
  it('리스트는 bullet, 단락은 text, 하위 헤딩은 subhead', () => {
    const md = ['# T', 'para line', '', '- item1', '- item2', '', '## sub'].join(
      '\n',
    );
    const slides = markdownToSlides(md);
    const kinds = slides[0].body.map((b) => b.kind);
    expect(kinds).toContain('text');
    expect(kinds).toContain('bullet');
    expect(kinds).toContain('subhead');
  });

  it('표를 table 블록으로(구분행 제거)', () => {
    const md = ['# T', '| a | b |', '| --- | --- |', '| 1 | 2 |'].join('\n');
    const slides = markdownToSlides(md);
    const table = slides[0].body.find((b) => b.kind === 'table');
    expect(table).toBeDefined();
    if (table && table.kind === 'table') {
      expect(table.rows).toEqual([
        ['a', 'b'],
        ['1', '2'],
      ]);
    }
  });

  it('이미지 전용 라인을 image 블록으로', () => {
    const md = ['# T', '![alt text](img/pic.png)'].join('\n');
    const slides = markdownToSlides(md);
    const img = slides[0].body.find((b) => b.kind === 'image');
    expect(img).toBeDefined();
    if (img && img.kind === 'image') {
      expect(img.src).toBe('img/pic.png');
      expect(img.alt).toBe('alt text');
    }
  });

  it('::: notes 블록을 발표자 노트로 추출', () => {
    const md = ['# T', 'body', '', '::: notes', 'speaker note', ':::'].join(
      '\n',
    );
    const slides = markdownToSlides(md);
    expect(slides[0].notes).toContain('speaker note');
    // 노트가 본문 text 로 새지 않아야
    const text = slides[0].body
      .filter((b) => b.kind === 'text')
      .map((b) => (b.kind === 'text' ? b.spans.map((s) => s.text).join('') : ''))
      .join(' ');
    expect(text).not.toContain('speaker note');
  });

  it('빈 문서도 최소 1장', () => {
    expect(markdownToSlides('').length).toBe(1);
    expect(markdownToSlides('   \n  \n').length).toBe(1);
  });
});

describe('slidesFromLlmJson', () => {
  it('정상 JSON 을 슬라이드로 매핑', () => {
    const raw = JSON.stringify({
      slides: [
        { title: 'Cover', layout: 'title', bullets: ['subtitle'] },
        { title: 'S1', layout: 'content', bullets: ['a', 'b'] },
      ],
    });
    const slides = slidesFromLlmJson(raw);
    expect(slides?.map((s) => s.title)).toEqual(['Cover', 'S1']);
    expect(slides?.[0].layout).toBe('title');
    expect(slides?.[1].body.filter((b) => b.kind === 'bullet').length).toBe(2);
  });

  it('코드펜스/잡텍스트로 감싸도 추출', () => {
    const raw = '```json\n{"slides":[{"title":"T","bullets":["x"]}]}\n```';
    const slides = slidesFromLlmJson(raw);
    expect(slides?.length).toBe(1);
    expect(slides?.[0].title).toBe('T');
  });

  it('상위 master 사양을 슬라이드 덱 메타데이터로 보존', () => {
    const raw = JSON.stringify({
      master: {
        slideNumber: { enabled: true, includeOn: ['content', 'section'], position: 'bottom-center' },
        footer: { text: 'Confidential', includeOn: ['content'], position: 'bottom-left' },
        date: { enabled: false, text: '2026-06-23' },
      },
      slides: [{ title: 'T', layout: 'content', bullets: ['x'] }],
    });
    const deck = slideDeckFromLlmJson(raw);
    expect(deck?.slides.length).toBe(1);
    expect(deck?.masterSpec?.slideNumber?.includeOn).toEqual(['content', 'section']);
    expect(deck?.masterSpec?.footer?.text).toBe('Confidential');
    expect(deck?.masterSpec?.date?.enabled).toBe(false);
    expect(slidesFromLlmJson(raw)?.[0].title).toBe('T');
  });

  it('HTML 전용 variant 힌트를 보존한다', () => {
    const raw = JSON.stringify({
      slides: [
        { title: 'Agenda', layout: 'content', htmlVariant: 'blue.agenda-grid', bullets: ['A'] },
        { title: 'Signal', layout: 'content', html: { variant: 'signal.timeline-spine' }, bullets: ['B'] },
      ],
    });

    const slides = slidesFromLlmJson(raw);

    expect(slides?.[0].htmlVariant).toBe('blue.agenda-grid');
    expect(slides?.[1].htmlVariant).toBe('signal.timeline-spine');
  });

  it('잘린 JSON 에서 완성된 슬라이드만 부분 복구', () => {
    // 마지막 객체가 토큰 한도로 잘린 상황
    const raw =
      '{"slides":[{"title":"A","layout":"title","bullets":["s"]},' +
      '{"title":"B","layout":"content","bullets":["b1","b2"]},' +
      '{"title":"C","layout":"content","bullets":["c1",';
    const slides = slidesFromLlmJson(raw);
    expect(slides?.map((s) => s.title)).toEqual(['A', 'B']); // C 는 미완성 → 제외
  });

  it('확장 레이아웃 필드를 보존', () => {
    const raw = JSON.stringify({
      slides: [
        { title: 'Cover', layout: 'title', bullets: ['subtitle'] },
        {
          title: 'Why now',
          layout: 'stat',
          importance: 92,
          importanceReason: 'core evidence slide',
          sourceIds: ['S2', 'S3'],
          source: { headingLevel: 2, sectionPath: ['Market'] },
          stat: { value: '73%', label: 'teams need cleaner slides', context: 'Survey summary' },
          notes: 'speaker note',
        },
        {
          title: 'Options',
          layout: 'two-column',
          columns: [
            ['Fast setup', 'Good defaults'],
            [{ kind: 'subhead', text: 'Custom', level: 3 }, { kind: 'text', text: 'DESIGN.md later' }],
          ],
        },
        {
          title: 'Signal',
          layout: 'quote',
          quote: { text: 'Design is a system.', attribution: 'Team note' },
        },
        {
          title: 'Visual',
          layout: 'image-focus',
          image: {
            query: 'clean renewable energy infrastructure',
            entity: 'renewable energy',
            role: 'hero',
            aspect: '16:9',
            sourcePreference: 'auto',
            licenseStrictness: 'open',
          },
        },
      ],
    });
    const slides = slidesFromLlmJson(raw);
    expect(slides?.[1].layout).toBe('stat');
    expect(slides?.[1].importance).toBe(92);
    expect(slides?.[1].importanceReason).toBe('core evidence slide');
    expect(slides?.[1].sourceIds).toEqual(['S2', 'S3']);
    expect(slides?.[1].sourceLevel).toBe(2);
    expect(slides?.[1].sectionPath).toEqual(['Market']);
    expect(slides?.[1].stat?.value).toBe('73%');
    expect(slides?.[2].columns?.length).toBe(2);
    expect(slides?.[2].columns?.[1][0]).toMatchObject({ kind: 'subhead', level: 3 });
    expect(slides?.[3].quote?.attribution).toBe('Team note');
    expect(slides?.[4].image).toMatchObject({
      query: 'clean renewable energy infrastructure',
      entity: 'renewable energy',
      role: 'hero',
      aspect: '16:9',
      sourcePreference: 'auto',
      licenseStrictness: 'open',
    });
  });

  it('이미지 제외 의도만 있는 image 객체도 보존', () => {
    const raw = JSON.stringify({
      slides: [{ title: 'No visual', layout: 'content', image: { sourcePreference: 'none' }, bullets: ['text only'] }],
    });
    const slides = slidesFromLlmJson(raw);
    expect(slides?.[0].image?.sourcePreference).toBe('none');
  });

  it('source-only PPTX 경로에서 원본 Markdown 이미지 src를 보강', () => {
    const sourceSlides = markdownToSlides(['# Visual evidence', '![diagram](assets/diagram.png)', 'supporting text'].join('\n'));
    const aiSlides = slidesFromLlmJson(
      JSON.stringify({
        slides: [{ title: 'Visual evidence', layout: 'content', sourceIds: ['S1'], bullets: ['supporting text'] }],
      }),
    );

    const merged = preserveSourceImagesForPptx(aiSlides ?? [], sourceSlides);

    expect(merged[0].image?.src).toBe('assets/diagram.png');
    expect(merged[0].image?.alt).toBe('diagram');
  });

  it('source-only PPTX 경로에서 sourceIds를 원본 source section ID로 매핑', () => {
    const markdown = ['# Report', 'Intro paragraph.', '## Evidence', '![chart](assets/chart.png)', 'Details'].join('\n');
    const aiSlides = slidesFromLlmJson(
      JSON.stringify({
        slides: [
          { title: 'Report', layout: 'title', sourceIds: ['S1'], bullets: ['Intro paragraph.'] },
          { title: 'Evidence', layout: 'content', sourceIds: ['S2'], bullets: ['Details'] },
        ],
      }),
    );

    const merged = preserveSourceImagesForPptx(aiSlides ?? [], markdown);

    expect(merged[0].image?.src).toBeUndefined();
    expect(merged[1].image?.src).toBe('assets/chart.png');
    expect(merged[1].image?.alt).toBe('chart');
  });

  it('source-only PPTX 경로에서 리스트 안의 원본 이미지도 보강', () => {
    const markdown = ['# Report', 'Intro paragraph.', '## Evidence', '- ![chart](assets/chart.png)', 'Details'].join('\n');
    const aiSlides = slidesFromLlmJson(
      JSON.stringify({
        slides: [{ title: 'Evidence', layout: 'content', sourceIds: ['S2'], bullets: ['Details'] }],
      }),
    );

    const merged = preserveSourceImagesForPptx(aiSlides ?? [], markdown);

    expect(merged[0].image?.src).toBe('assets/chart.png');
    expect(merged[0].image?.alt).toBe('chart');
  });

  it('source-only PPTX 경로에서 같은 sourceId의 원본 이미지를 순서대로 소비', () => {
    const markdown = ['# Report', '## Evidence', '![first](assets/first.png)', '![second](assets/second.png)'].join('\n');
    const aiSlides = slidesFromLlmJson(
      JSON.stringify({
        slides: [
          { title: 'First evidence', layout: 'content', sourceIds: ['S2'], bullets: ['first'] },
          { title: 'Second evidence', layout: 'content', sourceIds: ['S2'], bullets: ['second'] },
        ],
      }),
    );

    const merged = preserveSourceImagesForPptx(aiSlides ?? [], markdown);

    expect(merged[0].image?.src).toBe('assets/first.png');
    expect(merged[1].image?.src).toBe('assets/second.png');
  });

  it('source-only PPTX 경로에서 split 이후 continuation에도 같은 sourceId 이미지를 보강', () => {
    const markdown = ['# Report', '## Evidence', '![first](assets/first.png)', '![second](assets/second.png)'].join('\n');
    const aiSlides = slidesFromLlmJson(
      JSON.stringify({
        slides: [
          {
            title: 'Dense evidence',
            layout: 'content',
            sourceIds: ['S2'],
            bullets: Array.from({ length: 14 }, (_, index) => `Evidence point ${index + 1}`),
          },
        ],
      }),
    );

    const normalized = normalizeSlidesForPptx(aiSlides ?? []);
    const merged = preserveSourceImagesForPptx(normalized, markdown);

    expect(normalized).toHaveLength(2);
    expect(merged[0].image?.src).toBe('assets/first.png');
    expect(merged[1].image?.src).toBe('assets/second.png');
  });

  it('source-only PPTX 경로에서 split 첫 조각의 기존 원본 이미지도 소비 처리', () => {
    const markdown = ['# Report', '## Evidence', '![first](assets/first.png)', '![second](assets/second.png)'].join('\n');
    const aiSlides = slidesFromLlmJson(
      JSON.stringify({
        slides: [
          {
            title: 'Dense evidence',
            layout: 'content',
            sourceIds: ['S2'],
            image: { src: 'assets/first.png', alt: 'first' },
            bullets: Array.from({ length: 14 }, (_, index) => `Evidence point ${index + 1}`),
          },
        ],
      }),
    );

    const normalized = normalizeSlidesForPptx(aiSlides ?? []);
    const merged = preserveSourceImagesForPptx(normalized, markdown);

    expect(normalized).toHaveLength(2);
    expect(merged[0].image?.src).toBe('assets/first.png');
    expect(merged[1].image?.src).toBe('assets/second.png');
  });

  it('source-only PPTX 경로에서 sourceId 없는 split 첫 조각의 기존 원본 이미지도 fallback 순서에서 소비', () => {
    const markdown = ['# Report', '## Evidence', '![first](assets/first.png)', '![second](assets/second.png)'].join('\n');
    const aiSlides = slidesFromLlmJson(
      JSON.stringify({
        slides: [
          {
            title: 'Dense evidence',
            layout: 'content',
            image: { src: 'assets/first.png', alt: 'first' },
            bullets: Array.from({ length: 14 }, (_, index) => `Evidence point ${index + 1}`),
          },
        ],
      }),
    );

    const normalized = normalizeSlidesForPptx(aiSlides ?? []);
    const merged = preserveSourceImagesForPptx(normalized, markdown);

    expect(normalized).toHaveLength(2);
    expect(merged[0].image?.src).toBe('assets/first.png');
    expect(merged[1].image?.src).toBe('assets/second.png');
  });

  it('sourceId 없는 기존 원본 이미지가 첫 fallback 슬롯이 아니어도 continuation에 앞 이미지를 밀지 않음', () => {
    const markdown = [
      '# Cover',
      '![cover](assets/cover.png)',
      '## Evidence',
      '![first](assets/first.png)',
      '![second](assets/second.png)',
    ].join('\n');
    const aiSlides = slidesFromLlmJson(
      JSON.stringify({
        slides: [
          {
            title: 'Dense evidence',
            layout: 'content',
            image: { src: 'assets/first.png', alt: 'first' },
            bullets: Array.from({ length: 14 }, (_, index) => `Evidence point ${index + 1}`),
          },
        ],
      }),
    );

    const normalized = normalizeSlidesForPptx(aiSlides ?? []);
    const merged = preserveSourceImagesForPptx(normalized, markdown);

    expect(normalized).toHaveLength(2);
    expect(merged[0].image?.src).toBe('assets/first.png');
    expect(merged[1].image?.src).toBe('assets/second.png');
  });

  it('source-map fallback으로 소비한 이미지를 split continuation의 slide-index fallback에서 중복하지 않음', () => {
    const markdown = ['# Cover', 'Intro', '## Evidence', '![first](assets/first.png)'].join('\n');
    const aiSlides = slidesFromLlmJson(
      JSON.stringify({
        slides: [
          {
            title: 'Dense evidence',
            layout: 'content',
            bullets: Array.from({ length: 14 }, (_, index) => `Evidence point ${index + 1}`),
          },
        ],
      }),
    );

    const normalized = normalizeSlidesForPptx(aiSlides ?? []);
    const merged = preserveSourceImagesForPptx(normalized, markdown);

    expect(normalized).toHaveLength(2);
    expect(merged[0].image?.src).toBe('assets/first.png');
    expect(merged[1].image?.src).toBeUndefined();
  });

  it('source map S번호와 markdownToSlides index가 달라도 소비한 이미지를 slide-index fallback에서 중복하지 않음', () => {
    const markdown = ['# Deck', '## Evidence', 'Body text', '### Chart', '![chart](assets/chart.png)'].join('\n');
    const aiSlides = slidesFromLlmJson(
      JSON.stringify({
        slides: [
          {
            title: 'Dense evidence',
            layout: 'content',
            bullets: Array.from({ length: 14 }, (_, index) => `Evidence point ${index + 1}`),
          },
        ],
      }),
    );

    const normalized = normalizeSlidesForPptx(aiSlides ?? []);
    const merged = preserveSourceImagesForPptx(normalized, markdown);

    expect(normalized).toHaveLength(2);
    expect(merged[0].image?.src).toBe('assets/chart.png');
    expect(merged[1].image?.src).toBeUndefined();
  });

  it('source slide의 두 번째 이미지를 소비해도 같은 source slide의 첫 이미지를 continuation에 붙이지 않음', () => {
    const markdown = ['# Deck', '## Evidence', '![first](assets/first.png)', '![second](assets/second.png)'].join('\n');
    const aiSlides = slidesFromLlmJson(
      JSON.stringify({
        slides: [
          {
            title: 'Dense evidence',
            layout: 'content',
            image: { src: 'assets/second.png', alt: 'second' },
            bullets: Array.from({ length: 14 }, (_, index) => `Evidence point ${index + 1}`),
          },
        ],
      }),
    );

    const normalized = normalizeSlidesForPptx(aiSlides ?? []);
    const merged = preserveSourceImagesForPptx(normalized, markdown);

    expect(normalized).toHaveLength(2);
    expect(merged[0].image?.src).toBe('assets/second.png');
    expect(merged[1].image?.src).toBeUndefined();
  });

  it('완전 비 JSON 은 null', () => {
    expect(slidesFromLlmJson('sorry, I cannot do that')).toBeNull();
  });
});

describe('parseInline', () => {
  it('bold/italic/code 스팬 분리', () => {
    const spans = parseInline('a **b** c *d* e `f`');
    expect(spans.find((s) => s.bold)?.text).toBe('b');
    expect(spans.find((s) => s.italic)?.text).toBe('d');
    expect(spans.find((s) => s.code)?.text).toBe('f');
  });

  it('서식 없으면 단일 스팬', () => {
    const spans = parseInline('plain text');
    expect(spans).toEqual([{ text: 'plain text' }]);
  });
});
