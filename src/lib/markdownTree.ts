/**
 * Deterministic markdown ↔ MindmapNode bridge.
 *
 * Markdown is the single source of truth; the mindmap is a derived, editable
 * view. This module converts both directions with a guarantee weaker than
 * byte-preservation but strong enough to be safe: **idempotency after one
 * normalization pass** —
 *
 *     treeToMarkdown(markdownToTree(treeToMarkdown(x))) === treeToMarkdown(x)
 *
 * (the same honest contract Preview.tsx already uses for its tiptap round-trip).
 *
 * Canonical model — headings and lists share ONE depth axis:
 *   - headings (`#`..`######`) nest as an outline (origin 'heading', literal
 *     level preserved so `### x` under `# y` stays `### x`);
 *   - bullet / ordered list items nest by indentation under the nearest heading
 *     (origin 'list', normalized to `-` + 2-space indents);
 *   - any non-structural content (paragraphs, code fences, tables, quotes) is
 *     attached verbatim to the nearest node as `description`.
 * Origin is preserved on serialize (headings stay headings, lists stay lists)
 * because the serialized text re-encodes it — so origin is re-derived on parse,
 * never stored out of band.
 */

import type { MindmapNode } from '../types/mindmap';
import { extractLinks } from './wikilinks';

export interface ParseOptions {
    /** Fallback root label when the document has no single wrapping H1. */
    rootLabel?: string;
}

const DEFAULT_ROOT_LABEL = 'Untitled';

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const LIST_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;
const FENCE_OPEN_RE = /^[ ]{0,3}(([`~])\2{2,})/;

// ── helpers ─────────────────────────────────────────────────────────────────

/** A list-origin node whose description spans multiple blocks / fences / tables
 *  can't be safely nested under a bullet (CommonMark indentation is fragile),
 *  so it is serialized as a heading instead (R3 escape hatch). */
function isBlockDescription(desc: string): boolean {
    const t = desc.trim();
    if (!t) return false;
    return (
        /(^|\n)\s{0,3}(```|~~~)/.test(t) || // fenced code
        /(^|\n)\s*\|/.test(t) ||            // table row
        /(^|\n)\s*>/.test(t) ||             // blockquote
        /\n\s*\n/.test(t)                   // multiple blocks
    );
}

function appendDescription(node: MindmapNode, text: string): void {
    node.description = node.description === undefined ? text : `${node.description}\n${text}`;
}

// ── parse: markdown → tree ───────────────────────────────────────────────────

interface HeadingFrame {
    level: number;
    node: MindmapNode;
    depth: number;
}
interface ListFrame {
    indent: number;
    node: MindmapNode;
    depth: number;
}

/** Parse body markdown (frontmatter already stripped) into a MindmapNode tree. */
export function markdownToTree(md: string, opts: ParseOptions = {}): MindmapNode {
    const rootLabel = opts.rootLabel ?? DEFAULT_ROOT_LABEL;
    const root: MindmapNode = { id: '', label: rootLabel, type: 'root', mdOrigin: 'root', children: [] };

    const headingStack: HeadingFrame[] = [];
    const listStack: ListFrame[] = [];

    const owner = (): MindmapNode =>
        listStack.length ? listStack[listStack.length - 1].node
            : headingStack.length ? headingStack[headingStack.length - 1].node
                : root;
    const ownerIsList = (): boolean => listStack.length > 0;
    const headingDepth = (): number =>
        headingStack.length ? headingStack[headingStack.length - 1].depth : 0;

    const lines = md.replace(/\r\n?/g, '\n').split('\n');
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        // fenced code block → opaque description of current owner
        const fence = line.match(FENCE_OPEN_RE);
        if (fence) {
            const ch = fence[2] === '`' ? '`' : '~';
            const len = fence[1].length;
            const closeRe = new RegExp(`^[ ]{0,3}${ch}{${len},}[ \\t]*$`);
            let j = i + 1;
            while (j < lines.length && !closeRe.test(lines[j])) j++;
            const end = j < lines.length ? j + 1 : j;
            appendDescription(owner(), lines.slice(i, end).join('\n'));
            i = end;
            continue;
        }

        // heading
        const h = line.match(HEADING_RE);
        if (h) {
            const level = h[1].length;
            while (headingStack.length && headingStack[headingStack.length - 1].level >= level) {
                headingStack.pop();
            }
            listStack.length = 0; // a heading ends any open list
            const parent = headingStack.length ? headingStack[headingStack.length - 1].node : root;
            const depth = headingDepth() + 1;
            const node: MindmapNode = {
                id: '', label: h[2].trim(), type: 'sub_branch',
                mdOrigin: 'heading', mdLevel: level, children: [],
            };
            parent.children.push(node);
            headingStack.push({ level, node, depth });
            i++;
            continue;
        }

        // list item
        const li = line.match(LIST_RE);
        if (li) {
            const indent = li[1].replace(/\t/g, '  ').length;
            while (listStack.length && listStack[listStack.length - 1].indent >= indent) {
                listStack.pop();
            }
            const parent = listStack.length
                ? listStack[listStack.length - 1].node
                : headingStack.length ? headingStack[headingStack.length - 1].node : root;
            const depth = (listStack.length
                ? listStack[listStack.length - 1].depth
                : headingDepth()) + 1;
            const node: MindmapNode = {
                id: '', label: li[2].trim(), type: 'sub_branch', mdOrigin: 'list', children: [],
            };
            parent.children.push(node);
            listStack.push({ indent, node, depth });
            i++;
            continue;
        }

        // non-structural line → description
        const isBlank = line.trim() === '';
        if (!isBlank && /^\S/.test(line) && listStack.length) {
            listStack.length = 0; // unindented prose ends the list
        }
        const target = owner();
        appendDescription(target, isBlank ? '' : (ownerIsList() ? line.trim() : line.replace(/\s+$/, '')));
        i++;
    }

    normalizeDescriptions(root);
    pruneEmpty(root);
    const promoted = promoteRoot(root, rootLabel);
    assignIds(promoted, 'n');
    attachLinks(promoted);
    return promoted;
}

/** Trim each node's description and collapse 3+ blank lines to one. */
function normalizeDescriptions(node: MindmapNode): void {
    if (node.description !== undefined) {
        const cleaned = node.description.replace(/\n{3,}/g, '\n\n').trim();
        if (cleaned) node.description = cleaned;
        else delete node.description;
    }
    for (const c of node.children) normalizeDescriptions(c);
}

/** Drop nodes that carry no information (empty label + no description + no children)
 *  so they don't oscillate across round-trips. */
function pruneEmpty(node: MindmapNode): void {
    node.children = node.children.filter((c) => {
        pruneEmpty(c);
        return c.label.trim() !== '' || (c.description?.trim() ?? '') !== '' || c.children.length > 0;
    });
}

/** If the document is a single H1 wrapping everything, make that H1 the root
 *  (so `# Title` round-trips to `# Title`, not `# placeholder` + `## Title`). */
function promoteRoot(root: MindmapNode, placeholder: string): MindmapNode {
    if (
        root.mdOrigin === 'root' &&
        root.label === placeholder &&
        !(root.description?.trim()) &&
        root.children.length === 1 &&
        root.children[0].mdOrigin === 'heading'
    ) {
        const child = root.children[0];
        child.mdOrigin = 'root';
        child.type = 'root';
        delete child.mdLevel;
        return child;
    }
    return root;
}

function assignIds(node: MindmapNode, id: string): void {
    node.id = id;
    node.children.forEach((c, idx) => assignIds(c, `${id}/${idx}`));
}

function attachLinks(node: MindmapNode): void {
    const links = extractLinks(`${node.label}\n${node.description ?? ''}`);
    if (links.length) node.links = links;
    else if (node.links) delete node.links;
    for (const c of node.children) attachLinks(c);
}

// ── serialize: tree → markdown ───────────────────────────────────────────────

/** Serialize a tree back to canonical body markdown. Idempotent. */
export function treeToMarkdown(tree: MindmapNode, opts: ParseOptions = {}): string {
    const out: string[] = [];
    const rootLabel = (tree.label ?? '').trim() || (opts.rootLabel ?? DEFAULT_ROOT_LABEL);
    out.push(`# ${rootLabel}`.trimEnd());
    if (tree.description?.trim()) {
        out.push('');
        out.push(tree.description.trim());
    }
    for (const child of tree.children ?? []) serializeNode(child, 1, 0, 1, out);

    let s = out.join('\n');
    s = s
        .replace(/[ \t]+$/gm, '')   // trailing spaces
        .replace(/\n{3,}/g, '\n\n') // collapse blank runs
        .replace(/^\n+/, '')        // no leading blank
        .replace(/\s+$/, '');       // no trailing whitespace
    return `${s}\n`;
}

function serializeNode(
    node: MindmapNode,
    treeDepth: number,
    listDepth: number,
    parentHeadingLevel: number,
    out: string[],
): void {
    const origin = node.mdOrigin ?? (treeDepth <= 2 ? 'heading' : 'list');
    const blockDesc = node.description ? isBlockDescription(node.description) : false;
    const asHeading = origin === 'heading' || origin === 'root' || (origin === 'list' && blockDesc);

    if (asHeading) {
        // Preserve the user's literal level where valid; never collide with an
        // ancestor (must be strictly deeper than the parent heading), cap at 6.
        const wanted = node.mdOrigin === 'heading' && node.mdLevel ? node.mdLevel : parentHeadingLevel + 1;
        const level = Math.min(Math.max(wanted, parentHeadingLevel + 1), 6);
        out.push('');
        out.push(`${'#'.repeat(level)} ${node.label}`.trimEnd());
        if (node.description?.trim()) {
            out.push('');
            out.push(node.description.trim());
        }
        for (const c of node.children ?? []) serializeNode(c, treeDepth + 1, 0, level, out);
    } else {
        const pad = '  '.repeat(listDepth);
        out.push(`${pad}- ${node.label}`.trimEnd());
        if (node.description?.trim()) {
            out.push(`${pad}  ${node.description.trim().replace(/\s*\n\s*/g, ' ')}`);
        }
        for (const c of node.children ?? []) serializeNode(c, treeDepth + 1, listDepth + 1, parentHeadingLevel, out);
    }
}

// ── frontmatter-preserving document wrappers (used by the view layer) ────────

interface SplitDoc {
    frontmatter: string; // includes trailing "---\n" or '' when absent
    body: string;
}

/** Split a leading YAML frontmatter block from the body (mirrors Preview.tsx). */
function splitFrontmatter(md: string): SplitDoc {
    if (!md.startsWith('---')) return { frontmatter: '', body: md };
    const after = md.slice(3);
    const endIdx = after.indexOf('\n---');
    if (endIdx === -1) return { frontmatter: '', body: md };
    const raw = after.slice(0, endIdx).trim();
    const body = after.slice(endIdx + 4).replace(/^\r?\n/, '');
    return { frontmatter: `---\n${raw}\n---\n`, body };
}

/** Full document (with optional frontmatter) → { frontmatter, tree }. */
export function documentToTree(fullMd: string, rootLabel?: string): { frontmatter: string; tree: MindmapNode } {
    const { frontmatter, body } = splitFrontmatter(fullMd);
    return { frontmatter, tree: markdownToTree(body, { rootLabel }) };
}

/** Tree + saved frontmatter → full document markdown. */
export function treeToDocument(tree: MindmapNode, frontmatter: string, rootLabel?: string): string {
    const body = treeToMarkdown(tree, { rootLabel });
    return frontmatter ? `${frontmatter}${body}` : body;
}
