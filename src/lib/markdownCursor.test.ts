import { describe, expect, it } from 'vitest';
import {
  markdownOffsetToVisibleOffset,
  markdownVisibleText,
  visibleOffsetToMarkdownOffset,
} from './markdownCursor';

describe('markdownCursor', () => {
  it('maps markdown syntax to rendered text offsets', () => {
    const md = ['# Title', '', '- **Alpha** item', '- [x] Done', 'Plain [link](target.md)'].join('\n');
    expect(markdownVisibleText(md)).toBe(['Title', 'Alpha item', 'Done', 'Plain link'].join('\n'));

    const mdOffset = md.indexOf('item');
    const visibleOffset = markdownOffsetToVisibleOffset(md, mdOffset);
    expect(markdownVisibleText(md).slice(visibleOffset, visibleOffset + 4)).toBe('item');
  });

  it('round-trips a visible offset back near the source text', () => {
    const md = ['## Heading', '', 'Paragraph with *emphasis* and [docs](./docs.md).'].join('\n');
    const visible = markdownVisibleText(md);
    const visibleOffset = visible.indexOf('docs');
    const mdOffset = visibleOffsetToMarkdownOffset(md, visibleOffset);
    expect(md.slice(mdOffset, mdOffset + 4)).toBe('docs');
  });

  it('preserves literal marker characters that are not markdown delimiters', () => {
    const md = 'Use foo_bar with 2 * 3 and ~home~ paths, then **bold** and ~~gone~~.';
    expect(markdownVisibleText(md)).toBe('Use foo_bar with 2 * 3 and ~home~ paths, then bold and gone.');

    const underscoreOffset = md.indexOf('_');
    const visibleUnderscore = markdownOffsetToVisibleOffset(md, underscoreOffset);
    expect(markdownVisibleText(md)[visibleUnderscore]).toBe('_');
    expect(visibleOffsetToMarkdownOffset(md, visibleUnderscore)).toBe(underscoreOffset);

    const multiplyOffset = md.indexOf('*');
    const visibleMultiply = markdownOffsetToVisibleOffset(md, multiplyOffset);
    expect(markdownVisibleText(md)[visibleMultiply]).toBe('*');
    expect(visibleOffsetToMarkdownOffset(md, visibleMultiply)).toBe(multiplyOffset);
  });

  it('does not skip visible spaces or punctuation when restoring markdown offsets', () => {
    expect(visibleOffsetToMarkdownOffset('a b', 1)).toBe(1);

    const md = 'Keep [literal] (paren) text';
    const visible = markdownVisibleText(md);
    const bracketOffset = visible.indexOf('[');
    const parenOffset = visible.indexOf('(');
    expect(visibleOffsetToMarkdownOffset(md, bracketOffset)).toBe(md.indexOf('['));
    expect(visibleOffsetToMarkdownOffset(md, parenOffset)).toBe(md.indexOf('('));
  });

  it('keeps fenced code text but ignores fence markers', () => {
    const md = ['Before', '```ts', 'const x = 1;', '```', 'After'].join('\n');
    expect(markdownVisibleText(md)).toBe(['Before', 'const x = 1;', 'After'].join('\n'));
  });

  it('ignores non-text rich nodes while preserving nearby source offsets', () => {
    const md = ['Before', '![diagram](./diagram.png)', '---', 'After'].join('\n');
    expect(markdownVisibleText(md)).toBe(['Before', '', 'After'].join('\n'));

    const afterOffset = md.indexOf('After');
    expect(markdownOffsetToVisibleOffset(md, afterOffset)).toBe('Before\n\n'.length);
  });

  it('collapses markdown blank separators like the rich text document', () => {
    const md = ['First', '', '', 'Second'].join('\n');
    expect(markdownVisibleText(md)).toBe('First\nSecond');

    const secondOffset = md.indexOf('Second');
    const visibleOffset = markdownOffsetToVisibleOffset(md, secondOffset);
    expect(markdownVisibleText(md).slice(visibleOffset, visibleOffset + 6)).toBe('Second');
    expect(visibleOffsetToMarkdownOffset(md, visibleOffset)).toBe(secondOffset);
  });

  it('keeps source offsets stable for CRLF documents', () => {
    const md = ['First', '', 'Second'].join('\r\n');
    expect(markdownVisibleText(md)).toBe('First\nSecond');

    const secondOffset = md.indexOf('Second');
    const visibleOffset = markdownOffsetToVisibleOffset(md, secondOffset);
    expect(visibleOffset).toBe('First\n'.length);
    expect(visibleOffsetToMarkdownOffset(md, visibleOffset)).toBe(secondOffset);
  });

  it('treats explicit empty paragraph markers as empty rich text blocks', () => {
    const md = ['First', '&nbsp;', 'Second'].join('\n');
    expect(markdownVisibleText(md)).toBe('First\n\nSecond');

    const secondOffset = md.indexOf('Second');
    expect(markdownOffsetToVisibleOffset(md, secondOffset)).toBe('First\n\n'.length);
  });

  it('maps GFM table syntax to rich text cell offsets', () => {
    const md = ['Before', '| A | B |', '| --- | --- |', '| 1 | **Two** |', 'After'].join('\n');
    expect(markdownVisibleText(md)).toBe(['Before', 'A', 'B', '1', 'Two', 'After'].join('\n'));

    const twoOffset = md.indexOf('Two');
    const visibleOffset = markdownOffsetToVisibleOffset(md, twoOffset);
    expect(markdownVisibleText(md).slice(visibleOffset, visibleOffset + 3)).toBe('Two');
    expect(md.slice(visibleOffsetToMarkdownOffset(md, visibleOffset), twoOffset + 3)).toContain('Two');
  });

  it('maps HTML table blocks to rich text cell offsets', () => {
    const md = [
      'Before',
      '<table>',
      '<tr><th>A</th><th>B</th></tr>',
      '<tr><td>1</td><td><p>Two</p></td></tr>',
      '</table>',
      'After',
    ].join('\n');
    expect(markdownVisibleText(md)).toBe(['Before', 'A', 'B', '1', 'Two', 'After'].join('\n'));

    const afterOffset = md.indexOf('After');
    expect(markdownOffsetToVisibleOffset(md, afterOffset)).toBe('Before\nA\nB\n1\nTwo\n'.length);
  });
});
