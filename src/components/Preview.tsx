import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import rehypeHighlight from 'rehype-highlight';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { Link } from '@tiptap/extension-link';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { Markdown } from 'tiptap-markdown';
import { SearchAndReplace } from '@sereneinserenade/tiptap-search-and-replace';
import { Typography } from '@tiptap/extension-typography';
import {
    Bold, Italic, Strikethrough, Code,
    Heading1, Heading2, Heading3, Heading4,
    List, ListOrdered, ListChecks,
    Quote, Code2, Link as LinkIcon, Table as TableIcon,
    Undo2, Redo2, Minus,
    IndentIncrease, IndentDecrease,
} from 'lucide-react';

interface PreviewProps {
    content: string;
    fontSize?: number;
    /** 편집 모드 활성화 — undefined 면 read-only 만 (기본). 제공 시 토글 표시. */
    onChange?: (markdown: string) => void;
}

// CommonMark 의 emphasis right-flanking 규칙 때문에 닫는 `**` 다음에
// 비공백/비구두점 글자 (CJK 포함) 가 바로 붙으면 bold 인식 실패.
// 닫는 `**` 직후에 zero-width space (U+200B) 1개 삽입해 강제 분리.
// 표시는 동일, 직렬화 (save) 시점에 stripDisplayHelpers 로 제거.
//
// 예: `**bold**한글`, `**ipsum**dolor` 모두 처리.
function fixEmphasis(md: string): string {
    return md.replace(/(\S)(\*{1,2})(?=[^\s*\p{P}])/gu, '$1$2​');
}

/** save 시점에 fixEmphasis 가 삽입한 zero-width 제거 */
function stripDisplayHelpers(md: string): string {
    return md.replace(/​/g, '');
}

interface FrontmatterParts {
    fields: { key: string; value: string }[];
    body: string;
    rawFrontmatter: string; // 편집 시 그대로 다시 붙이기 위해
}

function splitFrontmatter(md: string): FrontmatterParts {
    if (!md.startsWith('---')) return { fields: [], body: md, rawFrontmatter: '' };
    const after = md.slice(3);
    const endIdx = after.indexOf('\n---');
    if (endIdx === -1) return { fields: [], body: md, rawFrontmatter: '' };
    const raw = after.slice(0, endIdx).trim();
    const body = after.slice(endIdx + 4).replace(/^\r?\n/, '');
    const rawFrontmatter = `---\n${raw}\n---\n`;

    const fields: { key: string; value: string }[] = [];
    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const colonIdx = trimmed.indexOf(':');
        if (colonIdx === -1) continue;
        const key = trimmed.slice(0, colonIdx).trim();
        let value = trimmed.slice(colonIdx + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        fields.push({ key, value });
    }
    return { fields, body, rawFrontmatter };
}

// ─── 읽기 전용 마크다운 렌더 (기존 react-markdown 흐름) ───
function ReadOnlyView({
    fields,
    body,
    fontSize,
}: {
    fields: { key: string; value: string }[];
    body: string;
    fontSize: number;
}) {
    return (
        <div
            className="markdown-body fade-in"
            style={{ fontSize: `${fontSize}px` }}
        >
            {fields.length > 0 && (
                <aside className="markdown-frontmatter">
                    <dl>
                        {fields.map((f) => (
                            <div key={f.key} className="markdown-frontmatter-row">
                                <dt>{f.key}</dt>
                                <dd>{f.value}</dd>
                            </div>
                        ))}
                    </dl>
                </aside>
            )}
            <ReactMarkdown
                remarkPlugins={[
                    remarkFrontmatter,
                    [remarkGfm, { singleTilde: false }],
                ]}
                rehypePlugins={[rehypeHighlight]}
            >
                {body}
            </ReactMarkdown>
        </div>
    );
}

// ─── 링크 입력 모달 (Tauri WKWebView 가 prompt() 불안정해서 커스텀) ───
function LinkModal({
    initial,
    onApply,
    onClose,
}: {
    initial: string;
    onApply: (url: string) => void;
    onClose: () => void;
}) {
    const [value, setValue] = useState(initial);
    return createPortal(
        <div className="link-modal-root" role="dialog" aria-modal="true">
            <div className="link-modal-backdrop" onClick={onClose} aria-hidden />
            <div className="link-modal">
                <div className="link-modal-title">링크 URL</div>
                <input
                    type="text"
                    autoFocus
                    value={value}
                    placeholder="https://example.com"
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            onApply(value);
                        } else if (e.key === 'Escape') {
                            onClose();
                        }
                    }}
                />
                <div className="link-modal-actions">
                    {initial && (
                        <button
                            className="danger"
                            onClick={() => onApply('')}
                            title="이 위치의 링크 제거"
                        >
                            링크 삭제
                        </button>
                    )}
                    <button onClick={onClose}>취소</button>
                    <button className="primary" onClick={() => onApply(value)}>
                        적용
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
}

// ─── 편집 toolbar ───
interface ToolBtnProps {
    onClick: () => void;
    icon: React.ReactNode;
    title: string;
    active?: boolean;
    disabled?: boolean;
}
function ToolBtn({ onClick, icon, title, active, disabled }: ToolBtnProps) {
    return (
        <button
            type="button"
            className={`rich-tool-btn${active ? ' active' : ''}`}
            onMouseDown={(e) => e.preventDefault()} // focus 유지
            onClick={onClick}
            title={title}
            disabled={disabled}
        >
            {icon}
        </button>
    );
}

function RichToolbar({ editor }: { editor: Editor }) {
    // editor state 변경 (selection, marks) 시 toolbar 가 갱신되도록 강제 리렌더
    const [, setTick] = useState(0);
    const [linkModal, setLinkModal] = useState<{ value: string } | null>(null);
    useEffect(() => {
        const handler = () => setTick((t) => t + 1);
        editor.on('selectionUpdate', handler);
        editor.on('transaction', handler);
        return () => {
            editor.off('selectionUpdate', handler);
            editor.off('transaction', handler);
        };
    }, [editor]);

    /** 현재 위치의 list 타입에 맞게 sink (들여쓰기) / lift (내어쓰기).
     *  실제 동작 가능 여부는 editor.can() 으로 — 이미 최상위면 lift 불가, 부모 없으면 sink 불가. */
    const isTask = editor.isActive('taskList') || editor.isActive('taskItem');
    const itemType = isTask ? 'taskItem' : 'listItem';
    const canSink = editor.can().sinkListItem(itemType);
    const canLift = editor.can().liftListItem(itemType);
    const indent = () => {
        if (canSink) editor.chain().focus().sinkListItem(itemType).run();
    };
    const outdent = () => {
        if (canLift) editor.chain().focus().liftListItem(itemType).run();
    };

    const openLinkModal = () => {
        const prev = (editor.getAttributes('link').href as string | undefined) ?? '';
        setLinkModal({ value: prev });
    };

    // ⌘K → 링크 모달 (editor focus 안에서만 동작)
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (!(e.metaKey || e.ctrlKey)) return;
            if (e.key !== 'k' && e.key !== 'K') return;
            if (!editor.isFocused) return;
            e.preventDefault();
            openLinkModal();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [editor]);
    const applyLink = (url: string) => {
        const trimmed = url.trim();
        if (trimmed === '') {
            editor.chain().focus().extendMarkRange('link').unsetLink().run();
        } else {
            editor.chain().focus().extendMarkRange('link').setLink({ href: trimmed }).run();
        }
        setLinkModal(null);
    };

    return (
        <div className="rich-toolbar">
            <ToolBtn
                onClick={() => editor.chain().focus().undo().run()}
                disabled={!editor.can().undo()}
                icon={<Undo2 size={14} />}
                title="Undo (⌘Z)"
            />
            <ToolBtn
                onClick={() => editor.chain().focus().redo().run()}
                disabled={!editor.can().redo()}
                icon={<Redo2 size={14} />}
                title="Redo (⌘⇧Z)"
            />
            <span className="rich-tool-divider" />
            <ToolBtn
                onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
                active={editor.isActive('heading', { level: 1 })}
                icon={<Heading1 size={14} />}
                title="Heading 1 (⌘⌥1)"
            />
            <ToolBtn
                onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                active={editor.isActive('heading', { level: 2 })}
                icon={<Heading2 size={14} />}
                title="Heading 2 (⌘⌥2)"
            />
            <ToolBtn
                onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
                active={editor.isActive('heading', { level: 3 })}
                icon={<Heading3 size={14} />}
                title="Heading 3 (⌘⌥3)"
            />
            <ToolBtn
                onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}
                active={editor.isActive('heading', { level: 4 })}
                icon={<Heading4 size={14} />}
                title="Heading 4 (⌘⌥4)"
            />
            <span className="rich-tool-divider" />
            <ToolBtn
                onClick={() => editor.chain().focus().toggleBold().run()}
                active={editor.isActive('bold')}
                icon={<Bold size={14} />}
                title="Bold (⌘B)"
            />
            <ToolBtn
                onClick={() => editor.chain().focus().toggleItalic().run()}
                active={editor.isActive('italic')}
                icon={<Italic size={14} />}
                title="Italic (⌘I)"
            />
            <ToolBtn
                onClick={() => editor.chain().focus().toggleStrike().run()}
                active={editor.isActive('strike')}
                icon={<Strikethrough size={14} />}
                title="Strikethrough (⌘⇧X)"
            />
            <ToolBtn
                onClick={() => editor.chain().focus().toggleCode().run()}
                active={editor.isActive('code')}
                icon={<Code size={14} />}
                title="Inline code (⌘E)"
            />
            <ToolBtn
                onClick={openLinkModal}
                active={editor.isActive('link')}
                icon={<LinkIcon size={14} />}
                title="Link (⌘K)"
            />
            {linkModal && (
                <LinkModal
                    initial={linkModal.value}
                    onClose={() => setLinkModal(null)}
                    onApply={applyLink}
                />
            )}
            <span className="rich-tool-divider" />
            <ToolBtn
                onClick={() => editor.chain().focus().toggleBulletList().run()}
                active={editor.isActive('bulletList')}
                icon={<List size={14} />}
                title="Bullet list (⌘⇧8)"
            />
            <ToolBtn
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
                active={editor.isActive('orderedList')}
                icon={<ListOrdered size={14} />}
                title="Ordered list (⌘⇧7)"
            />
            <ToolBtn
                onClick={() => editor.chain().focus().toggleTaskList().run()}
                active={editor.isActive('taskList')}
                icon={<ListChecks size={14} />}
                title="Task list (⌘⇧9)"
            />
            <ToolBtn
                onClick={outdent}
                disabled={!canLift}
                icon={<IndentDecrease size={14} />}
                title="Outdent list (Shift+Tab)"
            />
            <ToolBtn
                onClick={indent}
                disabled={!canSink}
                icon={<IndentIncrease size={14} />}
                title="Indent list (Tab)"
            />
            <span className="rich-tool-divider" />
            <ToolBtn
                onClick={() => editor.chain().focus().toggleBlockquote().run()}
                active={editor.isActive('blockquote')}
                icon={<Quote size={14} />}
                title="Blockquote (⌘⇧B)"
            />
            <ToolBtn
                onClick={() => editor.chain().focus().toggleCodeBlock().run()}
                active={editor.isActive('codeBlock')}
                icon={<Code2 size={14} />}
                title="Code block (⌘⌥C)"
            />
            <ToolBtn
                onClick={() => editor.chain().focus().setHorizontalRule().run()}
                icon={<Minus size={14} />}
                title="Horizontal rule"
            />
            <ToolBtn
                onClick={() =>
                    editor.chain().focus()
                        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                        .run()
                }
                icon={<TableIcon size={14} />}
                title="Insert table"
            />
        </div>
    );
}

// ─── TipTap WYSIWYG 편집기 ───
function RichEditor({
    body,
    rawFrontmatter,
    fontSize,
    onChange,
}: {
    body: string;
    rawFrontmatter: string;
    fontSize: number;
    onChange: (markdown: string) => void;
}) {
    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                heading: { levels: [1, 2, 3, 4, 5, 6] },
                codeBlock: { HTMLAttributes: { class: 'hljs' } },
            }),
            // autolink: false — `arena.ai` 같은 평문 URL 이 자동으로 링크되는 동작 끄기
            // (사용자가 명시적으로 toolbar Link 버튼/⌘K 로만 링크 생성)
            Link.configure({ openOnClick: false, autolink: false }),
            TaskList,
            TaskItem.configure({ nested: true }),
            Table.configure({ resizable: false }),
            TableRow,
            TableHeader,
            TableCell,
            Markdown.configure({
                html: false,
                tightLists: true,
                bulletListMarker: '-',
                linkify: false, // 자동 URL → 링크 변환 끄기 (사용자 요청)
                breaks: false,
                transformPastedText: true,
                transformCopiedText: true,
            }),
            SearchAndReplace.configure({
                searchResultClass: 'rich-search-highlight',
                disableRegex: true,
            }),
            // Smart typography — `->` → `→`, `--` → `—`, `(c)` → `©` 등 자동 치환
            Typography,
        ],
        content: fixEmphasis(body), // ** 인접 bold 인식되도록 zero-width 삽입
        onUpdate: ({ editor }) => {
            // @ts-expect-error tiptap-markdown 의 storage 타입
            const md: string = editor.storage.markdown.getMarkdown();
            // 직렬화 시 fixEmphasis 의 zero-width 제거 → 파일에는 비가시 문자 안 들어감
            onChange(rawFrontmatter + stripDisplayHelpers(md));
        },
        editorProps: {
            attributes: {
                class: 'markdown-body tiptap-rich',
                style: `font-size: ${fontSize}px`,
            },
        },
    });

    // Rich Text 검색 — App-level SearchBar 가 window event 로 명령 전달.
    // tiptap-search-and-replace 의 storage 타입이 ext 에 없어 any 캐스팅.
    useEffect(() => {
        if (!editor) return;

        const reportCount = () => {
            const storage = (editor.storage as unknown as Record<string, {
                results?: unknown[];
                resultIndex?: number;
            }>).searchAndReplace;
            const count = storage?.results?.length ?? 0;
            const index = storage?.resultIndex ?? 0;
            window.dispatchEvent(
                new CustomEvent('markmind:rich-search-count', {
                    detail: { count, index },
                }),
            );
        };

        const onSearch = (e: Event) => {
            const detail = (e as CustomEvent<{ query: string }>).detail;
            editor.commands.setSearchTerm(detail.query ?? '');
            // setSearchTerm 후 storage 갱신은 다음 frame — setTimeout 0
            setTimeout(reportCount, 0);
        };
        const onNext = () => {
            editor.commands.nextSearchResult();
            setTimeout(reportCount, 0);
        };
        const onPrev = () => {
            editor.commands.previousSearchResult();
            setTimeout(reportCount, 0);
        };
        const onClear = () => {
            editor.commands.setSearchTerm('');
            setTimeout(reportCount, 0);
        };
        window.addEventListener('markmind:rich-search', onSearch);
        window.addEventListener('markmind:rich-search-next', onNext);
        window.addEventListener('markmind:rich-search-prev', onPrev);
        window.addEventListener('markmind:rich-search-clear', onClear);
        return () => {
            window.removeEventListener('markmind:rich-search', onSearch);
            window.removeEventListener('markmind:rich-search-next', onNext);
            window.removeEventListener('markmind:rich-search-prev', onPrev);
            window.removeEventListener('markmind:rich-search-clear', onClear);
        };
    }, [editor]);

    // body prop 이 외부에서 바뀌면 (다른 파일 열기) editor content 갱신.
    // 사용자가 편집 중인 변경은 덮어쓰지 않도록 — 직렬화 결과와 비교.
    useEffect(() => {
        if (!editor) return;
        // @ts-expect-error tiptap-markdown storage
        const current: string = editor.storage.markdown.getMarkdown();
        if (stripDisplayHelpers(current).trim() !== body.trim()) {
            editor.commands.setContent(fixEmphasis(body), { emitUpdate: false });
        }
    }, [body, editor]);

    if (!editor) return null;
    return (
        <>
            <RichToolbar editor={editor} />
            <EditorContent editor={editor} />
        </>
    );
}

export function Preview({ content, fontSize = 14, onChange }: PreviewProps) {
    const { fields, body, processedBody, rawFrontmatter } = useMemo(() => {
        const split = splitFrontmatter(content);
        return {
            fields: split.fields,
            body: split.body,
            processedBody: fixEmphasis(split.body),
            rawFrontmatter: split.rawFrontmatter,
        };
    }, [content]);

    const editable = !!onChange;

    if (!content.trim() && !editable) {
        return (
            <div className="empty-state">
                <div className="empty-state-text">Start typing to see preview</div>
            </div>
        );
    }

    // editable=true (Rich Text mode) → 항상 RichEditor + Toolbar.
    // editable=false (split mode 의 preview pane) → read-only 렌더.
    if (editable) {
        return (
            <div className="preview-wrapper preview-rich-mode">
                {fields.length > 0 && (
                    <aside className="markdown-frontmatter">
                        <dl>
                            {fields.map((f) => (
                                <div key={f.key} className="markdown-frontmatter-row">
                                    <dt>{f.key}</dt>
                                    <dd>{f.value}</dd>
                                </div>
                            ))}
                        </dl>
                    </aside>
                )}
                <RichEditor
                    body={body}
                    rawFrontmatter={rawFrontmatter}
                    fontSize={fontSize}
                    onChange={onChange!}
                />
            </div>
        );
    }

    return (
        <div className="preview-wrapper">
            <ReadOnlyView fields={fields} body={processedBody} fontSize={fontSize} />
        </div>
    );
}
