import { describe, it, expect } from 'vitest';
import { markdownToTree, treeToMarkdown, documentToTree, treeToDocument } from './markdownTree';
import type { MindmapNode } from '../types/mindmap';

// Strip volatile / derived fields so two parses can be compared structurally.
interface BareNode {
    label: string;
    origin?: string;
    level?: number;
    description?: string;
    children: BareNode[];
}
function strip(n: MindmapNode): BareNode {
    return {
        label: n.label,
        origin: n.mdOrigin,
        level: n.mdLevel,
        description: n.description,
        children: n.children.map(strip),
    };
}

const FIXTURES: Record<string, string> = {
    'headings-only': `# Project
## Goals
## Risks
### Timeline
`,
    'lists-only': `- alpha
- beta
  - beta one
  - beta two
- gamma
`,
    mixed: `# Project
intro paragraph

## Goals
- ship v1
- get users
  - via launch
## Risks
risk prose
`,
    'code-and-tables': `# Doc
## Snippet
\`\`\`ts
const x = 1;
### not a heading
\`\`\`
## Table
| a | b |
| - | - |
| 1 | 2 |
`,
    'deep-nesting': `# Root
## L1
### L2
- l3
  - l4
    - l5
      - l6
`,
    korean: `# 프로젝트
## 목표
- 사용자 확보
- 매출 달성
## 위험
- 일정 지연
`,
    wikilinks: `# Hub
## 연결
- 참고 [[Other Note]]
- 별칭 [[Target|보이는 이름]]
- 섹션 [[Doc#Heading]]
- 마크다운 [text](sub/page.md)
`,
    empty: ``,
    'prose-before-heading': `intro line

# Title
body
`,
    'multi-h1': `# A
## A1
# B
## B1
`,
};

describe('markdownTree round-trip', () => {
    for (const [name, raw] of Object.entries(FIXTURES)) {
        it(`${name}: idempotent after one normalization`, () => {
            const once = treeToMarkdown(markdownToTree(raw));
            const twice = treeToMarkdown(markdownToTree(once));
            expect(twice).toBe(once);
        });

        it(`${name}: structure stable across re-parse`, () => {
            const once = treeToMarkdown(markdownToTree(raw));
            const t1 = markdownToTree(once);
            const t2 = markdownToTree(treeToMarkdown(t1));
            expect(strip(t2)).toEqual(strip(t1));
        });
    }
});

describe('markdownTree fidelity', () => {
    it('headings stay headings, lists stay lists', () => {
        const md = treeToMarkdown(markdownToTree(FIXTURES.mixed));
        expect(md).toContain('## Goals');
        expect(md).toContain('- ship v1');
        expect(md).toContain('  - via launch');
        expect(md).not.toContain('### ship v1'); // a bullet must NOT become a heading
    });

    it('preserves a skipped heading level (### under #)', () => {
        const md = treeToMarkdown(markdownToTree('# A\n### Deep\n'));
        expect(md).toContain('### Deep');
    });

    it('promotes a single wrapping H1 to the root', () => {
        const tree = markdownToTree('# Title\n## Section\n');
        expect(tree.label).toBe('Title');
        expect(tree.mdOrigin).toBe('root');
        expect(tree.children.map((c) => c.label)).toEqual(['Section']);
    });

    it('keeps a code fence verbatim inside a description', () => {
        const md = treeToMarkdown(markdownToTree(FIXTURES['code-and-tables']));
        expect(md).toContain('```ts');
        expect(md).toContain('### not a heading'); // line inside fence preserved, not parsed
        expect(md).toContain('| a | b |');
    });
});

describe('wikilinks', () => {
    it('parses links onto nodes and keeps the raw text in markdown', () => {
        const tree = markdownToTree(FIXTURES.wikilinks);
        const md = treeToMarkdown(tree);
        expect(md).toContain('[[Other Note]]');
        expect(md).toContain('[[Target|보이는 이름]]');
        expect(md).toContain('[[Doc#Heading]]');
        expect(md).toContain('[text](sub/page.md)');

        // node.links populated
        const all: MindmapNode[] = [];
        const walk = (n: MindmapNode) => { all.push(n); n.children.forEach(walk); };
        walk(tree);
        const targets = all.flatMap((n) => n.links ?? []).map((l) => l.target);
        expect(targets).toContain('Other Note');
        expect(targets).toContain('Target');
        expect(targets).toContain('Doc');
        expect(targets).toContain('sub/page.md');

        const aliasLink = all.flatMap((n) => n.links ?? []).find((l) => l.target === 'Target');
        expect(aliasLink?.alias).toBe('보이는 이름');
        const headingLink = all.flatMap((n) => n.links ?? []).find((l) => l.target === 'Doc');
        expect(headingLink?.heading).toBe('Heading');
    });
});

describe('frontmatter preservation', () => {
    it('keeps frontmatter verbatim around a round-trip', () => {
        const doc = `---\ntitle: My Doc\ntags: [a, b]\n---\n# Body\n## Section\n`;
        const { frontmatter, tree } = documentToTree(doc);
        const out = treeToDocument(tree, frontmatter);
        expect(out.startsWith('---\ntitle: My Doc\ntags: [a, b]\n---\n')).toBe(true);
        expect(out).toContain('# Body');
        expect(out).toContain('## Section');
        // full document round-trip is idempotent too
        const out2 = treeToDocument(documentToTree(out).tree, documentToTree(out).frontmatter);
        expect(out2).toBe(out);
    });
});
