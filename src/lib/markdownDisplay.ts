// Markdown display-only helpers shared by ReactMarkdown and Tiptap render paths.

const MARKDOWN_EMPHASIS_HELPER = '&#8203;';
const LEGACY_MARKDOWN_EMPHASIS_HELPER = '\u200b';
const DISPLAY_HELPERS_RE = /[\u200b\ufeff]|&(?:#8203|#x200b|ZeroWidthSpace);/gi;
const PUNCTUATION_RE = /\p{P}/u;
const ADJACENT_TEXT_RE = /[^\s*_\p{P}]/u;

export function isMarkdownDisplayHelper(ch: string): boolean {
  return ch === LEGACY_MARKDOWN_EMPHASIS_HELPER || ch === '\ufeff';
}

function isAdjacentText(ch: string | undefined): boolean {
  return !!ch && !isMarkdownDisplayHelper(ch) && ADJACENT_TEXT_RE.test(ch);
}

function codeSpanEnd(md: string, start: number): number {
  const run = md.slice(start).match(/^`+/)?.[0] ?? '`';
  const close = md.indexOf(run, start + run.length);
  return close >= 0 ? close + run.length : start + run.length;
}

/**
 * CommonMark/micromark can reject a closing strong delimiter when the delimiter is
 * preceded by punctuation and followed immediately by text, e.g. `**...평가)**에`.
 * Insert a zero-width-space entity after the closing delimiter so both micromark
 * and markdown-it see a punctuation boundary before rendering it invisibly.
 */
export function fixEmphasis(md: string): string {
  const out: string[] = [];
  const openStack: Record<'**' | '__', number> = { '**': 0, '__': 0 };

  for (let i = 0; i < md.length;) {
    const ch = md[i];

    if (ch === '\\') {
      const next = md[i + 1];
      out.push(next ? md.slice(i, i + 2) : ch);
      i += next ? 2 : 1;
      continue;
    }

    if (ch === '`') {
      const end = codeSpanEnd(md, i);
      out.push(md.slice(i, end));
      i = end;
      continue;
    }

    const delimiter = md.startsWith('**', i) ? '**' : md.startsWith('__', i) ? '__' : null;
    if (!delimiter) {
      out.push(ch);
      i += 1;
      continue;
    }

    const isClosing = openStack[delimiter] > 0;
    out.push(delimiter);
    i += delimiter.length;

    if (isClosing) {
      openStack[delimiter] -= 1;
      const before = md[i - delimiter.length - 1];
      const after = md[i];
      if (PUNCTUATION_RE.test(before ?? '') && isAdjacentText(after)) {
        out.push(MARKDOWN_EMPHASIS_HELPER);
      }
    } else {
      openStack[delimiter] += 1;
    }
  }

  return out.join('');
}

export function stripDisplayHelpers(md: string): string {
  return md.replace(DISPLAY_HELPERS_RE, '');
}
