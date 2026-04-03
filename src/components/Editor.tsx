import { useCallback, useMemo, useRef, useImperativeHandle, forwardRef } from 'react';
import CodeMirror, { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { EditorView } from '@codemirror/view';
import { openSearchPanel, closeSearchPanel } from '@codemirror/search';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

interface EditorProps {
    content: string;
    onChange: (value: string) => void;
    theme: 'light' | 'dark';
    onSelectionChange?: (text: string, coords: { top: number; left: number } | null) => void;
}

export interface EditorHandle {
    openSearch: () => void;
    closeSearch: () => void;
    getSelectedText: () => string;
    scrollToLine: (line: number) => void;
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
    function Editor({ content, onChange, theme, onSelectionChange }, ref) {
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
            getSelectedText: () => {
                const view = cmRef.current?.view;
                if (!view) return '';
                const { from, to } = view.state.selection.main;
                return view.state.sliceDoc(from, to);
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
        }));

        const handleChange = useCallback((value: string) => {
            onChange(value);
        }, [onChange]);

        const extensions = useMemo(() => {
            const exts = [
                markdown({ base: markdownLanguage, codeLanguages: languages }),
                EditorView.lineWrapping,
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

            return exts;
        }, [theme, onSelectionChange]);

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
