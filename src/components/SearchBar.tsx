/**
 * Unified search + replace bar — shared by all view modes (Markdown/CodeMirror,
 * Rich Text/Tiptap). Purely presentational: it renders the UI and reports user
 * intent through callbacks; App routes those to the active engine. This keeps
 * one consistent search UX everywhere (previously CM's native panel and a
 * separate preview bar diverged completely).
 *
 * Keyboard: Enter = next, Shift+Enter = previous, Escape = close. The replace
 * row is collapsed by default and toggled with the ⇄ button.
 */

import type { RefObject } from 'react';
import { ChevronUp, ChevronDown, X, Replace } from 'lucide-react';

interface SearchBarProps {
    query: string;
    replaceValue: string;
    /** Total match count. */
    count: number;
    /** 0-based index of the current match, or -1 when none. */
    index: number;
    showReplace: boolean;
    onQueryChange: (q: string) => void;
    onReplaceChange: (r: string) => void;
    onNext: () => void;
    onPrev: () => void;
    onReplaceOne: () => void;
    onReplaceAll: () => void;
    onToggleReplace: () => void;
    onClose: () => void;
    /** Focused on open. */
    inputRef?: RefObject<HTMLInputElement | null>;
}

export function SearchBar({
    query,
    replaceValue,
    count,
    index,
    showReplace,
    onQueryChange,
    onReplaceChange,
    onNext,
    onPrev,
    onReplaceOne,
    onReplaceAll,
    onToggleReplace,
    onClose,
    inputRef,
}: SearchBarProps) {
    const hasMatches = count > 0;

    return (
        <div className="search-bar">
            <div className="search-bar-row">
                <input
                    ref={inputRef}
                    type="text"
                    className="search-input"
                    placeholder="검색…"
                    value={query}
                    onChange={(e) => onQueryChange(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Escape') { e.preventDefault(); onClose(); }
                        else if (e.key === 'Enter') {
                            e.preventDefault();
                            if (e.shiftKey) onPrev();
                            else onNext();
                        }
                    }}
                />
                {hasMatches ? (
                    <span className="search-count">{index + 1} / {count}</span>
                ) : query ? (
                    <span className="search-count search-count-empty">결과 없음</span>
                ) : null}
                <button className="search-nav-btn" onClick={onPrev} disabled={!hasMatches} title="이전 (⇧Enter)">
                    <ChevronUp size={16} strokeWidth={2} />
                </button>
                <button className="search-nav-btn" onClick={onNext} disabled={!hasMatches} title="다음 (Enter)">
                    <ChevronDown size={16} strokeWidth={2} />
                </button>
                <button
                    className={`search-nav-btn${showReplace ? ' active' : ''}`}
                    onClick={onToggleReplace}
                    title="바꾸기"
                    aria-pressed={showReplace}
                >
                    <Replace size={15} strokeWidth={2} />
                </button>
                <button className="search-close-btn" onClick={onClose} title="검색 닫기 (Esc)" aria-label="검색 닫기">
                    <X size={16} strokeWidth={2} />
                </button>
            </div>

            {showReplace && (
                <div className="search-bar-row search-replace-row">
                    <input
                        type="text"
                        className="search-input"
                        placeholder="바꿀 내용…"
                        value={replaceValue}
                        onChange={(e) => onReplaceChange(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Escape') { e.preventDefault(); onClose(); }
                            else if (e.key === 'Enter') { e.preventDefault(); onReplaceOne(); }
                        }}
                    />
                    <button className="search-replace-btn" onClick={onReplaceOne} disabled={!hasMatches}>바꾸기</button>
                    <button className="search-replace-btn" onClick={onReplaceAll} disabled={!hasMatches}>모두 바꾸기</button>
                </div>
            )}
        </div>
    );
}
