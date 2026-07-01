import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import MarkdownIt from 'markdown-it';
import { describe, expect, it } from 'vitest';
import { fixEmphasis, stripDisplayHelpers } from './markdownDisplay';

const markdownIt = new MarkdownIt({ html: false });

function renderMarkdown(md: string): string {
  return renderToStaticMarkup(
    React.createElement(
      ReactMarkdown,
      { remarkPlugins: [[remarkGfm, { singleTilde: false }]] },
      md,
    ),
  );
}

describe('markdown display helpers', () => {
  it('fixes bold ending with punctuation before attached Korean text', () => {
    const input = '- 시장의 본질: 진짜 돈은 **pre-training(사전학습)이 아니라 post-training의 인간 전문가 데이터(RLHF·RL 환경·평가)**에 있다.';

    expect(renderMarkdown(input)).toContain('**pre-training');

    const fixed = fixEmphasis(input);
    expect(fixed).toContain(')**&#8203;에');

    const html = renderMarkdown(fixed);
    expect(html).toContain('<strong>pre-training(사전학습)이 아니라 post-training의 인간 전문가 데이터(RLHF·RL 환경·평가)</strong>');
    expect(html).not.toContain('**pre-training');

    const markdownItHtml = markdownIt.render(fixed);
    expect(markdownItHtml).toContain('<strong>pre-training(사전학습)이 아니라 post-training의 인간 전문가 데이터(RLHF·RL 환경·평가)</strong>');
    expect(markdownItHtml).not.toContain('**pre-training');
  });

  it('does not add helpers to bold that already parses without punctuation adjacency', () => {
    expect(fixEmphasis('**bold**에 있다')).toBe('**bold**에 있다');
  });

  it('keeps code spans unchanged', () => {
    expect(fixEmphasis('`**평가)**에`')).toBe('`**평가)**에`');
  });

  it('strips current and legacy display helpers', () => {
    expect(stripDisplayHelpers('a&#8203;b&ZeroWidthSpace;c&#x200B;d\ufeffe\u200bf')).toBe('abcdef');
  });
});
