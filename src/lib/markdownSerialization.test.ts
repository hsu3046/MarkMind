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
});
