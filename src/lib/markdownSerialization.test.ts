import { describe, expect, it } from 'vitest';
import { normalizeSerializedMarkdown } from './markdownSerialization';

describe('normalizeSerializedMarkdown', () => {
    it('unescapes literal single tildes from rich text serialization', () => {
        expect(normalizeSerializedMarkdown(String.raw`5-2. 현재 \~ 3개월: 공개 베타`))
            .toBe('5-2. 현재 ~ 3개월: 공개 베타');
        expect(normalizeSerializedMarkdown(String.raw`3\~5줄, A \~ B, \~home\~`))
            .toBe('3~5줄, A ~ B, ~home~');
    });

    it('keeps strike delimiters, tilde fences, and inline code intact', () => {
        const fenced = [
            '~~~',
            String.raw`inside \~ code fence`,
            '~~~',
            String.raw`after \~ fence`,
        ].join('\n');

        expect(normalizeSerializedMarkdown('~~취소선~~')).toBe('~~취소선~~');
        expect(normalizeSerializedMarkdown(fenced))
            .toBe(['~~~', String.raw`inside \~ code fence`, '~~~', 'after ~ fence'].join('\n'));
        expect(normalizeSerializedMarkdown('code `a\\~b` and text \\~ ok'))
            .toBe('code `a\\~b` and text ~ ok');
        expect(normalizeSerializedMarkdown('code `` a \\~ b ` `` and text \\~ ok'))
            .toBe('code `` a \\~ b ` `` and text ~ ok');
        expect(normalizeSerializedMarkdown('code ``a\\~\nb`` and text \\~ ok'))
            .toBe('code ``a\\~\nb`` and text ~ ok');
    });

    it('does not create new double-tilde delimiters or remove escaped backslashes', () => {
        expect(normalizeSerializedMarkdown(String.raw`\~\~not strike`)).toBe(String.raw`~\~not strike`);
        expect(normalizeSerializedMarkdown(String.raw`literal backslash \\~ stays`))
            .toBe(String.raw`literal backslash \\~ stays`);
    });

    it('keeps existing table and hard break normalizations', () => {
        expect(normalizeSerializedMarkdown('| \\# A | 1\\. item |')).toBe('| # A | 1. item |');
        expect(normalizeSerializedMarkdown('line\\\nnext')).toBe('line\nnext');
    });

    it('restores raw HTML comments, tags, and comparison brackets from rich text serialization', () => {
        expect(normalizeSerializedMarkdown('&lt;!-- skip --&gt;')).toBe('<!-- skip -->');
        expect(normalizeSerializedMarkdown('&lt;div class=&quot;note&quot; data-x=&quot;1&quot;&gt;x&lt;/div&gt;'))
            .toBe('<div class="note" data-x="1">x</div>');
        expect(normalizeSerializedMarkdown('a &lt; b &gt; c')).toBe('a < b > c');
    });

    it('restores footnote markers without touching code spans or fences', () => {
        const fenced = [
            '```md',
            '&lt;div&gt;x&lt;/div&gt;',
            String.raw`text\[^1\]`,
            '```',
            '&lt;section&gt;y&lt;/section&gt;',
            String.raw`text\[^1\]`,
            '`&lt;span&gt;z&lt;/span&gt;`',
        ].join('\n');

        expect(normalizeSerializedMarkdown(fenced)).toBe([
            '```md',
            '&lt;div&gt;x&lt;/div&gt;',
            String.raw`text\[^1\]`,
            '```',
            '<section>y</section>',
            'text[^1]',
            '`&lt;span&gt;z&lt;/span&gt;`',
        ].join('\n'));
    });

    it('restores escaped HTML in table serialization output without enabling preview rendering', () => {
        expect(normalizeSerializedMarkdown('| A | B |\n| --- | --- |\n| &lt;span&gt;x&lt;/span&gt; | a &lt; b |'))
            .toBe('| A | B |\n| --- | --- |\n| <span>x</span> | a < b |');
        expect(normalizeSerializedMarkdown(
            '&lt;table&gt;\n&lt;tr&gt;&lt;td colspan=&quot;2&quot;&gt;X&lt;/td&gt;&lt;/tr&gt;\n&lt;/table&gt;',
        )).toBe('<table>\n<tr><td colspan="2">X</td></tr>\n</table>');
    });

    it('does not treat escaped greater-than signs inside tag attributes as tag endings', () => {
        expect(normalizeSerializedMarkdown('&lt;span title=&quot;a &gt; b&quot;&gt;x&lt;/span&gt;'))
            .toBe('<span title="a > b">x</span>');
        expect(normalizeSerializedMarkdown('&lt;span title=&quot;a &lt; b &gt; c&quot; data-x=&#39;1 &gt; 0&#39;&gt;x&lt;/span&gt;'))
            .toBe('<span title="a < b > c" data-x=\'1 > 0\'>x</span>');
    });

    it('does not turn line-leading escaped greater-than text into blockquotes', () => {
        expect(normalizeSerializedMarkdown('&gt; note')).toBe('&gt; note');
        expect(normalizeSerializedMarkdown('  &gt; note')).toBe('  &gt; note');
        expect(normalizeSerializedMarkdown('a &gt; b')).toBe('a > b');
        expect(normalizeSerializedMarkdown('| A |\n| --- |\n| a &gt; b |')).toBe('| A |\n| --- |\n| a > b |');
    });

    it('requires a real tag boundary before restoring escaped HTML tags', () => {
        expect(normalizeSerializedMarkdown('&lt;https://example.com&gt;')).toBe('&lt;https://example.com&gt;');
        expect(normalizeSerializedMarkdown('&lt;user@example.com&gt;')).toBe('&lt;user@example.com&gt;');
        expect(normalizeSerializedMarkdown('&lt;custom-element data-x=&quot;1&quot;&gt;x&lt;/custom-element&gt;'))
            .toBe('<custom-element data-x="1">x</custom-element>');
    });
});
