import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { Markdown } from 'tiptap-markdown';
import { SearchAndReplace } from '@sereneinserenade/tiptap-search-and-replace';
import { Typography } from '@tiptap/extension-typography';
import { InlineCheckbox } from '../extensions/InlineCheckbox';
import { MarkdownTable } from '../extensions/MarkdownTable';
import { createImageInline } from '../extensions/ImageInline';
import { resolveImageSrc } from '../lib/imageSrc';
import { removeFlowchartBlock, hasFlowchartBlock } from '../lib/flowchartBlock';
import { TableTools } from './TableTools';
import {
    Bold, Italic, Strikethrough, Code,
    Heading1, Heading2, Heading3, Heading4,
    List, ListOrdered, ListChecks,
    Quote, Code2, Link as LinkIcon, Table as TableIcon,
    Undo2, Redo2, Minus,
    IndentIncrease, IndentDecrease, Eye, EyeOff,
} from 'lucide-react';

interface PreviewProps {
    content: string;
    fontSize?: number;
    /** 편집 모드 활성화 — undefined 면 read-only 만 (기본). 제공 시 토글 표시. */
    onChange?: (markdown: string) => void;
    /** 리치텍스트 편집 모드에서 포맷 툴바 바로 아래에 함께 sticky 로 붙일 배너
        (예: MCP 수정 제안). read-only 모드에선 무시. */
    banner?: ReactNode;
    /** 현재 문서 경로 — 로컬 이미지 상대경로 해석용(#55). 미저장이면 null. */
    filePath?: string | null;
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

// GFM table row 는 한 줄에 시작·종료가 정상이지만, LLM 회의록 자동 생성
// (Gemini/Claude) 이 긴 row 를 시각적 wrap 형태로 multi-line 으로 출력하면
// GFM parser 가 첫 줄을 단일 셀 row 로, 다음 줄을 plain text 로 깨뜨림.
// 휴리스틱: `|` 로 시작 + `|` 로 안 끝나는 줄 + (선택 빈 줄들) + leading
// whitespace + `|` 시작 줄 → 공백 하나로 join. 다단계 wrap 도 loop 로 흡수.
// ``` fence 안은 mask 후 복원.
function joinBrokenTableRows(md: string): string {
    // CRLF → LF 통일 (Windows 파일 호환). Renderer 단 normalize 라 saved file 의
    // line ending 영향 X (tiptap-markdown 출력은 항상 LF, ReadOnly 는 display 만).
    const normalized = md.replace(/\r\n/g, '\n');

    // GFM fence (``` 또는 ~~~) line-by-line scan. backreference 패턴은 종료 fence
    // 가 시작보다 긴 경우 (GFM spec 4.5 허용 — 예: ```` 시작 ``` 종료, code 안 백틱
    // 노출용 흔한 패턴) 를 못 잡으므로 scan 으로 종료 길이 ≥ 시작 길이 dynamic
    // 매치. line-anchored 라 inline ``` 시퀀스 (JS 문자열, 문서 예시) 는 fence
    // 로 오인 안 됨. NUL byte sentinel 로 mask 후 복원.
    const fenceParts: string[] = [];
    const lines = normalized.split('\n');
    const out: string[] = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const openMatch = line.match(/^[ ]{0,3}(([`~])\2{2,})/);
        if (openMatch) {
            const fenceChar = openMatch[2];
            const minLen = openMatch[1].length;
            const escaped = fenceChar === '`' ? '`' : '~';
            const closeRe = new RegExp(
                `^[ ]{0,3}${escaped}{${minLen},}[ \\t]*$`,
            );
            let j = i + 1;
            while (j < lines.length && !closeRe.test(lines[j])) j++;
            // GFM/CommonMark spec: unterminated fence (j === lines.length) 는
            // EOF 까지 code block 으로 처리. 우리도 같은 방식으로 끝까지 mask 해
            // join 이 code 영역 침범하는 것 차단.
            const endIdx = j < lines.length ? j + 1 : j;
            const block = lines.slice(i, endIdx).join('\n');
            fenceParts.push(block);
            out.push(`\x00MMF${fenceParts.length - 1}\x00`);
            i = endIdx;
            continue;
        }
        out.push(line);
        i++;
    }
    let result = out.join('\n');

    // multi-line table row join. CRLF 는 위에서 LF 로 통일됨.
    let prev: string | null = null;
    while (prev !== result) {
        prev = result;
        result = result.replace(
            /^(\|[^\n]*[^|\s])[ \t]*\n(?:[ \t]*\n)*[ \t]+(\|)/gm,
            '$1 $2',
        );
    }

    return result.replace(/\x00MMF(\d+)\x00/g, (_, idx) => fenceParts[Number(idx)]);
}

/** save 시점에 fixEmphasis 가 삽입한 zero-width 제거 */
function stripDisplayHelpers(md: string): string {
    return md.replace(/​/g, '');
}

// tiptap-markdown 0.9.0 직렬화(getMarkdown) 후처리 — round-trip 시 끼어드는
// 불필요한 기호 제거(선별적). 코드(펜스/인라인)는 보호.
//   ① hardBreak 백슬래시: 라이브러리가 hardBreak 를 "\\\n" 로 직렬화 →
//      breaks:true 환경에선 '\n' 만으로 동일 렌더라 줄 끝 '\' 만 제거(개행 유지).
//   ② 표 셀의 block-marker escape(\#,\>,\+,\-,\1.): 셀 안에선 헤딩/리스트/인용이
//      될 수 없어 불필요 → 해제. 인라인 \*,\`,\[,\_ 는 보존(평문 특수문자 round-trip
//      안전성 위해 — 사용자 선택).
function normalizeSerializedMarkdown(md: string): string {
    // ── 코드펜스 보호 (joinBrokenTableRows 와 동일 마스킹) ──
    const fences: string[] = [];
    const srcLines = md.split('\n');
    const maskedLines: string[] = [];
    let i = 0;
    while (i < srcLines.length) {
        const line = srcLines[i];
        const open = line.match(/^[ ]{0,3}(([`~])\2{2,})/);
        if (open) {
            const ch = open[2];
            const minLen = open[1].length;
            const closeRe = new RegExp(`^[ ]{0,3}${ch === '`' ? '`' : '~'}{${minLen},}[ \\t]*$`);
            let j = i + 1;
            while (j < srcLines.length && !closeRe.test(srcLines[j])) j++;
            const endIdx = j < srcLines.length ? j + 1 : j;
            fences.push(srcLines.slice(i, endIdx).join('\n'));
            maskedLines.push(`\x00MMN${fences.length - 1}\x00`);
            i = endIdx;
            continue;
        }
        maskedLines.push(line);
        i++;
    }
    let result = maskedLines.join('\n');

    // ── 인라인 코드 보호 (단일 라인) ──
    const codes: string[] = [];
    result = result.replace(/`[^`\n]*`/g, (m) => {
        codes.push(m);
        return `\x00MMC${codes.length - 1}\x00`;
    });

    // ① hardBreak 백슬래시 제거 (개행은 유지)
    result = result.replace(/\\(?=\n)/g, '').replace(/\\$/, '');

    // ② 표 행에서만 block-marker escape 해제
    result = result
        .split('\n')
        .map((ln) => {
            if (!/^\s*\|/.test(ln)) return ln;
            return ln
                .replace(/\\(#{1,6})/g, '$1')
                .replace(/\\([>+\-])/g, '$1')
                .replace(/(\d+)\\\./g, '$1.');
        })
        .join('\n');

    // ── 복원 ──
    result = result.replace(/\x00MMC(\d+)\x00/g, (_, n) => codes[Number(n)]);
    result = result.replace(/\x00MMN(\d+)\x00/g, (_, n) => fences[Number(n)]);
    return result;
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

// ─── HTML 테이블 블록 (병합 셀 — MarkdownTable 확장이 직렬화) 분리 ───
// react-markdown 은 rehype-raw 없이는 raw HTML 을 리터럴 텍스트로 표시하므로,
// 읽기 전용 뷰에서는 <table>…</table> 블록만 분리해 sanitize 후 직접 렌더.
// code fence 안의 <table> 예시는 분리 대상에서 제외 (line scan 으로 fence 추적).
interface BodySegment {
    kind: 'md' | 'table';
    text: string;
}

function splitHtmlTableBlocks(md: string): BodySegment[] {
    const lines = md.replace(/\r\n/g, '\n').split('\n');
    const segments: BodySegment[] = [];
    let buf: string[] = [];
    let fenceClose: RegExp | null = null;

    const flush = () => {
        if (buf.length) {
            segments.push({ kind: 'md', text: buf.join('\n') });
            buf = [];
        }
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (fenceClose) {
            buf.push(line);
            if (fenceClose.test(line)) fenceClose = null;
            continue;
        }
        const fenceOpen = line.match(/^[ ]{0,3}(([`~])\2{2,})/);
        if (fenceOpen) {
            const ch = fenceOpen[2] === '`' ? '`' : '~';
            fenceClose = new RegExp(`^[ ]{0,3}${ch}{${fenceOpen[1].length},}[ \\t]*$`);
            buf.push(line);
            continue;
        }
        if (/^[ \t]*<table[\s>]/i.test(line)) {
            let closeLine = -1;
            for (let j = i; j < lines.length; j++) {
                if (/<\/table>[ \t]*$/i.test(lines[j])) {
                    closeLine = j;
                    break;
                }
            }
            if (closeLine !== -1) {
                flush();
                segments.push({ kind: 'table', text: lines.slice(i, closeLine + 1).join('\n') });
                i = closeLine;
                continue;
            }
        }
        buf.push(line);
    }
    flush();
    return segments;
}

// dangerouslySetInnerHTML 에 넣기 전 allowlist sanitize.
// 허용 태그 외 요소는 textContent 로 치환, 허용 외 속성은 제거,
// href/src 는 안전한 스킴만 통과 — 외부 의존성 없이 DOMParser 로 처리.
const TABLE_ALLOWED_TAGS = new Set([
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
    'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 's', 'del', 'u', 'code', 'span', 'a',
    'ul', 'ol', 'li', 'input', 'label', 'img', 'blockquote', 'pre',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
]);
const TABLE_ALLOWED_ATTRS = new Set([
    'colspan', 'rowspan', 'href', 'src', 'alt', 'type', 'checked', 'disabled', 'start',
]);

function isSafeUrl(value: string): boolean {
    const trimmed = value.trim();
    if (trimmed.startsWith('#')) return true;
    try {
        const url = new URL(trimmed, 'https://local.invalid/');
        return ['http:', 'https:', 'mailto:'].includes(url.protocol);
    } catch {
        return false;
    }
}

function sanitizeTableHtml(html: string): string {
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const sanitizeElement = (el: Element) => {
        // 자식 먼저 처리 (치환 시 하위 순회 불필요해지도록 복사본 순회)
        for (const child of Array.from(el.children)) {
            sanitizeElement(child);
        }
        if (!TABLE_ALLOWED_TAGS.has(el.tagName.toLowerCase())) {
            el.replaceWith(doc.createTextNode(el.textContent ?? ''));
            return;
        }
        for (const attr of Array.from(el.attributes)) {
            const name = attr.name.toLowerCase();
            if (!TABLE_ALLOWED_ATTRS.has(name)) {
                el.removeAttribute(attr.name);
                continue;
            }
            if ((name === 'href' || name === 'src') && !isSafeUrl(attr.value)) {
                el.removeAttribute(attr.name);
            }
        }
        // 읽기 전용 뷰 — 체크박스는 비활성으로
        if (el.tagName.toLowerCase() === 'input') {
            el.setAttribute('disabled', '');
        }
    };

    for (const child of Array.from(doc.body.children)) {
        sanitizeElement(child);
    }
    return doc.body.innerHTML;
}

// ─── 읽기 전용 마크다운 렌더 (기존 react-markdown 흐름) ───
function ReadOnlyView({
    fields,
    body,
    fontSize,
    docDir,
}: {
    fields: { key: string; value: string }[];
    body: string;
    fontSize: number;
    docDir: string | null;
}) {
    // 병합 셀 테이블 (HTML 직렬화분) 은 react-markdown 이 리터럴 텍스트로
    // 보여주므로 블록 단위로 분리해 sanitize 후 직접 렌더
    const segments = useMemo(() => splitHtmlTableBlocks(body), [body]);
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
            {segments.map((seg, i) =>
                seg.kind === 'table' ? (
                    <div
                        key={i}
                        // eslint-disable-next-line react/no-danger
                        dangerouslySetInnerHTML={{ __html: sanitizeTableHtml(seg.text) }}
                    />
                ) : (
                    <ReactMarkdown
                        key={i}
                        remarkPlugins={[
                            remarkFrontmatter,
                            [remarkGfm, { singleTilde: false }],
                        ]}
                        rehypePlugins={[rehypeHighlight]}
                        components={{
                            // 로컬 이미지 경로 → asset:// 변환해 표시 (#55)
                            img: ({ node: _node, src, ...props }) => (
                                <img {...props} src={resolveImageSrc(src ?? '', docDir)} />
                            ),
                        }}
                    >
                        {seg.text}
                    </ReactMarkdown>
                ),
            )}
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
            {/* 셀 안에 cursor 가 있을 때만 우측 빈 공간에 표시 (margin-left:auto) */}
            <TableTools editor={editor} />
        </div>
    );
}

// ─── TipTap WYSIWYG 편집기 ───
function RichEditor({
    body,
    rawFrontmatter,
    fontSize,
    onChange,
    banner,
    docDir,
    onEditorReady,
}: {
    body: string;
    rawFrontmatter: string;
    fontSize: number;
    onChange: (markdown: string) => void;
    banner?: ReactNode;
    docDir: string | null;
    onEditorReady?: (editor: Editor | null) => void;
}) {
    // docDir 은 파일 전환 시 바뀌므로 ref 로 최신값 보관 — Image renderHTML 클로저(#55)가
    // 항상 최신 docDir 을 읽게 한다(editor 재생성 없이).
    const docDirRef = useRef(docDir);
    const editorInstanceRef = useRef<Editor | null>(null);
    // onUpdate 가 마지막으로 내보낸 body — 외부 content 변경(저장 flush 등) 감지용(#56).
    const lastEmittedBodyRef = useRef(body);
    useEffect(() => {
        docDirRef.current = docDir;
    }, [docDir]);

    // 붙여넣기 이미지 → $TEMP 임시 저장 후 절대경로 image 노드 삽입(#56).
    // 미저장이어도 OK — 저장 시 flush 가 assets/ 로 복사·치환. 표시는 #55(asset://).
    const attachAndInsertImage = useCallback(async (file: File) => {
        try {
            const { writeTempImage, extFromMime } = await import('../lib/imageAttach');
            const bytes = new Uint8Array(await file.arrayBuffer());
            const path = await writeTempImage(bytes, extFromMime(file.type));
            editorInstanceRef.current?.chain().focus().setImage({ src: path }).run();
        } catch (err) {
            console.error('[RichEditor] 이미지 첨부 실패:', err);
        }
    }, []);

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
            // 병합 셀 테이블을 HTML 로 직렬화/복원하는 보강판 (기본 Table 확장)
            MarkdownTable.configure({ resizable: false }),
            TableRow,
            TableHeader,
            TableCell,
            Markdown.configure({
                html: false,
                tightLists: true,
                bulletListMarker: '-',
                linkify: false, // 자동 URL → 링크 변환 끄기 (사용자 요청)
                // breaks=true: 본문에서 `\n` 한 개도 `<br>` 으로 렌더. CommonMark
                // 기본은 false 라서 회의록 머리말처럼 빈 줄 없이 여러 라인을
                // 적어둔 케이스 (`**일시:** ...\n**장소:** ...`) 가 한 단락으로
                // 합쳐져 보이는 문제가 있었음. GFM/Notion/Slack 등 사용자가
                // 익숙한 마크다운 환경의 다수가 이미 breaks=true 동작이라
                // 직관에도 맞음.
                breaks: true,
                transformPastedText: true,
                transformCopiedText: true,
            }),
            SearchAndReplace.configure({
                searchResultClass: 'rich-search-highlight',
                disableRegex: true,
            }),
            // 인라인 체크박스 — table cell 안에서도 클릭 가능. Read-only ReactMarkdown
            // 경로에는 적용 안 됨 (Rich Text 모드 전용 기능).
            InlineCheckbox,
            // Smart typography — `->` → `→`, `--` → `—`, `(c)` → `©` 등 자동 치환
            Typography,
            // 로컬 이미지 표시 — 원본 경로는 보존, 표시만 asset:// 변환 (#55)
            createImageInline(() => docDirRef.current),
        ],
        content: fixEmphasis(joinBrokenTableRows(body)), // ** 인접 bold 인식되도록 zero-width 삽입 + LLM multi-line table row 정상화
        onUpdate: ({ editor }) => {
            const md: string = editor.storage.markdown?.getMarkdown() ?? '';
            // zero-width 제거 + tiptap-markdown 과잉 escape/hardBreak 정규화
            const outBody = normalizeSerializedMarkdown(stripDisplayHelpers(md));
            lastEmittedBodyRef.current = outBody; // 외부 변경 감지 기준(#56)
            onChange(rawFrontmatter + outBody);
        },
        editorProps: {
            attributes: {
                class: 'markdown-body tiptap-rich',
                style: `font-size: ${fontSize}px`,
            },
            // 이미지 붙여넣기 → 임시 저장 후 image 노드 삽입(#56). 이미지 아니면 기본 paste 유지.
            // ⚠️ DataTransferItemList 는 WKWebView(Safari)에서 for...of 미지원 → 인덱스 순회 필수.
            handlePaste: (_view, event) => {
                const items = event.clipboardData?.items;
                if (!items) return false;
                for (let i = 0; i < items.length; i++) {
                    const it = items[i];
                    if (it.type.startsWith('image/')) {
                        const file = it.getAsFile();
                        if (file) {
                            event.preventDefault();
                            void attachAndInsertImage(file);
                            return true;
                        }
                    }
                }
                return false;
            },
            // NOTE: 파일 드롭은 Tauri native(dragDropEnabled 기본 true)가 webview DOM drop 을
            // 가로채므로 여기 handleDrop 은 파일에 안 불린다. 드롭은 App 의 onDragDropEvent 가
            // 받아 viewMode 에 맞는 에디터(여기 Tiptap)로 insertImageMarkdown 라우팅(#56).
            // copy 시 fixEmphasis 의 zero-width 가 사용자 클립보드에 섞이지 않도록 제거
            handleDOMEvents: {
                copy: (_view, event) => {
                    const sel = window.getSelection()?.toString() ?? '';
                    if (sel && sel.includes('​')) {
                        event.preventDefault();
                        event.clipboardData?.setData('text/plain', sel.replace(/​/g, ''));
                        return true;
                    }
                    return false;
                },
            },
        },
    });

    // editor 인스턴스를 ref(paste 핸들러용) + 부모(App 의 drop 라우팅용)에 노출(#56)
    useEffect(() => {
        editorInstanceRef.current = editor;
        onEditorReady?.(editor);
    }, [editor, onEditorReady]);

    // 외부 content 변경 동기화(#56) — body 가 내가 마지막으로 내보낸 것과 다르면
    // (저장 flush 로 temp→./assets 치환 등) editor 에 반영. 정규화는 idempotent 하므로
    // 편집 중 자기 출력의 round-trip 은 같아서 setContent 가 안 불려 커서가 유지된다.
    useEffect(() => {
        if (!editor) return;
        if (body === lastEmittedBodyRef.current) return;
        lastEmittedBodyRef.current = body;
        const { from, to } = editor.state.selection;
        editor.commands.setContent(fixEmphasis(joinBrokenTableRows(body)), { emitUpdate: false });
        try {
            editor.commands.setTextSelection({ from, to });
        } catch {
            /* 길이 변동으로 위치가 무효면 무시 */
        }
    }, [body, editor]);

    // Rich Text 검색 — App-level SearchBar 가 window event 로 명령 전달.
    // tiptap-search-and-replace 의 storage 타입이 ext 에 없어 any 캐스팅.
    useEffect(() => {
        if (!editor) return;

        const reportCount = () => {
            const storage = editor.storage.searchAndReplace;
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
        const current: string = editor.storage.markdown?.getMarkdown() ?? '';
        // onChange 와 동일 정규화를 거쳐 비교 — 안 그러면 저장본(정규화됨)과 늘
        // 달라 보여 매번 setContent(커서 점프) 가 발생.
        const cleanedCurrent = normalizeSerializedMarkdown(stripDisplayHelpers(current));
        // fast-path: 길이 차이 ≥ 8 면 trim 비교 skip — 큰 문서 비용 절감
        const lenDiff = Math.abs(cleanedCurrent.length - body.length);
        if (lenDiff > 8 || cleanedCurrent.trim() !== body.trim()) {
            editor.commands.setContent(fixEmphasis(joinBrokenTableRows(body)), { emitUpdate: false });
        }
    }, [body, editor]);

    if (!editor) return null;
    return (
        <>
            {/* 툴바 + 배너를 한 sticky 블록으로 묶어, 배너가 포맷 툴바 바로 아래에
                고정되도록 한다(스크롤해도 함께 상단 고정). */}
            <div className="rich-sticky-top">
                <RichToolbar editor={editor} />
                {banner}
            </div>
            <EditorContent editor={editor} />
        </>
    );
}

export interface PreviewHandle {
    /** Rich Text(Tiptap) 에디터의 현재 커서에 이미지 노드 삽입 — App 의 drop 라우팅용(#56). */
    insertImageMarkdown: (relPath: string) => void;
    /** 드롭 좌표(client px)에 해당하는 위치에 이미지 삽입(#56). 좌표 무효면 커서 위치. */
    insertImageAtCoords: (relPath: string, clientX: number, clientY: number) => void;
}

export const Preview = forwardRef<PreviewHandle, PreviewProps>(function Preview(
    { content, fontSize = 14, onChange, banner, filePath },
    ref,
) {
    const [showFlow, setShowFlow] = useState(false);
    // Rich Text 모드의 editor 인스턴스 — App 이 drop 이미지를 여기로 삽입(#56)
    const richEditorRef = useRef<Editor | null>(null);
    useImperativeHandle(ref, () => ({
        insertImageMarkdown: (relPath: string) => {
            richEditorRef.current?.chain().focus().setImage({ src: relPath }).run();
        },
        insertImageAtCoords: (relPath: string, clientX: number, clientY: number) => {
            const editor = richEditorRef.current;
            if (!editor) return;
            const coords = editor.view.posAtCoords({ left: clientX, top: clientY });
            if (coords) {
                editor.chain().focus().insertContentAt(coords.pos, { type: 'image', attrs: { src: relPath } }).run();
            } else {
                editor.chain().focus().setImage({ src: relPath }).run();
            }
        },
    }), []);
    // 문서 디렉토리(POSIX) — 로컬 이미지 상대경로 해석 기준(#55). 미저장이면 null.
    const docDir = useMemo(
        () => (filePath ? filePath.slice(0, filePath.lastIndexOf('/')) : null),
        [filePath],
    );
    const { fields, body, rawFrontmatter } = useMemo(() => {
        const split = splitFrontmatter(content);
        return {
            fields: split.fields,
            body: split.body,
            rawFrontmatter: split.rawFrontmatter,
        };
    }, [content]);

    // read-only 뷰 표시용 — 흐름도 데이터(markmind-flow JSON) 는 토글 off 시 숨긴다(표시만,
    // 원본은 보존). 편집(⌘3 Rich Text) 경로는 strip 하면 저장 시 블록이 사라지므로 건드리지 않는다.
    const hasFlow = useMemo(() => hasFlowchartBlock(body), [body]);
    const processedBody = useMemo(
        () => fixEmphasis(joinBrokenTableRows(showFlow ? body : removeFlowchartBlock(body))),
        [body, showFlow],
    );

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
                    banner={banner}
                    docDir={docDir}
                    onEditorReady={(e) => { richEditorRef.current = e; }}
                />
            </div>
        );
    }

    return (
        <div className="preview-wrapper">
            {hasFlow && (
                <button
                    type="button"
                    className="flow-data-toggle"
                    onClick={() => setShowFlow((v) => !v)}
                    title={showFlow ? '흐름도 데이터(코드블록) 숨기기' : '흐름도 데이터(코드블록) 보기'}
                >
                    {showFlow ? <EyeOff size={13} /> : <Eye size={13} />}
                    {showFlow ? '흐름도 데이터 숨김' : '흐름도 데이터'}
                </button>
            )}
            <ReadOnlyView fields={fields} body={processedBody} fontSize={fontSize} docDir={docDir} />
        </div>
    );
});
