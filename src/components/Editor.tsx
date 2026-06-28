import { useCallback, useEffect, useMemo, useRef, useImperativeHandle, forwardRef } from 'react';
import CodeMirror, { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { EditorView, Decoration, type DecorationSet } from '@codemirror/view';
import { EditorState, StateField, StateEffect, RangeSetBuilder } from '@codemirror/state';
import { search, setSearchQuery, getSearchQuery, SearchQuery, findNext, findPrevious, replaceNext, replaceAll } from '@codemirror/search';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { quoteLines } from '../lib/quoteMatch';

/** CodeMirror search panel 한국어 phrases */
const KO_PHRASES = EditorState.phrases.of({
    'Find': '검색',
    'Replace': '바꾸기',
    'next': '다음',
    'previous': '이전',
    'all': '모두',
    'match case': '대/소문자',
    'by word': '단어 단위',
    'regexp': '정규식',
    'replace': '바꾸기',
    'replace all': '모두 바꾸기',
    'close': '닫기',
    'current match': '현재 일치',
    'replace next': '다음 바꾸기',
});

interface EditorProps {
    content: string;
    onChange: (value: string) => void;
    theme: 'light' | 'dark';
    onSelectionChange?: (text: string, coords: { top: number; left: number } | null, lineLabel?: string) => void;
    /** 클립보드 이미지 붙여넣기 시 — assets/ 에 이미지 인라인 첨부(#56). */
    onImagePaste?: (file: File) => void;
    /** false 면 read-only(키 입력·문서 변경 차단). split 비활성 패인의 미러용. 기본 true. */
    editable?: boolean;
    /** "인용" 하이라이트 — 일치 텍스트에 배경 표시(non-destructive decoration). */
    quotedTexts?: string[];
}

/** 검색 결과 요약 — 총 매치 수 + 현재 매치 0-based index(-1=없음). */
export interface SearchInfo {
    count: number;
    index: number;
}

export interface EditorHandle {
    /** 검색어 설정(+첫 매치로 이동). 전체 매치 하이라이트. */
    searchSetQuery: (query: string, replace: string) => SearchInfo;
    searchNext: () => SearchInfo;
    searchPrev: () => SearchInfo;
    /** 현재 매치를 바꾸고 다음으로. */
    searchReplaceCurrent: (replace: string) => SearchInfo;
    searchReplaceAll: (replace: string) => SearchInfo;
    /** 검색 상태/하이라이트 해제. */
    searchClear: () => void;
    scrollToLine: (line: number) => void;
    /** 현재 커서 위치에 텍스트 삽입 (이미지 첨부 `![]()` 등) */
    insertAtCursor: (text: string) => void;
    /** 드롭 좌표(client px)에 해당하는 문서 위치에 텍스트 삽입(#56). 좌표 무효면 커서 위치. */
    insertAtCoords: (text: string, clientX: number, clientY: number) => void;
    /** 외부 변경(undo/redo)된 content 를 doc 에 직접 적용 + 커서를 offset 으로(#74).
     *  react-codemirror 의 controlled value sync 가 커서를 0 으로 리셋하는 걸 우회 —
     *  우리가 먼저 doc 를 새 content 로 바꾸면 value prop==doc 이라 그 sync 가 skip 된다.
     *  (uiwjs/react-codemirror #199 / #694 알려진 이슈) */
    applyContentWithCursor: (content: string, offset: number) => void;
    /** 현재 커서의 마크다운 source offset. */
    getCursorOffset: () => number | null;
    /** 마크다운 source offset 으로 커서와 스크롤을 복원. */
    focusAtOffset: (offset: number, scroll?: boolean) => boolean;
}

const lightTheme = EditorView.theme({
    '&': {
        backgroundColor: 'var(--editor-bg)',
        color: 'var(--text-primary)',
    },
    '.cm-content': {
        caretColor: 'var(--editor-cursor)',
    },
    '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: 'var(--editor-cursor)',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
        backgroundColor: 'var(--editor-selection)',
    },
    '.cm-gutters': {
        backgroundColor: 'var(--editor-gutter)',
        color: 'var(--editor-line-number)',
        borderRight: '1px solid var(--border-secondary)',
    },
    '.cm-activeLineGutter': {
        backgroundColor: 'var(--editor-active-line)',
    },
    '.cm-activeLine': {
        backgroundColor: 'var(--editor-active-line)',
    },
}, { dark: false });

const darkTheme = EditorView.theme({
    '&': {
        backgroundColor: 'var(--editor-bg)',
        color: 'var(--text-primary)',
    },
    '.cm-content': {
        caretColor: 'var(--editor-cursor)',
    },
    '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: 'var(--editor-cursor)',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
        backgroundColor: 'var(--editor-selection)',
    },
    '.cm-gutters': {
        backgroundColor: 'var(--editor-gutter)',
        color: 'var(--editor-line-number)',
        borderRight: '1px solid var(--border-secondary)',
    },
    '.cm-activeLineGutter': {
        backgroundColor: 'var(--editor-active-line)',
    },
    '.cm-activeLine': {
        backgroundColor: 'var(--editor-active-line)',
    },
}, { dark: true });

// High-contrast dark mode syntax highlighting for Markdown
const darkHighlight = HighlightStyle.define([
    { tag: tags.heading1, color: '#FFB86C', fontWeight: 'bold', fontSize: '1.4em' },
    { tag: tags.heading2, color: '#FFB86C', fontWeight: 'bold', fontSize: '1.2em' },
    { tag: tags.heading3, color: '#FFB86C', fontWeight: 'bold', fontSize: '1.1em' },
    { tag: [tags.heading4, tags.heading5, tags.heading6], color: '#FFB86C', fontWeight: 'bold' },
    { tag: tags.strong, color: '#FF79C6', fontWeight: 'bold' },
    { tag: tags.emphasis, color: '#F1FA8C', fontStyle: 'italic' },
    { tag: tags.strikethrough, color: '#888888', textDecoration: 'line-through' },
    { tag: tags.link, color: '#8BE9FD', textDecoration: 'underline' },
    { tag: tags.url, color: '#6BAFFF' },
    { tag: tags.processingInstruction, color: '#B0B0B0' }, // # marks, ** marks, etc.
    { tag: tags.meta, color: '#B0B0B0' }, // meta characters
    { tag: tags.monospace, color: '#50FA7B' }, // inline code
    { tag: tags.quote, color: '#AAAAAA', fontStyle: 'italic' }, // blockquote >
    { tag: tags.list, color: '#FF79C6' }, // list markers - * +
    { tag: tags.contentSeparator, color: '#888888' }, // ---
    { tag: tags.labelName, color: '#8BE9FD' }, // [link text]
    { tag: tags.string, color: '#50FA7B' },
    { tag: tags.comment, color: '#6272A4' },
    { tag: tags.keyword, color: '#FF79C6' },
    { tag: tags.operator, color: '#FF79C6' },
    { tag: tags.number, color: '#BD93F9' },
    { tag: tags.bool, color: '#BD93F9' },
    { tag: tags.null, color: '#BD93F9' },
    { tag: tags.propertyName, color: '#66D9EF' },
    { tag: tags.typeName, color: '#8BE9FD' },
    { tag: tags.className, color: '#50FA7B' },
    { tag: tags.function(tags.variableName), color: '#50FA7B' },
    { tag: tags.definition(tags.variableName), color: '#FFB86C' },
]);

/** 현재 검색 쿼리의 매치 수 + 현재 선택이 몇 번째 매치인지 계산. */
function computeSearchInfo(view: EditorView): SearchInfo {
    const query = getSearchQuery(view.state);
    if (!query.search) return { count: 0, index: -1 };
    const cur = view.state.selection.main;
    let count = 0;
    let index = -1;
    try {
        const cursor = query.getCursor(view.state.doc) as Iterator<{ from: number; to: number }>;
        for (let r = cursor.next(); !r.done; r = cursor.next()) {
            if (r.value.from === cur.from && r.value.to === cur.to) index = count;
            count += 1;
        }
    } catch {
        return { count: 0, index: -1 };
    }
    return { count, index };
}

/** 안정 참조 — 인라인 객체면 매 렌더 reconfigure 돼 검색 상태가 리셋된다(과거 버그).
 *  searchKeymap=false 로 ⌘F 가 네이티브 패널을 열지 않게 함(App 이 통일 SearchBar 토글). */
const BASIC_SETUP = {
    lineNumbers: true,
    highlightActiveLineGutter: true,
    highlightActiveLine: true,
    foldGutter: true,
    autocompletion: false,
    bracketMatching: true,
    indentOnInput: true,
    searchKeymap: false,
    // history 끄기 — undo/redo 는 App 전역 content 스택으로 일원화(#74 유니버설 undo).
    history: false,
};

// "인용" 하이라이트 — 인용 텍스트와 일치하는 영역에 배경(non-destructive decoration).
const setQuoteHighlights = StateEffect.define<string[]>();
const quoteMark = Decoration.mark({ class: 'cm-quote-hl' });
const quoteHighlightField = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(deco, tr) {
        for (const e of tr.effects) {
            if (e.is(setQuoteHighlights)) {
                const texts = e.value.filter((t) => t.length > 0);
                if (texts.length === 0) return Decoration.none;
                const doc = tr.state.doc.toString();
                const found: { from: number; to: number }[] = [];
                // 줄 단위 indexOf — 여러 줄 전체 정규식은 특수문자·backtrack 에 약해 인용이 통째로 안 잡힘.
                for (const line of quoteLines(texts)) {
                    let idx = doc.indexOf(line);
                    while (idx >= 0) { found.push({ from: idx, to: idx + line.length }); idx = doc.indexOf(line, idx + line.length); }
                }
                found.sort((a, b) => a.from - b.from);
                const builder = new RangeSetBuilder<Decoration>();
                for (const r of found) builder.add(r.from, r.to, quoteMark);
                return builder.finish();
            }
        }
        return deco.map(tr.changes);
    },
    provide: (f) => EditorView.decorations.from(f),
});

export const Editor = forwardRef<EditorHandle, EditorProps>(
    function Editor({ content, onChange, theme, onSelectionChange, onImagePaste, editable = true, quotedTexts }, ref) {
        const cmRef = useRef<ReactCodeMirrorRef>(null);
        // 모드 전환으로 리마운트되면 useEffect 시점엔 view 가 아직 없어 하이라이트가 사라진다.
        // onCreateEditor(view 준비 콜백)에서 최신 quotedTexts 로 복원하려고 ref 로 들고 있는다.
        const quotedTextsRef = useRef(quotedTexts);
        quotedTextsRef.current = quotedTexts;
        // onChange via ref → handleChange 가 안정 참조라 부모 리렌더 시 reconfigure 안 됨.
        const onChangeRef = useRef(onChange);
        onChangeRef.current = onChange;

        useImperativeHandle(ref, () => ({
            searchSetQuery: (query: string, replace: string): SearchInfo => {
                const view = cmRef.current?.view;
                if (!view) return { count: 0, index: -1 };
                view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: query, replace, caseSensitive: false })) });
                if (query) findNext(view); // 입력 즉시 첫 매치로(브라우저 찾기와 동일)
                return computeSearchInfo(view);
            },
            searchNext: (): SearchInfo => {
                const view = cmRef.current?.view;
                if (!view) return { count: 0, index: -1 };
                findNext(view);
                return computeSearchInfo(view);
            },
            searchPrev: (): SearchInfo => {
                const view = cmRef.current?.view;
                if (!view) return { count: 0, index: -1 };
                findPrevious(view);
                return computeSearchInfo(view);
            },
            searchReplaceCurrent: (replace: string): SearchInfo => {
                const view = cmRef.current?.view;
                if (!view) return { count: 0, index: -1 };
                const q = getSearchQuery(view.state);
                view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: q.search, replace, caseSensitive: q.caseSensitive, regexp: q.regexp, wholeWord: q.wholeWord })) });
                replaceNext(view);
                return computeSearchInfo(view);
            },
            searchReplaceAll: (replace: string): SearchInfo => {
                const view = cmRef.current?.view;
                if (!view) return { count: 0, index: -1 };
                const q = getSearchQuery(view.state);
                view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: q.search, replace, caseSensitive: q.caseSensitive, regexp: q.regexp, wholeWord: q.wholeWord })) });
                replaceAll(view);
                return computeSearchInfo(view);
            },
            searchClear: () => {
                const view = cmRef.current?.view;
                if (view) view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: '' })) });
            },
            scrollToLine: (line: number) => {
                const view = cmRef.current?.view;
                if (!view) return;
                // line is 1-indexed
                const lineObj = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines)));
                view.dispatch({
                    selection: { anchor: lineObj.from },
                    effects: EditorView.scrollIntoView(lineObj.from, { y: 'center' }),
                });
                view.focus();
            },
            insertAtCursor: (text: string) => {
                const view = cmRef.current?.view;
                if (!view) return;
                const { from, to } = view.state.selection.main;
                view.dispatch({
                    changes: { from, to, insert: text },
                    selection: { anchor: from + text.length },
                });
                view.focus();
            },
            insertAtCoords: (text: string, clientX: number, clientY: number) => {
                const view = cmRef.current?.view;
                if (!view) return;
                // 드롭 좌표 → 문서 offset. 좌표가 텍스트 밖이면(null) 현재 커서로 fallback.
                const at = view.posAtCoords({ x: clientX, y: clientY }) ?? view.state.selection.main.head;
                view.dispatch({
                    changes: { from: at, to: at, insert: text },
                    selection: { anchor: at + text.length },
                });
                view.focus();
            },
            applyContentWithCursor: (content: string, offset: number) => {
                const view = cmRef.current?.view;
                if (!view) return;
                const pos = Math.min(Math.max(0, offset), content.length);
                view.dispatch({
                    changes: { from: 0, to: view.state.doc.length, insert: content },
                    selection: { anchor: pos },
                    effects: EditorView.scrollIntoView(pos, { y: 'center' }),
                });
                view.focus();
            },
            getCursorOffset: () => {
                const view = cmRef.current?.view;
                return view?.state.selection.main.head ?? null;
            },
            focusAtOffset: (offset: number, scroll = true) => {
                const view = cmRef.current?.view;
                if (!view) return false;
                const pos = Math.min(Math.max(0, offset), view.state.doc.length);
                view.dispatch({
                    selection: { anchor: pos },
                    effects: scroll ? EditorView.scrollIntoView(pos, { y: 'center' }) : [],
                });
                view.focus();
                return true;
            },
        }), []);

        const handleChange = useCallback((value: string) => {
            onChangeRef.current(value);
        }, []);

        const extensions = useMemo(() => {
            const exts = [
                markdown({ base: markdownLanguage, codeLanguages: languages }),
                EditorView.lineWrapping,
                KO_PHRASES,
                search(), // 검색 상태 + 전체 매치 하이라이트(패널은 안 띄움 — 통일 SearchBar 가 구동)
                // read-only(미러) — editable.of(false) 로 키 입력 막고 readOnly.of(true) 로 문서 변경 차단.
                EditorView.editable.of(editable),
                EditorState.readOnly.of(!editable),
                ...(theme === 'dark' ? [syntaxHighlighting(darkHighlight)] : []),
                quoteHighlightField,
            ];

            // Selection change listener
            if (onSelectionChange) {
                exts.push(
                    EditorView.updateListener.of((update) => {
                        if (update.selectionSet || update.docChanged) {
                            const { from, to } = update.state.selection.main;
                            const selectedText = update.state.sliceDoc(from, to);
                            if (selectedText.length > 0) {
                                const coords = update.view.coordsAtPos(from);
                                if (coords) {
                                    const sLine = update.state.doc.lineAt(from).number;
                                    const eLine = update.state.doc.lineAt(to).number;
                                    const lineLabel = sLine === eLine ? `Line ${sLine}` : `Line ${sLine}-${eLine}`;
                                    onSelectionChange(selectedText, { top: coords.top, left: coords.left }, lineLabel);
                                }
                            } else {
                                onSelectionChange('', null);
                            }
                        }
                    })
                );
            }

            // 클립보드 이미지 붙여넣기 → 이미지 인라인 첨부(#56). 이미지 item 이 있으면 기본
            // 붙여넣기를 막고 콜백으로 넘긴다(텍스트 붙여넣기는 그대로 통과).
            if (onImagePaste) {
                exts.push(
                    EditorView.domEventHandlers({
                        paste: (event) => {
                            const items = event.clipboardData?.items;
                            if (!items) return false;
                            for (let i = 0; i < items.length; i++) {
                                const it = items[i];
                                if (it.type.startsWith('image/')) {
                                    const file = it.getAsFile();
                                    if (file) {
                                        event.preventDefault();
                                        onImagePaste(file);
                                        return true;
                                    }
                                }
                            }
                            return false;
                        },
                    }),
                );
            }

            return exts;
        }, [theme, onSelectionChange, onImagePaste, editable]);

        // "인용" 하이라이트 동기화 — quotedTexts 변경 시 decoration effect dispatch.
        useEffect(() => {
            const view = cmRef.current?.view;
            if (view) view.dispatch({ effects: setQuoteHighlights.of(quotedTexts ?? []) });
        }, [quotedTexts]);

        return (
            <div className="editor-wrapper">
                <CodeMirror
                    ref={cmRef}
                    value={content}
                    onChange={handleChange}
                    extensions={extensions}
                    theme={theme === 'dark' ? darkTheme : lightTheme}
                    basicSetup={BASIC_SETUP}
                    onCreateEditor={(view) => view.dispatch({ effects: setQuoteHighlights.of(quotedTextsRef.current ?? []) })}
                />
            </div>
        );
    }
);
