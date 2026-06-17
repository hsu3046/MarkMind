import { useCallback, useMemo, useRef, useImperativeHandle, forwardRef } from 'react';
import CodeMirror, { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { openSearchPanel, closeSearchPanel } from '@codemirror/search';
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
}

export interface EditorHandle {
    openSearch: () => void;
    closeSearch: () => void;
    /** 검색 panel 토글 — 열려있으면 닫고, 닫혀있으면 엶 */
    toggleSearch: () => void;
    isSearchOpen: () => boolean;
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

export const Editor = forwardRef<EditorHandle, EditorProps>(
    function Editor({ content, onChange, theme, onSelectionChange, onImagePaste }, ref) {
        const cmRef = useRef<ReactCodeMirrorRef>(null);

        useImperativeHandle(ref, () => ({
            openSearch: () => {
                const view = cmRef.current?.view;
                if (view) {
                    openSearchPanel(view);
                }
            },
            closeSearch: () => {
                const view = cmRef.current?.view;
                if (view) {
                    closeSearchPanel(view);
                }
            },
            toggleSearch: () => {
                const view = cmRef.current?.view;
                if (!view) return;
                const panel = view.dom.querySelector('.cm-search.cm-panel');
                if (panel) {
                    closeSearchPanel(view);
                } else {
                    openSearchPanel(view);
                }
            },
            isSearchOpen: () => {
                const view = cmRef.current?.view;
                if (!view) return false;
                return !!view.dom.querySelector('.cm-search.cm-panel');
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
        }));

        const handleChange = useCallback((value: string) => {
            onChange(value);
        }, [onChange]);

        const extensions = useMemo(() => {
            const exts = [
                markdown({ base: markdownLanguage, codeLanguages: languages }),
                EditorView.lineWrapping,
                KO_PHRASES,
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
        }, [theme, onSelectionChange, onImagePaste]);

        return (
            <div className="editor-wrapper">
                <CodeMirror
                    ref={cmRef}
                    value={content}
                    onChange={handleChange}
                    extensions={extensions}
                    theme={theme === 'dark' ? darkTheme : lightTheme}
                    basicSetup={{
                        lineNumbers: true,
                        highlightActiveLineGutter: true,
                        highlightActiveLine: true,
                        foldGutter: true,
                        autocompletion: false,
                        bracketMatching: true,
                        indentOnInput: true,
                        searchKeymap: true,
                    }}
                />
            </div>
        );
    }
);
