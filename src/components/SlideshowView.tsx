// 슬라이드쇼 뷰 — 마크다운을 전체화면에서 한 장씩 보여주는 발표 모드.
//
// 분할은 slideSplit.splitIntoSlides 가 담당(설정 기반 HR/H1/H2). 각 슬라이드는
// 원본 마크다운 청크를 react-markdown 으로 read-only 렌더(Preview 와 동일 충실도).
// 전환은 cross-fade — 모든 슬라이드를 absolute 로 겹쳐 두고 active 만 opacity 1,
// 나머지 0 + transition 으로 동시에 fade in/out 한다(이전 fade-out ↔ 새 fade-in).
//
// document.body 로 portal — App 의 transform/배경 등 어떤 조상 CSS 도 영향 없게.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight, AArrowDown, AArrowUp, Moon, Sun, Frame } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import rehypeHighlight from 'rehype-highlight';
import { resolveImageSrc } from '../lib/imageSrc';
import { fixEmphasis } from '../lib/markdownDisplay';
import { remarkSoftBreaks } from '../lib/remarkSoftBreaks';
import { splitIntoSlides, type SlideshowSettings } from '../lib/slideSplit';
import './SlideshowView.css';

interface SlideshowViewProps {
    content: string;
    /** 문서 경로 — 로컬 이미지 상대경로 해석 기준(미저장이면 null). */
    filePath: string | null;
    settings: SlideshowSettings;
    /** 본문 폰트(고딕/명조) — App 뷰어 설정과 통일. */
    fontFamily: 'sans' | 'serif';
    /** 사용자 지정 배경색(빈 문자열이면 테마 기본). */
    bgColor: string;
    onClose: () => void;
}

const ATX_HEADING_LINE_RE = /^\s{0,3}(#{1,6})\s*(.*?)\s*#*\s*$/;
const MIN_AUTO_FIT_SCALE = 0.72;
const OVERFLOW_EPSILON_PX = 12;
const AUTO_FIT_MARGIN = 0.96;

function plainMarkdownText(text: string): string {
    return text
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/[`*_~]/g, '')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function getSlideHeadingInfo(md: string, index: number): { title: string; level: number; fallback: boolean } {
    const lines = md.split('\n');
    for (const line of lines) {
        if (!line.trim()) continue;
        const heading = line.match(ATX_HEADING_LINE_RE);
        if (heading) {
            return {
                title: plainMarkdownText(heading[2]) || `슬라이드 ${index + 1}`,
                level: heading[1].length,
                fallback: false,
            };
        }
        const fallbackTitle = plainMarkdownText(line);
        if (fallbackTitle) {
            return {
                title: fallbackTitle.length > 72 ? `${fallbackTitle.slice(0, 72)}...` : fallbackTitle,
                level: 0,
                fallback: true,
            };
        }
    }
    return { title: `슬라이드 ${index + 1}`, level: 0, fallback: true };
}

function MarkdownChunk({ md, docDir }: { md: string; docDir: string | null }) {
    const displayMd = useMemo(() => fixEmphasis(md), [md]);
    if (!md.trim()) return null;
    return (
        <ReactMarkdown
            remarkPlugins={[remarkFrontmatter, [remarkGfm, { singleTilde: false }], remarkSoftBreaks]}
            rehypePlugins={[rehypeHighlight]}
            components={{
                img: ({ node: _node, src, ...props }) => (
                    <img {...props} src={resolveImageSrc(src ?? '', docDir)} />
                ),
            }}
        >
            {displayMd}
        </ReactMarkdown>
    );
}

/** 슬라이드 1장 — read-only 마크다운 렌더(Preview 의 플러그인/이미지 resolver 동일). */
function SlideMarkdown({ md, docDir }: { md: string; docDir: string | null }) {
    return <MarkdownChunk md={md} docDir={docDir} />;
}

function nextAutoFitScale(currentScale: number, scrollHeight: number, clientHeight: number): number {
    const ratio = Math.max(0.1, clientHeight / scrollHeight);
    return Math.max(MIN_AUTO_FIT_SCALE, Math.floor(currentScale * ratio * AUTO_FIT_MARGIN * 100) / 100);
}

export function SlideshowView({
    content,
    filePath,
    settings,
    fontFamily,
    bgColor,
    onClose,
}: SlideshowViewProps) {
    const slides = useMemo(() => splitIntoSlides(content, settings), [content, settings]);
    const slideHeadings = useMemo(
        () => slides.map((slide, index) => getSlideHeadingInfo(slide, index)),
        [slides],
    );
    const docDir = useMemo(
        () => (filePath ? filePath.slice(0, filePath.lastIndexOf('/')) : null),
        [filePath],
    );
    const [current, setCurrent] = useState(0);
    const [resizeTick, setResizeTick] = useState(0);
    const slideRefs = useRef<Array<HTMLDivElement | null>>([]);
    const jumpItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const [autoColumnSlides, setAutoColumnSlides] = useState<Record<number, { key: string; isLong: boolean }>>({});
    const [autoFitSlides, setAutoFitSlides] = useState<Record<number, { key: string; scale: number }>>({});
    const [jumpOpen, setJumpOpen] = useState(false);

    // 폰트 배율(전체 확대/축소) — 0.6~2.0, localStorage 영속.
    const [scale, setScale] = useState(() => {
        const v = parseFloat(localStorage.getItem('markmind-slideshow-font-scale') || '');
        return v >= 0.6 && v <= 2 ? v : 1;
    });
    useEffect(() => {
        localStorage.setItem('markmind-slideshow-font-scale', String(scale));
    }, [scale]);
    const adjustScale = useCallback((d: number) => {
        setScale((s) => Math.round(Math.max(0.6, Math.min(2, s + d)) * 10) / 10);
    }, []);

    // 여백 3단계: 0 작게 / 1 표준 / 2 크게 (상하·좌우 함께) — 클릭 시 순환. localStorage 영속.
    const [padLevel, setPadLevel] = useState(() => {
        const v = parseInt(localStorage.getItem('markmind-slideshow-pad') || '', 10);
        return v >= 0 && v <= 2 ? v : 1;
    });
    useEffect(() => { localStorage.setItem('markmind-slideshow-pad', String(padLevel)); }, [padLevel]);
    const cyclePad = useCallback(() => setPadLevel((p) => (p + 1) % 3), []);

    const autoColumnKey = useMemo(
        () => [scale, padLevel, settings.autoTwoColumn ? 1 : 0, resizeTick, slides.join('\u0000')].join('|'),
        [padLevel, resizeTick, scale, settings.autoTwoColumn, slides],
    );

    const measureCurrentSlide = useCallback(() => {
        if (!settings.autoTwoColumn) return;
        const slide = slideRefs.current[current];
        if (!slide) return;
        const isLong = slide.scrollHeight > slide.clientHeight + 24;
        const isAutoColumn = autoColumnSlides[current]?.key === autoColumnKey && autoColumnSlides[current]?.isLong;
        setAutoColumnSlides((prev) => {
            const existing = prev[current];
            if (existing?.key === autoColumnKey && existing.isLong) return prev;
            if (existing?.key === autoColumnKey && existing.isLong === isLong) return prev;
            return { ...prev, [current]: { key: autoColumnKey, isLong } };
        });

        if (!isAutoColumn) return;
        if (slide.scrollHeight <= slide.clientHeight + OVERFLOW_EPSILON_PX) return;
        const currentAutoScale = autoFitSlides[current]?.key === autoColumnKey ? autoFitSlides[current].scale : 1;
        const nextScale = nextAutoFitScale(currentAutoScale, slide.scrollHeight, slide.clientHeight);
        setAutoFitSlides((prev) => {
            const existing = prev[current];
            if (nextScale >= currentAutoScale) return prev;
            if (existing?.key === autoColumnKey && existing.scale === nextScale) return prev;
            return { ...prev, [current]: { key: autoColumnKey, scale: nextScale } };
        });
    }, [autoColumnKey, autoColumnSlides, autoFitSlides, current, settings.autoTwoColumn]);

    useEffect(() => {
        const onResize = () => setResizeTick((tick) => tick + 1);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    useLayoutEffect(() => {
        if (!settings.autoTwoColumn) return;
        let frame = 0;
        let timeout = 0;
        measureCurrentSlide();
        frame = requestAnimationFrame(() => {
            measureCurrentSlide();
            timeout = window.setTimeout(measureCurrentSlide, 180);
        });
        return () => {
            cancelAnimationFrame(frame);
            window.clearTimeout(timeout);
        };
    }, [autoColumnKey, current, measureCurrentSlide, resizeTick, scale, padLevel, slides, settings.autoTwoColumn]);

    // 다크 모드(발표 배경 반전) — localStorage 영속.
    const [dark, setDark] = useState(() => localStorage.getItem('markmind-slideshow-dark') === '1');
    useEffect(() => { localStorage.setItem('markmind-slideshow-dark', dark ? '1' : '0'); }, [dark]);

    // 컨트롤 노출 — 마우스가 상단/좌우 가장자리 근처일 때만. 투명 hover zone 을 stage 위에 두면
    // 슬라이드 스크롤·스크롤바·링크 클릭을 가로채므로(Codex P2), 좌표로 감지해 이벤트를 안 막는다.
    const [edge, setEdge] = useState({ top: false, left: false, right: false });
    const onEdgeMove = useCallback((e: React.MouseEvent) => {
        const top = e.clientY < 84;
        const left = e.clientX < 120;
        const right = e.clientX > window.innerWidth - 120;
        setEdge((p) => (p.top === top && p.left === left && p.right === right ? p : { top, left, right }));
    }, []);

    // 설정/내용 변경으로 슬라이드 수가 줄면 current 가 범위를 벗어날 수 있어 보정.
    useEffect(() => {
        setCurrent((c) => Math.min(c, Math.max(0, slides.length - 1)));
    }, [slides.length]);

    useEffect(() => {
        if (!jumpOpen) return;
        const frame = requestAnimationFrame(() => {
            jumpItemRefs.current[current]?.scrollIntoView({ block: 'nearest' });
        });
        return () => cancelAnimationFrame(frame);
    }, [current, jumpOpen]);

    const go = useCallback(
        (delta: number) => {
            setJumpOpen(false);
            setCurrent((c) => Math.max(0, Math.min(slides.length - 1, c + delta)));
        },
        [slides.length],
    );

    const jumpToIndex = useCallback((index: number) => {
        const next = Math.max(0, Math.min(slides.length - 1, index));
        setCurrent(next);
        setJumpOpen(false);
    }, [slides.length]);

    // 키보드 네비 — 화살표/Space/PageUp·Down/Home·End/Esc.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const target = e.target;
            const isEditing = target instanceof HTMLElement
                && (target.tagName === 'INPUT'
                    || target.tagName === 'TEXTAREA'
                    || target.tagName === 'SELECT'
                    || target.isContentEditable);
            if (isEditing) {
                if (e.key === 'Escape' && jumpOpen) {
                    e.preventDefault();
                    setJumpOpen(false);
                }
                return;
            }

            switch (e.key) {
                case 'ArrowRight':
                case 'ArrowDown':
                case 'PageDown':
                case ' ':
                    e.preventDefault();
                    go(1);
                    break;
                case 'ArrowLeft':
                case 'ArrowUp':
                case 'PageUp':
                    e.preventDefault();
                    go(-1);
                    break;
                case 'Home':
                    e.preventDefault();
                    setCurrent(0);
                    break;
                case 'End':
                    e.preventDefault();
                    setCurrent(slides.length - 1);
                    break;
                case 'Escape':
                    e.preventDefault();
                    if (jumpOpen) {
                        setJumpOpen(false);
                    } else {
                        onClose();
                    }
                    break;
                case '+':
                case '=':
                    e.preventDefault();
                    adjustScale(0.1);
                    break;
                case '-':
                case '_':
                    e.preventDefault();
                    adjustScale(-0.1);
                    break;
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [go, jumpOpen, onClose, slides.length, adjustScale]);

    // 숨길 요소 → CSS 클래스(컨테이너에 부여, display:none 으로 비표시).
    const hideClasses = [
        settings.hideCodeBlock && 'hide-code',
        settings.hideImage && 'hide-image',
        settings.hideTable && 'hide-table',
        settings.hideBlockquote && 'hide-blockquote',
        settings.hideInlineCode && 'hide-inline-code',
        settings.hideStrike && 'hide-strike',
    ]
        .filter(Boolean)
        .join(' ');

    return createPortal(
        <div
            className="slideshow-root"
            data-font-family={fontFamily}
            data-pad={['small', 'normal', 'large'][padLevel]}
            // 다크 토글 ON 일 때만 dark 강제. OFF 는 속성 생략 → App 의 테마(html data-theme,
            // bgColor luminance 반영)를 상속. light 를 강제하면 다크 bg 에 다크 텍스트로 안 보임(Codex P2).
            // custom-bg 는 부여 안 함(반투명 규칙이 Preview 와 달라짐).
            data-theme={dark ? 'dark' : undefined}
            data-near-top={edge.top ? '' : undefined}
            data-near-left={edge.left ? '' : undefined}
            data-near-right={edge.right ? '' : undefined}
            onMouseMove={onEdgeMove}
            onMouseLeave={() => setEdge({ top: false, left: false, right: false })}
            role="dialog"
            aria-modal="true"
            aria-label="슬라이드쇼"
            style={{
                '--slideshow-scale': String(scale),
                // 라이트만 사용자 bg. 다크는 --preview-bg(#222) 가 배경 처리.
                ...(bgColor && !dark ? { '--slideshow-bg': bgColor } : {}),
            } as React.CSSProperties}
        >
            <div className="slideshow-stage">
                {slides.map((md, i) => {
                    const usesAutoColumns = settings.autoTwoColumn
                        && autoColumnSlides[i]?.key === autoColumnKey
                        && autoColumnSlides[i]?.isLong;
                    const autoFitScale = autoFitSlides[i]?.key === autoColumnKey
                        ? autoFitSlides[i].scale
                        : 1;
                    const contentStyle = autoFitScale < 1
                        ? { '--slideshow-auto-scale': String(autoFitScale) } as React.CSSProperties
                        : undefined;

                    return (
                        <div
                            key={i}
                            className={`slideshow-slide${i === current ? ' active' : ''}`}
                            ref={(el) => { slideRefs.current[i] = el; }}
                            aria-hidden={i !== current}
                        >
                            <div
                                className={`slideshow-content markdown-body ${hideClasses}${usesAutoColumns ? ' auto-columns' : ''}`}
                                style={contentStyle}
                                onLoadCapture={i === current ? measureCurrentSlide : undefined}
                            >
                                <SlideMarkdown md={md} docDir={docDir} />
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="slideshow-fontctl">
                <button onClick={() => setDark((d) => !d)} title={dark ? '라이트 모드' : '다크 모드'} aria-label="다크 모드 토글">
                    {dark ? <Sun size={18} strokeWidth={1.75} /> : <Moon size={18} strokeWidth={1.75} />}
                </button>
                <button onClick={cyclePad} title={`여백: ${['작게', '표준', '크게'][padLevel]} (클릭하여 변경)`} aria-label="여백 조절">
                    <Frame size={18} strokeWidth={1.75} />
                </button>
                <button onClick={() => adjustScale(-0.1)} title="글자 작게 (−)" aria-label="글자 작게">
                    <AArrowDown size={18} strokeWidth={1.75} />
                </button>
                <button onClick={() => adjustScale(0.1)} title="글자 크게 (+)" aria-label="글자 크게">
                    <AArrowUp size={18} strokeWidth={1.75} />
                </button>
            </div>

            <button className="slideshow-close" onClick={onClose} title="닫기 (Esc)" aria-label="닫기">
                <X size={20} strokeWidth={1.75} />
            </button>

            <button
                className="slideshow-nav prev"
                onClick={() => go(-1)}
                disabled={current === 0}
                title="이전 (←)"
                aria-label="이전 슬라이드"
            >
                <ChevronLeft size={28} strokeWidth={1.5} />
            </button>
            <button
                className="slideshow-nav next"
                onClick={() => go(1)}
                disabled={current >= slides.length - 1}
                title="다음 (→)"
                aria-label="다음 슬라이드"
            >
                <ChevronRight size={28} strokeWidth={1.5} />
            </button>

            {jumpOpen && (
                <nav
                    className="slideshow-jump"
                    aria-label="슬라이드 목차"
                >
                    <div className="slideshow-jump-list" aria-label="슬라이드 목록">
                        {slideHeadings.map((item, index) => (
                            <button
                                key={`${index}-${item.title}`}
                                type="button"
                                className={`slideshow-jump-item${index === current ? ' active' : ''}${item.fallback ? ' fallback' : ''}`}
                                style={{ '--slide-heading-indent': `${Math.min(Math.max(0, item.level - 1), 3) * 0.55}rem` } as React.CSSProperties}
                                ref={(el) => { jumpItemRefs.current[index] = el; }}
                                onClick={() => jumpToIndex(index)}
                                aria-current={index === current ? 'page' : undefined}
                            >
                                <span className="slideshow-jump-item-index">{index + 1}</span>
                                <span className="slideshow-jump-item-title">{item.title}</span>
                            </button>
                        ))}
                    </div>
                </nav>
            )}

            <button
                type="button"
                className="slideshow-indicator"
                onClick={() => setJumpOpen((open) => !open)}
                title="슬라이드 이동"
                aria-label={`슬라이드 이동, 현재 ${current + 1} / ${slides.length}`}
            >
                {current + 1} / {slides.length}
            </button>
        </div>,
        document.body,
    );
}
