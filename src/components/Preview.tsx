import { useEffect, useMemo, useState } from 'react';
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
import {
    Bold, Italic, Strikethrough, Code,
    Heading1, Heading2, Heading3, Heading4,
    List, ListOrdered, ListChecks,
    Quote, Code2, Link as LinkIcon, Table as TableIcon,
    Undo2, Redo2, Minus,
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
    useEffect(() => {
        const handler = () => setTick((t) => t + 1);
        editor.on('selectionUpdate', handler);
        editor.on('transaction', handler);
        return () => {
            editor.off('selectionUpdate', handler);
            editor.off('transaction', handler);
        };
    }, [editor]);

    const promptLink = () => {
        const prev = editor.getAttributes('link').href ?? '';
        const url = prompt('링크 URL (빈 값 = 제거)', prev);
        if (url === null) return;
        if (url === '') {
            editor.chain().focus().extendMarkRange('link').unsetLink().run();
        } else {
            editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
        }
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
                onClick={promptLink}
                active={editor.isActive('link')}
                icon={<LinkIcon size={14} />}
                title="Link (⌘K)"
            />
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
            Link.configure({ openOnClick: false, autolink: true }),
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
                linkify: true,
                breaks: false,
                transformPastedText: true,
                transformCopiedText: true,
            }),
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
