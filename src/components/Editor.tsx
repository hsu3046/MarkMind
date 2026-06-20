import { useCallback, useMemo, useRef, useImperativeHandle, forwardRef } from 'react';
import CodeMirror, { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { search, setSearchQuery, getSearchQuery, SearchQuery, findNext, findPrevious, replaceNext, replaceAll } from '@codemirror/search';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

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
    onSelectionChange?: (text: string, coords: { top: number; left: number } | null) => void;
    /** 클립보드 이미지 붙여넣기 시 — assets/ 에 이미지 인라인 첨부(#56). */
    onImagePaste?: (file: File) => void;
    /** false 면 read-only(키 입력·문서 변경 차단). split 비활성 패인의 미러용. 기본 true. */
    editable?: boolean;
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
};

export const Editor = forwardRef<EditorHandle, EditorProps>(
    function Editor({ content, onChange, theme, onSelectionChange, onImagePaste, editable = true }, ref) {
        const cmRef = useRef<ReactCodeMirrorRef>(null);
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
                                    onSelectionChange(selectedText, {
                                        top: coords.top,
                                        left: coords.left,
                                    });
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

        return (
            <div className="editor-wrapper">
                <CodeMirror
                    ref={cmRef}
                    value={content}
                    onChange={handleChange}
                    extensions={extensions}
                    theme={theme === 'dark' ? darkTheme : lightTheme}
                    basicSetup={BASIC_SETUP}
                />
            </div>
        );
    }
);
