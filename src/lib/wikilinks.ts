/**
 * Wikilink / markdown-link extraction — shared by the markdown↔tree bridge (M1)
 * and the future vault graph / drill-in navigation (M2).
 *
 * Recognizes:
 *   - Obsidian wikilinks:  [[Target]], [[Target#Heading]], [[Target|Alias]], ![[Target]]
 *   - Markdown links to local docs:  [text](path.md), [text](path.md#Heading), ![alt](path.md)
 *
 * External links (http/https/mailto), pure anchors (#frag), and non-doc targets
 * are ignored — only intra-vault document references are returned.
 */

import type { NodeLink } from '../types/mindmap';

const WIKI_RE = /(!?)\[\[([^\]\n]+)\]\]/g;
const MD_LINK_RE = /(!?)\[([^\]\n]*)\]\(([^)\n]+)\)/g;
const DOC_EXT_RE = /\.(md|markdown|mdx)(#|$)/i;
const EXTERNAL_RE = /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i;

/** Extract all intra-vault links from a chunk of markdown text. */
export function extractLinks(text: string | undefined | null): NodeLink[] {
    if (!text) return [];
    const links: NodeLink[] = [];

    WIKI_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WIKI_RE.exec(text)) !== null) {
        const isEmbed = m[1] === '!';
        let inner = m[2];
        let alias: string | undefined;
        const pipe = inner.indexOf('|');
        if (pipe !== -1) {
            alias = inner.slice(pipe + 1).trim() || undefined;
            inner = inner.slice(0, pipe);
        }
        let heading: string | undefined;
        const hash = inner.indexOf('#');
        if (hash !== -1) {
            heading = inner.slice(hash + 1).trim() || undefined;
            inner = inner.slice(0, hash);
        }
        const target = inner.trim();
        if (!target && !heading) continue; // "[[#H]]" same-doc anchor → skip
        links.push({ raw: m[0], target, alias, heading, isEmbed, isWiki: true });
    }

    MD_LINK_RE.lastIndex = 0;
    while ((m = MD_LINK_RE.exec(text)) !== null) {
        const url = m[3].trim();
        if (EXTERNAL_RE.test(url)) continue;
        if (!DOC_EXT_RE.test(url)) continue;
        const isEmbed = m[1] === '!';
        let target = url;
        let heading: string | undefined;
        const hash = url.indexOf('#');
        if (hash !== -1) {
            heading = url.slice(hash + 1) || undefined;
            target = url.slice(0, hash);
        }
        let decoded = target;
        try {
            decoded = decodeURIComponent(target);
        } catch {
            // malformed %-escape — keep raw
        }
        links.push({
            raw: m[0],
            target: decoded,
            alias: m[2] || undefined,
            heading,
            isEmbed,
            isWiki: false,
        });
    }

    return links;
}

/** True if the text contains any intra-vault link. */
export function hasLinks(text: string | undefined | null): boolean {
    return extractLinks(text).length > 0;
}
