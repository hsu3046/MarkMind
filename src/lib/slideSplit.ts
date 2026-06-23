// 슬라이드쇼 뷰 — 마크다운을 슬라이드 단위로 분할 (결정론 라인 스캐너).
//
// markdownToSlides.ts(PPTX용 Slide[] 구조)와 달리, 여기서는 "원본 마크다운 청크"
// (string[])를 반환한다. 각 청크는 그대로 react-markdown 으로 렌더하므로 이미지·표·
// 코드 하이라이트·체크박스 등 Preview 와 동일한 충실도를 얻는다.
//
// 분할 기준(HR/H1/H2)과 슬라이드에서 숨길 요소는 사용자가 설정으로 고른다.
// 핵심 함정: 펜스 코드블록 안의 `---`/`#` 은 경계로 보지 않는다(분할 정확성).
// frontmatter 의 `---` 도 슬라이드 내용이 아니므로 가장 먼저 제거한다.

export interface SlideshowSettings {
    // 분할 기준 — 켜진 마커를 만나면 새 슬라이드.
    splitOnHr: boolean; // 수평선(---, ***, ___)
    splitOnH1: boolean; // # 헤딩
    splitOnH2: boolean; // ## 헤딩
    // 슬라이드에서 숨길 요소(렌더 시 비표시 — 경계 감지와 무관).
    hideCodeBlock: boolean;
    hideImage: boolean;
    hideTable: boolean;
    hideBlockquote: boolean;
    hideInlineCode: boolean;
    hideStrike: boolean;
}

export const DEFAULT_SLIDESHOW_SETTINGS: SlideshowSettings = {
    splitOnHr: true,
    splitOnH1: true,
    splitOnH2: false,
    hideCodeBlock: false,
    hideImage: false,
    hideTable: false,
    hideBlockquote: false,
    hideInlineCode: false,
    hideStrike: false,
};

const STORAGE_KEY = 'markmind-slideshow-settings';

/** localStorage 에서 설정 로드 — 누락 필드는 기본값으로 보강(스키마 확장 안전). */
export function getSlideshowSettings(): SlideshowSettings {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { ...DEFAULT_SLIDESHOW_SETTINGS };
        const parsed = JSON.parse(raw) as Partial<SlideshowSettings>;
        return { ...DEFAULT_SLIDESHOW_SETTINGS, ...parsed };
    } catch {
        return { ...DEFAULT_SLIDESHOW_SETTINGS };
    }
}

export function setSlideshowSettings(s: SlideshowSettings): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {
        /* quota/사파리 프라이빗 등 — 영속 실패는 무시(런타임 설정은 유지) */
    }
}

const HR_RE = /^\s*([-*_])(?:\s*\1){2,}\s*$/; // ---, ***, ___ (3개 이상)
const HEADING_RE = /^(#{1,6})\s+/;
const FENCE_RE = /^\s*(```|~~~)/;
const IMAGE_RE = /!\[[^\]]*\]\([^)]*\)/g; // 인라인/단독 이미지
const INLINE_CODE_RE = /`[^`\n]+`/g; // 인라인 코드
const STRIKE_RE = /~~[^~\n]+~~/g; // 취소선
/** 슬라이드 수동 숨김 마커(C) — 권장 `%%skip%%`(리치텍스트 라운드트립에서 안 깨짐).
    구형 HTML 주석 `<!-- skip -->` 은 라운드트립 시 `&lt;…&gt;` 로 깨지므로 하위호환으로
    깨진 형태까지 인식한다(근본 보존은 #89 — raw HTML 라운드트립). */
const SKIP_MARKER_RE = /%%\s*skip\s*%%|(?:<|&lt;)!--\s*skip\s*--(?:>|&gt;)/i;
const SLIDE_DRAFT_MARKER_LINE_RE =
    /^\s*(?:<!--\s*markmind:slide-draft\b[^>]*-->|&lt;!--\s*markmind:slide-draft\b.*?--&gt;)\s*$/i;

function stripSlideDraftMarker(md: string): string {
    return md
        .split('\n')
        .filter((line) => !SLIDE_DRAFT_MARKER_LINE_RE.test(line))
        .join('\n');
}

/** YAML frontmatter(`---\n…\n---`) 제거 — 슬라이드 내용이 아님. */
function stripFrontmatter(md: string): string {
    const lines = md.split('\n');
    if (lines[0]?.trim() !== '---') return md;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === '---') return lines.slice(i + 1).join('\n');
    }
    return md; // 닫는 --- 없음 → frontmatter 아님
}

/** 슬라이드가 `<!-- skip -->` 마커로 수동 숨김 처리됐는지(C). */
function isSkipMarked(chunk: string): boolean {
    return SKIP_MARKER_RE.test(chunk);
}

/**
 * 숨길 요소(코드블록/이미지/표/인용)를 텍스트상 제거한 뒤 표시할 내용(헤딩·본문)이
 * 남지 않으면 빈 슬라이드로 본다(A). 예: 코드블록만 있던 슬라이드 + hideCodeBlock → 빈.
 * 헤딩만 남으면 제목 슬라이드로 보고 유지한다(빈 아님).
 */
function isEmptyAfterHide(chunk: string, opts: SlideshowSettings): boolean {
    const lines = chunk.split('\n');
    const kept: string[] = [];
    let inFence = false;
    let marker = '';
    for (const line of lines) {
        const f = line.match(FENCE_RE);
        if (f) {
            if (!inFence) {
                inFence = true;
                marker = f[1];
            } else if (line.trimStart().startsWith(marker)) {
                inFence = false;
            }
            if (!opts.hideCodeBlock) kept.push(line);
            continue;
        }
        if (inFence) {
            if (!opts.hideCodeBlock) kept.push(line);
            continue;
        }
        if (opts.hideBlockquote && /^\s*>/.test(line)) continue;
        if (opts.hideTable && /^\s*\|/.test(line)) continue;
        let l = line;
        if (opts.hideImage) l = l.replace(IMAGE_RE, '');
        if (opts.hideInlineCode) l = l.replace(INLINE_CODE_RE, '');
        if (opts.hideStrike) l = l.replace(STRIKE_RE, '');
        kept.push(l);
    }
    // 공백·수평선·skip마커 외의 내용이 하나라도 남으면 빈 아님.
    return !kept.some((l) => {
        const t = l.trim();
        return t !== '' && !HR_RE.test(l) && !SKIP_MARKER_RE.test(t);
    });
}

/**
 * 마크다운 문자열 → 슬라이드별 마크다운 청크[].
 * 펜스 코드블록 안은 경계 무시, 켜진 마커(HR/H1/H2)에서 분할.
 * - HR(`---`)은 구분선이라 슬라이드 내용에서 제외한다.
 * - 헤딩(H1/H2)은 새 슬라이드의 첫 줄로 포함한다.
 * 빈(공백만) 슬라이드는 버린다. 결과가 없으면 빈 1장(['']).
 */
export function splitIntoSlides(markdown: string, opts: SlideshowSettings): string[] {
    const lines = stripFrontmatter(stripSlideDraftMarker(markdown)).split('\n');
    const slides: string[][] = [];
    let cur: string[] = [];
    let inFence = false;
    let fenceMarker = '';

    const pushCur = () => {
        if (cur.some((l) => l.trim() !== '')) slides.push(cur);
        cur = [];
    };

    for (const line of lines) {
        const fence = line.match(FENCE_RE);
        if (fence) {
            if (!inFence) {
                inFence = true;
                fenceMarker = fence[1];
            } else if (line.trimStart().startsWith(fenceMarker)) {
                inFence = false;
            }
            cur.push(line);
            continue;
        }
        if (inFence) {
            cur.push(line);
            continue;
        }

        // 경계 감지 (펜스 밖)
        if (opts.splitOnHr && HR_RE.test(line)) {
            pushCur(); // 구분선 자체는 슬라이드에 넣지 않음
            continue;
        }
        const h = line.match(HEADING_RE);
        if (h) {
            const level = h[1].length;
            if ((opts.splitOnH1 && level === 1) || (opts.splitOnH2 && level === 2)) {
                pushCur();
                cur.push(line); // 헤딩은 새 슬라이드의 제목으로 포함
                continue;
            }
        }
        cur.push(line);
    }
    pushCur();

    if (slides.length === 0) return [''];
    // 양끝 빈 줄만 제거(코드블록 내부 들여쓰기는 보존).
    const chunks = slides.map((s) => s.join('\n').replace(/^\n+|\n+$/g, ''));
    // C: skip 마커 슬라이드 제외 / A: 숨길 요소 적용 후 빈 슬라이드 제외.
    const visible = chunks.filter((c) => !isSkipMarked(c) && !isEmptyAfterHide(c, opts));
    return visible.length > 0 ? visible : [''];
}
