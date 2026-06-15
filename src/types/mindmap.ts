/**
 * Mindmap data model — ported from the MindBusiness project and extended for
 * MarkMind's markdown↔tree bridge.
 *
 * The tree (`MindmapNode`) is the intermediate representation between a markdown
 * document and the React Flow mindmap canvas. Markdown is the single source of
 * truth; this tree is derived on demand (see ../lib/markdownTree.ts).
 */

export type MindmapNodeKind = 'text' | 'image';

/**
 * A link found inside a node's `label` or `description`. Parsed from Obsidian
 * wikilinks (`[[Target]]`) and markdown links to local docs (`[text](path.md)`).
 *
 * Read-only DERIVED metadata — it never affects serialization. The raw link
 * text stays verbatim in the markdown, so round-trips are lossless. This is the
 * M1 foundation the M2 (Obsidian) layer builds drill-in navigation + the vault
 * graph on top of.
 */
export interface NodeLink {
    /** Original matched text, e.g. "[[X#H|alias]]" or "[text](x.md)". */
    raw: string;
    /** Resolved-name target before vault path resolution, e.g. "X" / "x.md". */
    target: string;
    /** Alias / display text — "[[X|alias]]" or "[alias](x.md)". */
    alias?: string;
    /** Heading anchor — "[[X#H]]" → "H". */
    heading?: string;
    /** "![[X]]" / "![..](..)" transclusion embed. */
    isEmbed: boolean;
    /** true = `[[wikilink]]`, false = `[text](path.md)`. */
    isWiki: boolean;
}

export interface MindmapNode {
    id: string;
    label: string;
    description?: string;
    /** Authoring/source role: 'root' | 'sub_branch' | 'manual' | 'ai' | … */
    type: string;

    /** Content shape — defaults to 'text' when undefined. */
    kind?: MindmapNodeKind;

    // ── image-only fields (meaningful when kind === 'image') ────────────────
    image_id?: string;
    image_width?: number;
    image_height?: number;
    image_mime?: 'image/webp';
    alt?: string;

    /** Node importance for visual sizing (1=Low … 5=Critical). */
    importance?: 1 | 2 | 3 | 4 | 5;
    semantic_type?: 'finance' | 'action' | 'risk' | 'persona' | 'resource' | 'metric' | 'other';
    attributes?: Record<string, unknown>;

    /** Recursive structure. */
    children: MindmapNode[];

    applied_framework_id?: string;
    source_flowchart_id?: string;

    // ── MarkMind markdown-bridge fields (transient; not business metadata) ──
    /**
     * Which markdown construct this node came from. Drives origin-preserving
     * serialization so headings stay headings and bullet lists stay bullets.
     * Undefined for nodes created by editing the canvas (origin inferred by depth).
     */
    mdOrigin?: 'root' | 'heading' | 'list';
    /** Literal heading level (1–6) when mdOrigin === 'heading'. Preserves the user's level. */
    mdLevel?: number;
    /** 1-based source line of this heading/list item in the FULL document (incl. frontmatter).
     *  Used to jump from a mindmap node to its section in the editor. */
    mdLine?: number;
    /** Links parsed from label + description (see [[NodeLink]]). Read-only derived. */
    links?: NodeLink[];
}
