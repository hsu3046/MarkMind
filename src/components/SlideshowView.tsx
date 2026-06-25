// 슬라이드쇼 뷰 — 마크다운을 전체화면에서 한 장씩 보여주는 발표 모드.
//
// 분할은 slideSplit.splitIntoSlides 가 담당(설정 기반 HR/H1/H2). 각 슬라이드는
// 원본 마크다운 청크를 react-markdown 으로 read-only 렌더(Preview 와 동일 충실도).
// 전환은 cross-fade — 모든 슬라이드를 absolute 로 겹쳐 두고 active 만 opacity 1,
// 나머지 0 + transition 으로 동시에 fade in/out 한다(이전 fade-out ↔ 새 fade-in).
//
// document.body 로 portal — App 의 transform/배경 등 어떤 조상 CSS 도 영향 없게.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight, AArrowDown, AArrowUp, Moon, Sun, Frame } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import rehypeHighlight from 'rehype-highlight';
import { resolveImageSrc } from '../lib/imageSrc';
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

/** 슬라이드 1장 — read-only 마크다운 렌더(Preview 의 플러그인/이미지 resolver 동일). */
function SlideMarkdown({ md, docDir }: { md: string; docDir: string | null }) {
    return (
        <ReactMarkdown
            remarkPlugins={[remarkFrontmatter, [remarkGfm, { singleTilde: false }]]}
            rehypePlugins={[rehypeHighlight]}
            components={{
                img: ({ node: _node, src, ...props }) => (
                    <img {...props} src={resolveImageSrc(src ?? '', docDir)} />
                ),
            }}
        >
            {md}
        </ReactMarkdown>
    );
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
    const docDir = useMemo(
        () => (filePath ? filePath.slice(0, filePath.lastIndexOf('/')) : null),
        [filePath],
    );
    const [current, setCurrent] = useState(0);

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

    // 다크 모드(발표 배경 반전) — localStorage 영속.
    const [dark, setDark] = useState(() => localStorage.getItem('markmind-slideshow-dark') === '1');
    useEffect(() => { localStorage.setItem('markmind-slideshow-dark', dark ? '1' : '0'); }, [dark]);

    // 설정/내용 변경으로 슬라이드 수가 줄면 current 가 범위를 벗어날 수 있어 보정.
    useEffect(() => {
        setCurrent((c) => Math.min(c, Math.max(0, slides.length - 1)));
    }, [slides.length]);

    const go = useCallback(
        (delta: number) => {
            setCurrent((c) => Math.max(0, Math.min(slides.length - 1, c + delta)));
        },
        [slides.length],
    );

    // 키보드 네비 — 화살표/Space/PageUp·Down/Home·End/Esc.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
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
                    onClose();
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
    }, [go, onClose, slides.length, adjustScale]);

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
                {slides.map((md, i) => (
                    <div
                        key={i}
                        className={`slideshow-slide${i === current ? ' active' : ''}`}
                        aria-hidden={i !== current}
                    >
                        <div className={`slideshow-content markdown-body ${hideClasses}`}>
                            <SlideMarkdown md={md} docDir={docDir} />
                        </div>
                    </div>
                ))}
            </div>

            {/* 컨트롤 hover zone — 상단/좌/우 가장자리에 마우스 올릴 때만 컨트롤 노출(평소 숨김) */}
            <div className="slideshow-hover top" aria-hidden="true" />
            <div className="slideshow-hover left" aria-hidden="true" />
            <div className="slideshow-hover right" aria-hidden="true" />

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

            <div className="slideshow-indicator">
                {current + 1} / {slides.length}
            </div>
        </div>,
        document.body,
    );
}
