// 마크다운 → 슬라이드 모델 (결정론 파서) — 이슈 #6 PPTX 내보내기
//
// Pandoc 표준 슬라이드 분할 규약을 채택한다:
//   - 수평선(`---`)은 항상 새 슬라이드를 시작한다.
//   - slide-level 헤딩은 항상 새 슬라이드를 시작한다.
//   - slide-level 보다 위(더 큰 헤딩, 예: H1<H2)는 타이틀 슬라이드가 된다.
//   - slide-level 보다 아래 헤딩은 슬라이드 내부 소제목이 된다.
// slide-level = "내용이 바로 뒤따르는 최상위 헤딩 레벨"(없으면 1).
//
// 핵심 함정: YAML frontmatter 의 `---` 와 슬라이드 구분 `---` 혼동 → frontmatter 를
// 가장 먼저 제거한다. 펜스 코드블록 안의 `---`/`#` 은 경계/헤딩으로 보지 않는다.
//
// 이 파서의 출력(Slide[])은 buildPptx.ts 와 LLM 스마트 레이아웃 경로가 공유하는
// 단일 스키마다(경로 통일).

export interface InlineSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

export type SlideBlock =
  | { kind: 'bullet'; spans: InlineSpan[]; indent: number }
  | { kind: 'text'; spans: InlineSpan[] }
  | { kind: 'subhead'; text: string; level?: number }
  | { kind: 'code'; text: string; lang?: string }
  | { kind: 'table'; rows: string[][] } // rows[0] = 헤더
  | { kind: 'image'; src: string; alt?: string };

export type SlideLayout =
  | 'title'
  | 'content'
  | 'section'
  | 'two-column'
  | 'image-focus'
  | 'quote'
  | 'stat'
  | 'comparison'
  | 'timeline';

export interface Slide {
  title: string;
  layout: SlideLayout;
  body: SlideBlock[];
  notes?: string;
  /** LLM path: source section IDs from the Rust source map, e.g. ["S2", "S5"]. */
  sourceIds?: string[];
  /** 원본 마크다운 헤딩 레벨(H1=1...). LLM 경로도 같은 힌트를 넣을 수 있다. */
  sourceLevel?: number;
  /** 현재 슬라이드의 상위 섹션 경로. 예: ["Product", "Strategy"]. */
  sectionPath?: string[];
  columns?: SlideBlock[][];
  quote?: { text: string; attribution?: string };
  stat?: { value: string; label?: string; context?: string };
  image?: { src?: string; alt?: string; prompt?: string; kind?: string };
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const HR_RE = /^\s*([-*_])(?:\s*\1){2,}\s*$/; // ---, ***, ___ (3개 이상)
const FENCE_RE = /^\s*(```|~~~)(.*)$/;
const LIST_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;
const TABLE_ROW_RE = /^\s*\|(.+)\|\s*$/;
const TABLE_SEP_RE = /^\s*\|?[\s:|-]+\|?\s*$/; // |---|:--:| 류 구분행
const IMAGE_ONLY_RE = /^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/;
const SLIDE_DRAFT_MARKER_LINE_RE =
  /^\s*(?:<!--\s*markmind:slide-draft\b[^>]*-->|&lt;!--\s*markmind:slide-draft\b.*?--&gt;)\s*$/i;

function stripSlideDraftMarker(md: string): string {
  return md
    .split('\n')
    .filter((line) => !SLIDE_DRAFT_MARKER_LINE_RE.test(line))
    .join('\n');
}

/** YAML frontmatter 제거 + 본문에서 `title:` 회수(덱 제목 폴백용). */
function stripFrontmatter(md: string): { body: string; title?: string } {
  const lines = md.split('\n');
  if (lines[0]?.trim() !== '---') return { body: md };
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) return { body: md }; // 닫는 --- 없음 → frontmatter 아님
  let title: string | undefined;
  for (let i = 1; i < end; i++) {
    const m = lines[i].match(/^title\s*:\s*(.+)$/i);
    if (m) title = m[1].trim().replace(/^["']|["']$/g, '');
  }
  return { body: lines.slice(end + 1).join('\n'), title };
}

/** 한 줄을 의미 토큰으로 분류. 펜스 코드블록은 상위에서 atomic 처리. */
type Line =
  | { t: 'heading'; level: number; text: string }
  | { t: 'hr' }
  | { t: 'list'; indent: number; text: string }
  | { t: 'table'; cells: string[] }
  | { t: 'tablesep' }
  | { t: 'image'; alt: string; src: string }
  | { t: 'blank' }
  | { t: 'text'; text: string };

function classify(line: string): Line {
  if (line.trim() === '') return { t: 'blank' };
  if (HR_RE.test(line)) return { t: 'hr' };
  const h = line.match(HEADING_RE);
  if (h) return { t: 'heading', level: h[1].length, text: h[2].trim() };
  const img = line.match(IMAGE_ONLY_RE);
  if (img) return { t: 'image', alt: img[1], src: img[2].trim() };
  const li = line.match(LIST_RE);
  if (li) return { t: 'list', indent: Math.floor(li[1].length / 2), text: li[2] };
  if (TABLE_ROW_RE.test(line)) {
    if (TABLE_SEP_RE.test(line) && line.includes('-'))
      return { t: 'tablesep' };
    const cells = line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim());
    return { t: 'table', cells };
  }
  return { t: 'text', text: line };
}

/** 인라인 마크다운(`**bold**`, `*em*`/`_em_`, `` `code` ``) → 스팬 배열. */
export function parseInline(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  // 토큰: `code` | **bold** | __bold__ | *em* | _em_
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*]+\*|_[^_]+_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) spans.push({ text: text.slice(last, m.index) });
    if (m[1]) spans.push({ text: m[1].slice(1, -1), code: true });
    else if (m[2]) spans.push({ text: m[2].slice(2, -2), bold: true });
    else if (m[3]) spans.push({ text: m[3].slice(1, -1), italic: true });
    last = re.lastIndex;
  }
  if (last < text.length) spans.push({ text: text.slice(last) });
  return spans.length > 0 ? spans : [{ text }];
}

const SLIDE_LAYOUTS = new Set<SlideLayout>([
  'title',
  'content',
  'section',
  'two-column',
  'image-focus',
  'quote',
  'stat',
  'comparison',
  'timeline',
]);

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    : [];
}

function blocksFromBullets(bullets: string[], kind: 'text' | 'bullet' = 'bullet'): SlideBlock[] {
  return bullets.map((b) =>
    kind === 'text'
      ? { kind: 'text', spans: parseInline(b) }
      : { kind: 'bullet', spans: parseInline(b), indent: 0 },
  );
}

function blocksFromUnknown(value: unknown): SlideBlock[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (typeof item === 'string') return blocksFromBullets([item]);
      if (!item || typeof item !== 'object') return [];
      const o = item as Record<string, unknown>;
      const text = typeof o.text === 'string' ? o.text : typeof o.value === 'string' ? o.value : '';
      if (!text.trim()) return [];
      if (o.kind === 'subhead') {
        const level = numberInRange(o.level, 1, 6) ?? numberInRange(o.headingLevel, 1, 6);
        return [{ kind: 'subhead', text, level }];
      }
      return blocksFromBullets([text], o.kind === 'text' ? 'text' : 'bullet');
    });
  }
  return [];
}

function numberInRange(value: unknown, min: number, max: number): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
}

function stringPath(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const path = value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim());
  return path.length > 0 ? path.slice(0, 6) : undefined;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function sourceFromUnknown(o: Record<string, unknown>): { sourceLevel?: number; sectionPath?: string[] } {
  const source = o.source && typeof o.source === 'object' ? (o.source as Record<string, unknown>) : {};
  return {
    sourceLevel:
      numberInRange(source.headingLevel, 1, 6) ??
      numberInRange(source.level, 1, 6) ??
      numberInRange(o.headingLevel, 1, 6) ??
      numberInRange(o.sourceLevel, 1, 6) ??
      numberInRange(o.level, 1, 6),
    sectionPath: stringPath(source.sectionPath) ?? stringPath(o.sectionPath),
  };
}

function sourceIdsFromUnknown(o: Record<string, unknown>): string[] | undefined {
  const source = o.source && typeof o.source === 'object' ? (o.source as Record<string, unknown>) : {};
  const ids = uniqueStrings([
    ...stringList(o.sourceIds),
    ...stringList(o.sources),
    ...stringList(source.sourceIds),
    ...stringList(source.ids),
  ]);
  return ids.length > 0 ? ids : undefined;
}

function quoteFromUnknown(value: unknown): Slide['quote'] | undefined {
  if (typeof value === 'string' && value.trim()) return { text: value.trim() };
  if (!value || typeof value !== 'object') return undefined;
  const o = value as Record<string, unknown>;
  const text = typeof o.text === 'string' ? o.text.trim() : '';
  if (!text) return undefined;
  return {
    text,
    attribution: typeof o.attribution === 'string' && o.attribution.trim() ? o.attribution.trim() : undefined,
  };
}

function statFromUnknown(value: unknown): Slide['stat'] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const o = value as Record<string, unknown>;
  const statValue =
    typeof o.value === 'string' ? o.value.trim() : typeof o.value === 'number' ? String(o.value) : '';
  if (!statValue) return undefined;
  return {
    value: statValue,
    label: typeof o.label === 'string' && o.label.trim() ? o.label.trim() : undefined,
    context: typeof o.context === 'string' && o.context.trim() ? o.context.trim() : undefined,
  };
}

function imageFromUnknown(value: unknown): Slide['image'] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const o = value as Record<string, unknown>;
  const src = typeof o.src === 'string' && o.src.trim() ? o.src.trim() : undefined;
  const prompt = typeof o.prompt === 'string' && o.prompt.trim() ? o.prompt.trim() : undefined;
  if (!src && !prompt) return undefined;
  return {
    src,
    prompt,
    alt: typeof o.alt === 'string' && o.alt.trim() ? o.alt.trim() : undefined,
    kind: typeof o.kind === 'string' && o.kind.trim() ? o.kind.trim() : undefined,
  };
}

/** LLM 슬라이드 객체 → Slide. 새 필드는 없으면 기존 bullets 기반으로 복구한다. */
function llmObjToSlide(o: Record<string, unknown>, index: number): Slide {
  const title = typeof o.title === 'string' ? o.title : '';
  const bullets = stringList(o.bullets);
  const source = sourceFromUnknown(o);
  const sourceIds = sourceIdsFromUnknown(o);
  const rawLayout = typeof o.layout === 'string' ? o.layout : '';
  const layout: SlideLayout =
    rawLayout && SLIDE_LAYOUTS.has(rawLayout as SlideLayout)
      ? (rawLayout as SlideLayout)
      : index === 0
        ? 'title'
        : 'content';
  let body = blocksFromUnknown(o.blocks);
  if (body.length === 0) {
    body = layout === 'title' || layout === 'section'
      ? blocksFromBullets(bullets.slice(0, 2), 'text')
      : blocksFromBullets(bullets);
  }
  const notes = typeof o.notes === 'string' && o.notes.trim() ? o.notes.trim() : undefined;
  const columns = Array.isArray(o.columns)
    ? o.columns.map(blocksFromUnknown).filter((col) => col.length > 0).slice(0, 3)
    : undefined;
  return {
    title,
    layout,
    body,
    notes,
    sourceIds,
    sourceLevel: source.sourceLevel,
    sectionPath: source.sectionPath,
    columns,
    quote: quoteFromUnknown(o.quote),
    stat: statFromUnknown(o.stat),
    image: imageFromUnknown(o.image),
  };
}

/**
 * 문자열에서 최상위 균형 `{...}` 객체들을 순서대로 추출(문자열/이스케이프 인식).
 * 잘린 JSON 에서 "완성된 객체까지만" 살리는 데 쓴다.
 */
function extractBalancedObjects(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let startIdx = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') {
      if (depth === 0) startIdx = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && startIdx !== -1) {
        out.push(s.slice(startIdx, i + 1));
        startIdx = -1;
      }
    }
  }
  return out;
}

/**
 * LLM 스마트 레이아웃(generate_slides_llm)의 JSON 응답 → Slide[].
 * 기대 형태: { "slides": [ { title, layout?, bullets[], notes? } ] }.
 *
 * 1) 코드펜스/잡텍스트 제거 후 첫 `{`~마지막 `}` 를 strict 파싱.
 * 2) strict 실패(주로 max_output_tokens 로 JSON 이 잘림) → 부분 복구:
 *    `"slides"` 배열에서 완성된 `{...}` 객체만 추출해 살린다(우아한 degradation).
 * 둘 다 실패하면 null(→ 호출부가 규칙 기반으로 폴백).
 */
export function slidesFromLlmJson(raw: string): Slide[] | null {
  // 1) strict
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      const obj = JSON.parse(raw.slice(start, end + 1));
      const arr = Array.isArray(obj) ? obj : obj.slides;
      if (Array.isArray(arr) && arr.length > 0) {
        return arr.map((s, i) => llmObjToSlide((s ?? {}) as Record<string, unknown>, i));
      }
    } catch {
      /* 잘림 가능성 → 부분 복구로 진행 */
    }
  }

  // 2) 부분 복구 — "slides" 배열 이후의 완성된 객체만 추출.
  const arrPos = raw.search(/"slides"\s*:\s*\[/);
  const scanFrom = arrPos === -1 ? start === -1 ? 0 : start : arrPos;
  const objs = extractBalancedObjects(raw.slice(scanFrom));
  const slides: Slide[] = [];
  objs.forEach((objStr, i) => {
    try {
      const o = JSON.parse(objStr) as Record<string, unknown>;
      // 슬라이드 객체로 보이는 것만(bullets/title 키 보유)
      if ('bullets' in o || 'title' in o) slides.push(llmObjToSlide(o, slides.length));
      else void i;
    } catch {
      /* 마지막 잘린 객체는 무시 */
    }
  });
  return slides.length > 0 ? slides : null;
}

/** slide-level 산정 — 내용이 바로 뒤따르는 최상위(가장 작은 번호) 헤딩 레벨. */
function computeSlideLevel(lines: Line[]): number {
  let best = 7;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (ln.t !== 'heading') continue;
    // 다음 비어있지 않은 라인이 헤딩이 아니면 = 내용이 뒤따름
    let j = i + 1;
    while (j < lines.length && lines[j].t === 'blank') j++;
    const next = lines[j];
    if (!next || next.t !== 'heading') {
      if (ln.level < best) best = ln.level;
    }
  }
  return best === 7 ? 1 : best;
}

/** 슬라이드 본문 라인들을 SlideBlock[] 로 변환. */
function parseBody(lines: Line[], slideLevel: number): SlideBlock[] {
  const blocks: SlideBlock[] = [];
  let para: string[] = [];
  let table: string[][] | null = null;

  const flushPara = () => {
    if (para.length > 0) {
      blocks.push({ kind: 'text', spans: parseInline(para.join(' ')) });
      para = [];
    }
  };
  const flushTable = () => {
    if (table && table.length > 0) {
      blocks.push({ kind: 'table', rows: table });
    }
    table = null;
  };

  for (const ln of lines) {
    if (ln.t !== 'table' && ln.t !== 'tablesep') flushTable();
    switch (ln.t) {
      case 'blank':
        flushPara();
        break;
      case 'heading':
        flushPara();
        if (ln.level > slideLevel)
          blocks.push({ kind: 'subhead', text: ln.text, level: ln.level });
        // slide-level 이하 헤딩은 상위에서 슬라이드 경계로 소비됨(여기 안 옴)
        break;
      case 'list':
        flushPara();
        blocks.push({
          kind: 'bullet',
          spans: parseInline(ln.text),
          indent: ln.indent,
        });
        break;
      case 'image':
        flushPara();
        blocks.push({ kind: 'image', src: ln.src, alt: ln.alt || undefined });
        break;
      case 'table':
        if (!table) table = [];
        table.push(ln.cells);
        break;
      case 'tablesep':
        break; // 구분행 무시
      case 'text':
        para.push(ln.text);
        break;
    }
  }
  flushPara();
  flushTable();
  return blocks;
}

/** `::: notes ... :::` 또는 `<!-- notes: ... -->` 발표자 노트 추출 + 본문에서 제거. */
function extractNotes(body: string): { body: string; notes?: string } {
  const notes: string[] = [];
  let out = body.replace(
    /^:::+\s*notes\s*$([\s\S]*?)^:::+\s*$/gim,
    (_all, inner: string) => {
      notes.push(inner.trim());
      return '';
    },
  );
  out = out.replace(/<!--\s*notes:\s*([\s\S]*?)-->/gi, (_all, inner: string) => {
    notes.push(inner.trim());
    return '';
  });
  return { body: out, notes: notes.length ? notes.join('\n\n') : undefined };
}

/**
 * 마크다운 문자열 → Slide[].
 * frontmatter 제거 → 펜스 코드 atomic 토큰화 → slide-level 산정 →
 * 수평선/slide-level 헤딩 경계로 분할 → 슬라이드별 본문 파싱.
 */
export function markdownToSlides(markdown: string): Slide[] {
  const { body: noFm } = stripFrontmatter(stripSlideDraftMarker(markdown));
  const { body: noNotesBody, notes: docNotes } = extractNotes(noFm);

  // 1) 펜스 코드블록을 atomic 으로: 코드 라인은 분류하지 않고 통째 보관.
  const rawLines = noNotesBody.split('\n');
  type Item = { line: Line } | { code: { text: string; lang?: string } };
  const items: Item[] = [];
  let i = 0;
  while (i < rawLines.length) {
    const fence = rawLines[i].match(FENCE_RE);
    if (fence) {
      const marker = fence[1];
      const lang = fence[2].trim() || undefined;
      const buf: string[] = [];
      i++;
      while (i < rawLines.length && !rawLines[i].trimStart().startsWith(marker)) {
        buf.push(rawLines[i]);
        i++;
      }
      i++; // 닫는 펜스 소비
      items.push({ code: { text: buf.join('\n'), lang } });
      continue;
    }
    items.push({ line: classify(rawLines[i]) });
    i++;
  }

  // slide-level 산정엔 일반 라인만 사용(코드블록은 content 로 취급).
  const lineView: Line[] = items.map((it) =>
    'code' in it ? ({ t: 'text', text: '' } as Line) : it.line,
  );
  const slideLevel = computeSlideLevel(lineView);

  // 2) 경계 분할: 수평선 / slide-level 이하 헤딩에서 새 슬라이드.
  type Seg = { title: string; level: number | null; sectionPath: string[]; items: Item[] };
  const segs: Seg[] = [];
  let cur: Seg | null = null;
  const headingStack: string[] = [];
  const ensure = () => {
    if (!cur) {
      cur = { title: '', level: null, sectionPath: headingStack.filter(Boolean), items: [] };
      segs.push(cur);
    }
    return cur;
  };
  for (const it of items) {
    if ('code' in it) {
      ensure().items.push(it);
      continue;
    }
    const ln = it.line;
    if (ln.t === 'hr') {
      cur = null; // 다음 내용이 새 슬라이드
      continue;
    }
    if (ln.t === 'heading' && ln.level <= slideLevel) {
      const parentPath = headingStack.slice(0, Math.max(0, ln.level - 1)).filter(Boolean);
      headingStack[ln.level - 1] = ln.text;
      headingStack.length = ln.level;
      cur = { title: ln.text, level: ln.level, sectionPath: parentPath, items: [] };
      segs.push(cur);
      continue;
    }
    ensure().items.push(it);
  }

  // 3) 세그먼트 → Slide. 빈 세그먼트(공백만)는 버린다.
  const slides: Slide[] = [];
  for (const seg of segs) {
    const merged: SlideBlock[] = [];
    // 코드블록을 본문 순서대로 끼워넣기 위해 items 를 직접 순회
    let pendingLines: Line[] = [];
    const flushLines = () => {
      if (pendingLines.length) {
        merged.push(...parseBody(pendingLines, slideLevel));
        pendingLines = [];
      }
    };
    for (const it of seg.items) {
      if ('code' in it) {
        flushLines();
        merged.push({ kind: 'code', text: it.code.text, lang: it.code.lang });
      } else {
        pendingLines.push(it.line);
      }
    }
    flushLines();

    const hasContent = merged.length > 0;
    if (!seg.title && !hasContent) continue;

    // 타이틀 레이아웃: slide-level 보다 위 헤딩(level < slideLevel) 이거나
    // 제목만 있고 본문이 사실상 없는 경우.
    const isTitle =
      (seg.level !== null && seg.level < slideLevel) ||
      (!!seg.title && !hasContent);

    slides.push({
      title: seg.title,
      layout: isTitle ? 'title' : 'content',
      body: merged,
      sourceLevel: seg.level ?? undefined,
      sectionPath: seg.sectionPath.length > 0 ? seg.sectionPath : undefined,
    });
  }

  // 문서 전체 노트는 첫 슬라이드에 붙인다(슬라이드별 ::: notes 는 향후 확장).
  if (docNotes && slides.length > 0) slides[0].notes = docNotes;

  // 슬라이드가 하나도 없으면(빈 문서) 최소 1장.
  if (slides.length === 0) {
    slides.push({ title: '', layout: 'title', body: [] });
  }
  return slides;
}
