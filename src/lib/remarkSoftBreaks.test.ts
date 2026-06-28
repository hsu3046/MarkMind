import { describe, expect, it } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Paragraph, Root } from 'mdast';
import { remarkSoftBreaks } from './remarkSoftBreaks';

function parseWithSoftBreaks(md: string): Root {
    const processor = unified()
        .use(remarkParse)
        .use(remarkGfm, { singleTilde: false })
        .use(remarkSoftBreaks);
    const tree = processor.parse(md);
    return processor.runSync(tree) as Root;
}

function collectTypes(node: unknown): string[] {
    if (!node || typeof node !== 'object') return [];
    const typed = node as { type?: string; children?: unknown[] };
    const own = typed.type ? [typed.type] : [];
    const children = Array.isArray(typed.children)
        ? typed.children.flatMap((child) => collectTypes(child))
        : [];
    return [...own, ...children];
}

describe('remarkSoftBreaks', () => {
    it('converts paragraph soft line breaks to break nodes', () => {
        const tree = parseWithSoftBreaks('첫 줄\n둘째 줄\n셋째 줄');
        const paragraph = tree.children[0] as Paragraph;

        expect(paragraph.type).toBe('paragraph');
        expect(paragraph.children.map((child) => child.type))
            .toEqual(['text', 'break', 'text', 'break', 'text']);
    });

    it('preserves code block line endings', () => {
        const tree = parseWithSoftBreaks(['```ts', 'const a = 1;', 'const b = 2;', '```'].join('\n'));

        expect(tree.children[0]).toMatchObject({
            type: 'code',
            lang: 'ts',
            value: 'const a = 1;\nconst b = 2;',
        });
        expect(collectTypes(tree).filter((type) => type === 'break')).toHaveLength(0);
    });

    it('works inside nested markdown containers', () => {
        const tree = parseWithSoftBreaks(['> 발표 원고 첫 줄', '> 발표 원고 둘째 줄', '', '- 항목 첫 줄', '  항목 둘째 줄'].join('\n'));

        expect(collectTypes(tree).filter((type) => type === 'break')).toHaveLength(2);
    });
});
