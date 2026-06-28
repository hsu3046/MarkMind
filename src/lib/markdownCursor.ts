function stripLinePrefixInfo(line: string): { text: string; prefixLength: number } {
  let out = line;
  let prefixLength = 0;
  while (true) {
    const quote = out.match(/^[ \t]{0,3}>[ \t]?/);
    if (!quote) break;
    prefixLength += quote[0].length;
    out = out.slice(quote[0].length);
  }

  const heading = out.match(/^[ \t]{0,3}#{1,6}[ \t]+/);
  if (heading) {
    prefixLength += heading[0].length;
    out = out.slice(heading[0].length);
  }

  const list = out.match(/^[ \t]*(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/);
  if (list) {
    prefixLength += list[0].length;
    out = out.slice(list[0].length);
  }

  return { text: out, prefixLength };
}

function matchingBracket(src: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let i = start; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === open) depth += 1;
    if (ch === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function destinationEnd(src: string, openParen: number): number {
  let depth = 0;
  for (let i = openParen; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === '(') depth += 1;
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function isWhitespace(ch: string | undefined): boolean {
  return ch == null || /\s/.test(ch);
}

function isPunctuation(ch: string | undefined): boolean {
  return ch != null && /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(ch);
}

function isEscaped(src: string, index: number): boolean {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && src[i] === '\\'; i -= 1) backslashes += 1;
  return backslashes % 2 === 1;
}

function delimiterRunAt(src: string, index: number): { char: string; start: number; length: number } | null {
  const char = src[index];
  if (char !== '*' && char !== '_' && char !== '~') return null;
  let start = index;
  while (start > 0 && src[start - 1] === char) start -= 1;
  let end = index + 1;
  while (end < src.length && src[end] === char) end += 1;
  return { char, start, length: end - start };
}

function delimiterCanOpen(src: string, run: { char: string; start: number; length: number }): boolean {
  if (isEscaped(src, run.start)) return false;
  if (run.char === '~' && run.length < 2) return false;
  const before = run.start > 0 ? src[run.start - 1] : undefined;
  const after = src[run.start + run.length];
  if (after == null || isWhitespace(after)) return false;
  const leftFlanking = !isPunctuation(after) || before == null || isWhitespace(before) || isPunctuation(before);
  if (!leftFlanking) return false;
  if (run.char === '_') {
    const rightFlanking = before != null
      && !isWhitespace(before)
      && (!isPunctuation(before) || after == null || isWhitespace(after) || isPunctuation(after));
    return !rightFlanking || isPunctuation(before);
  }
  return true;
}

function delimiterCanClose(src: string, run: { char: string; start: number; length: number }): boolean {
  if (isEscaped(src, run.start)) return false;
  if (run.char === '~' && run.length < 2) return false;
  const before = run.start > 0 ? src[run.start - 1] : undefined;
  const after = src[run.start + run.length];
  if (before == null || isWhitespace(before)) return false;
  const rightFlanking = !isPunctuation(before) || after == null || isWhitespace(after) || isPunctuation(after);
  if (!rightFlanking) return false;
  if (run.char === '_') {
    const leftFlanking = after != null
      && !isWhitespace(after)
      && (!isPunctuation(after) || before == null || isWhitespace(before) || isPunctuation(before));
    return !leftFlanking || isPunctuation(after);
  }
  return true;
}

function hasClosingDelimiter(src: string, run: { char: string; start: number; length: number }): boolean {
  for (let i = run.start + run.length; i < src.length; i += 1) {
    if (src[i] !== run.char || isEscaped(src, i)) continue;
    const candidate = delimiterRunAt(src, i);
    if (!candidate) continue;
    i = candidate.start + candidate.length - 1;
    if (candidate.length >= run.length && delimiterCanClose(src, candidate)) return true;
  }
  return false;
}

function hasOpeningDelimiter(src: string, run: { char: string; start: number; length: number }): boolean {
  for (let i = run.start - 1; i >= 0; i -= 1) {
    if (src[i] !== run.char || isEscaped(src, i)) continue;
    const candidate = delimiterRunAt(src, i);
    if (!candidate) continue;
    i = candidate.start;
    if (candidate.length >= run.length && delimiterCanOpen(src, candidate)) return true;
  }
  return false;
}

function isHiddenEmphasisDelimiter(src: string, index: number): boolean {
  const run = delimiterRunAt(src, index);
  if (!run) return false;
  return (delimiterCanOpen(src, run) && hasClosingDelimiter(src, run))
    || (delimiterCanClose(src, run) && hasOpeningDelimiter(src, run));
}

function isHiddenLineBlockPosition(markdown: string, index: number): boolean {
  const lineStart = markdown.lastIndexOf('\n', Math.max(0, index - 1)) + 1;
  const nextLf = markdown.indexOf('\n', lineStart);
  const rawLineEnd = nextLf === -1 ? markdown.length : nextLf;
  const lineEnd = rawLineEnd > lineStart && markdown[rawLineEnd - 1] === '\r' ? rawLineEnd - 1 : rawLineEnd;
  if (index < lineStart || index >= lineEnd) return false;

  const line = markdown.slice(lineStart, lineEnd);
  if (isThematicBreak(line)) return true;

  const { prefixLength } = stripLinePrefixInfo(line);
  return index - lineStart < prefixLength;
}

function inlineVisibleText(src: string): string {
  let out = '';
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];

    if (ch === '\\' && i + 1 < src.length) {
      out += src[i + 1];
      i += 1;
      continue;
    }

    if (ch === '!' && src[i + 1] === '[') {
      const close = matchingBracket(src, i + 1, '[', ']');
      if (close >= 0 && src[close + 1] === '(') {
        const end = destinationEnd(src, close + 1);
        if (end >= 0) {
          i = end;
          continue;
        }
      }
    }

    if (ch === '[') {
      const close = matchingBracket(src, i, '[', ']');
      if (close >= 0 && src[close + 1] === '(') {
        const end = destinationEnd(src, close + 1);
        if (end >= 0) {
          out += inlineVisibleText(src.slice(i + 1, close));
          i = end;
          continue;
        }
      }
    }

    if (ch === '`') {
      let ticks = 1;
      while (src[i + ticks] === '`') ticks += 1;
      const marker = '`'.repeat(ticks);
      const end = src.indexOf(marker, i + ticks);
      if (end >= 0) {
        out += src.slice(i + ticks, end);
        i = end + ticks - 1;
        continue;
      }
      i += ticks - 1;
      continue;
    }

    if ((ch === '*' || ch === '_' || ch === '~') && isHiddenEmphasisDelimiter(src, i)) {
      while (src[i + 1] === ch) i += 1;
      continue;
    }

    out += ch;
  }
  return out.replace(/\u200b/g, '');
}

function inlineVisibleLengthBefore(src: string, col: number): number {
  const limit = Math.max(0, Math.min(col, src.length));
  let len = 0;

  for (let i = 0; i < src.length; i += 1) {
    if (i >= limit) break;
    const ch = src[i];

    if (ch === '\\' && i + 1 < src.length) {
      if (limit > i + 1) len += 1;
      i += 1;
      continue;
    }

    if (ch === '!' && src[i + 1] === '[') {
      const close = matchingBracket(src, i + 1, '[', ']');
      if (close >= 0 && src[close + 1] === '(') {
        const end = destinationEnd(src, close + 1);
        if (end >= 0) {
          i = end;
          continue;
        }
      }
    }

    if (ch === '[') {
      const close = matchingBracket(src, i, '[', ']');
      if (close >= 0 && src[close + 1] === '(') {
        const end = destinationEnd(src, close + 1);
        if (end >= 0) {
          const textStart = i + 1;
          if (limit > textStart) {
            const label = src.slice(textStart, close);
            len += limit < close
              ? inlineVisibleLengthBefore(label, limit - textStart)
              : inlineVisibleText(label).length;
          }
          i = end;
          continue;
        }
      }
    }

    if (ch === '`') {
      let ticks = 1;
      while (src[i + ticks] === '`') ticks += 1;
      const marker = '`'.repeat(ticks);
      const end = src.indexOf(marker, i + ticks);
      if (end >= 0) {
        const textStart = i + ticks;
        if (limit > textStart) len += Math.min(limit, end) - textStart;
        i = end + ticks - 1;
        continue;
      }
      i += ticks - 1;
      continue;
    }

    if ((ch === '*' || ch === '_' || ch === '~') && isHiddenEmphasisDelimiter(src, i)) {
      while (src[i + 1] === ch) i += 1;
      continue;
    }

    len += 1;
  }

  return len;
}

function isSkippableMarkdownSyntax(markdown: string, index: number): boolean {
  const ch = markdown[index];
  if (!ch) return false;
  if (ch === '*' || ch === '_' || ch === '~') return isHiddenLineBlockPosition(markdown, index) || isHiddenEmphasisDelimiter(markdown, index);
  if ('#>-+![]()` '.includes(ch)) return true;
  if (ch === '\t') return true;
  if (/\d/.test(ch)) {
    const rest = markdown.slice(index);
    return /^\d+[.)][ \t]+/.test(rest);
  }
  if (ch === '.' || ch === ')') {
    const before = markdown.slice(0, index);
    return /\d+$/.test(before);
  }
  return false;
}

interface VisibleLine {
  sourceStart: number;
  sourceEnd: number;
  visibleStart: number;
  visible: string;
  raw: string;
  prefixLength: number;
  inFence: boolean;
  visibleLengthBefore?: (col: number) => number;
}

interface SourceLine {
  text: string;
  start: number;
  end: number;
  nextStart: number;
}

interface TableCell {
  raw: string;
  start: number;
  end: number;
}

function splitSourceLines(markdown: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  let i = 0;

  while (i < markdown.length) {
    const ch = markdown[i];
    if (ch !== '\n' && ch !== '\r') {
      i += 1;
      continue;
    }

    const end = i;
    const nextStart = ch === '\r' && markdown[i + 1] === '\n' ? i + 2 : i + 1;
    lines.push({
      text: markdown.slice(start, end),
      start,
      end,
      nextStart,
    });
    start = nextStart;
    i = nextStart;
  }

  lines.push({
    text: markdown.slice(start),
    start,
    end: markdown.length,
    nextStart: markdown.length,
  });
  return lines;
}

function trimCell(line: string, start: number, end: number): TableCell {
  let cellStart = start;
  let cellEnd = end;
  while (cellStart < cellEnd && /[ \t]/.test(line[cellStart])) cellStart += 1;
  while (cellEnd > cellStart && /[ \t]/.test(line[cellEnd - 1])) cellEnd -= 1;
  return {
    raw: line.slice(cellStart, cellEnd),
    start: cellStart,
    end: cellEnd,
  };
}

function splitTableCells(line: string): TableCell[] | null {
  const pipeIndexes: number[] = [];
  let ticks = 0;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === '`') {
      let count = 1;
      while (line[i + count] === '`') count += 1;
      ticks = ticks === count ? 0 : ticks || count;
      i += count - 1;
      continue;
    }
    if (ch === '|' && ticks === 0) pipeIndexes.push(i);
  }

  if (pipeIndexes.length === 0) return null;

  const firstNonSpace = line.search(/\S/);
  if (firstNonSpace === -1) return null;
  const lastNonSpace = line.search(/\s*$/) - 1;
  const hasLeadingPipe = pipeIndexes[0] === firstNonSpace;
  const hasTrailingPipe = pipeIndexes[pipeIndexes.length - 1] === lastNonSpace;
  const cells: TableCell[] = [];

  if (hasLeadingPipe) {
    const lastIndex = hasTrailingPipe ? pipeIndexes.length - 1 : pipeIndexes.length;
    for (let i = 0; i < lastIndex; i += 1) {
      const start = pipeIndexes[i] + 1;
      const end = i + 1 < pipeIndexes.length ? pipeIndexes[i + 1] : line.length;
      cells.push(trimCell(line, start, end));
    }
  } else {
    let start = 0;
    const lastIndex = hasTrailingPipe ? pipeIndexes.length - 1 : pipeIndexes.length;
    for (let i = 0; i < lastIndex; i += 1) {
      cells.push(trimCell(line, start, pipeIndexes[i]));
      start = pipeIndexes[i] + 1;
    }
    if (!hasTrailingPipe) cells.push(trimCell(line, start, line.length));
  }

  return cells.length > 1 ? cells : null;
}

function isTableDelimiterLine(line: string): boolean {
  const cells = splitTableCells(line);
  return Boolean(cells?.length && cells.every((cell) => /^:?-+:?$/.test(cell.raw.trim())));
}

function isExplicitEmptyParagraph(line: string): boolean {
  const trimmed = line.trim();
  return trimmed === '&nbsp;' || trimmed === '\u00a0';
}

function isThematicBreak(line: string): boolean {
  const trimmed = line.trim();
  return /^(\*[ \t]*){3,}$/.test(trimmed)
    || /^(-[ \t]*){3,}$/.test(trimmed)
    || /^(_[ \t]*){3,}$/.test(trimmed);
}

function decodeHtmlEntity(entity: string): string {
  if (entity === 'amp') return '&';
  if (entity === 'lt') return '<';
  if (entity === 'gt') return '>';
  if (entity === 'quot') return '"';
  if (entity === '#39' || entity === 'apos') return "'";
  if (entity === 'nbsp') return ' ';
  if (/^#\d+$/.test(entity)) return String.fromCodePoint(Number(entity.slice(1)));
  if (/^#x[\da-f]+$/i.test(entity)) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
  return `&${entity};`;
}

function htmlVisibleText(src: string): string {
  let out = '';
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '<') {
      const end = src.indexOf('>', i + 1);
      if (end === -1) {
        out += ch;
        continue;
      }
      const tag = src.slice(i + 1, end).trim().toLowerCase();
      if (tag.startsWith('br') || /^\/(?:p|div|li|h[1-6])\b/.test(tag)) out += '\n';
      i = end;
      continue;
    }
    if (ch === '&') {
      const end = src.indexOf(';', i + 1);
      if (end > i && end - i <= 12) {
        out += decodeHtmlEntity(src.slice(i + 1, end));
        i = end;
        continue;
      }
    }
    out += ch;
  }
  return out.replace(/\n+$/g, '');
}

function htmlVisibleLengthBefore(src: string, col: number): number {
  return htmlVisibleText(src.slice(0, Math.max(0, Math.min(col, src.length)))).length;
}

function visibleLines(markdown: string): { lines: VisibleLine[]; total: number } {
  const sourceLines = splitSourceLines(markdown);
  const out: VisibleLine[] = [];
  let inFence = false;
  let fenceChar: '`' | '~' | null = null;
  let fenceLen = 0;
  let total = 0;

  const pushLine = (
    sourceLineStart: number,
    raw: string,
    sourceStartInLine: number,
    sourceEndInLine: number,
    visible: string,
    prefixLength = 0,
    inFenceLine = false,
    visibleLengthBefore?: (col: number) => number,
  ) => {
    const visibleStart = out.length > 0 ? total + 1 : total;
    total = visibleStart + visible.length;
    out.push({
      sourceStart: sourceLineStart + sourceStartInLine,
      sourceEnd: sourceLineStart + sourceEndInLine,
      visibleStart,
      visible,
      raw,
      prefixLength,
      inFence: inFenceLine,
      visibleLengthBefore,
    });
  };

  for (let i = 0; i < sourceLines.length; i += 1) {
    const sourceLine = sourceLines[i];
    const line = sourceLine.text;
    const fence = line.match(/^[ ]{0,3}(([`~])\2{2,})/);
    if (fence && (!inFence || (fence[2] === fenceChar && fence[1].length >= fenceLen))) {
      if (!inFence) {
        inFence = true;
        fenceChar = fence[2] as '`' | '~';
        fenceLen = fence[1].length;
      } else {
        inFence = false;
        fenceChar = null;
        fenceLen = 0;
      }
      continue;
    }

    if (!inFence) {
      const nextLine = sourceLines[i + 1];
      if (nextLine != null && splitTableCells(line) && isTableDelimiterLine(nextLine.text)) {
        let tableLineIndex = i;
        while (tableLineIndex < sourceLines.length) {
          const tableSourceLine = sourceLines[tableLineIndex];
          const tableLine = tableSourceLine.text;
          const cells = splitTableCells(tableLine);
          if (!cells) break;
          if (!isTableDelimiterLine(tableLine)) {
            for (const cell of cells) {
              pushLine(
                tableSourceLine.start,
                cell.raw,
                cell.start,
                cell.end,
                inlineVisibleText(cell.raw),
              );
            }
          }
          tableLineIndex += 1;
        }
        i = tableLineIndex - 1;
        continue;
      }
    }

    if (!inFence && /^[ \t]*<table[\s>]/i.test(line)) {
      let closeLineIndex = -1;
      for (let tableLineIndex = i; tableLineIndex < sourceLines.length; tableLineIndex += 1) {
        if (/<\/table>[ \t]*$/i.test(sourceLines[tableLineIndex].text)) {
          closeLineIndex = tableLineIndex;
          break;
        }
      }
      if (closeLineIndex >= 0) {
        const blockStart = sourceLine.start;
        const blockEnd = sourceLines[closeLineIndex].end;
        const block = markdown.slice(blockStart, blockEnd);
        const cellRe = /<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
        let matched = false;
        let match: RegExpExecArray | null;
        while ((match = cellRe.exec(block))) {
          matched = true;
          const openEnd = match[0].indexOf('>') + 1;
          const inner = match[1];
          const innerStart = match.index + openEnd;
          pushLine(
            0,
            inner,
            blockStart + innerStart,
            blockStart + innerStart + inner.length,
            htmlVisibleText(inner),
            0,
            false,
            (col) => htmlVisibleLengthBefore(inner, col),
          );
        }
        if (matched) {
          i = closeLineIndex;
          continue;
        }
      }
    }

    if (!inFence && line.trim() === '') {
      continue;
    }

    if (!inFence && isThematicBreak(line)) {
      continue;
    }

    if (!inFence && isExplicitEmptyParagraph(line)) {
      pushLine(sourceLine.start, line, 0, line.length, '');
      continue;
    }

    const { text, prefixLength } = inFence
      ? { text: line, prefixLength: 0 }
      : stripLinePrefixInfo(line);
    const visible = inFence ? text : inlineVisibleText(text);
    pushLine(sourceLine.start, line, 0, line.length, visible, prefixLength, inFence);
  }

  return { lines: out, total };
}

export function markdownVisibleText(markdown: string): string {
  return visibleLines(markdown).lines.map((line) => line.visible).join('\n');
}

export function markdownOffsetToVisibleOffset(markdown: string, offset: number): number {
  const clamped = Math.max(0, Math.min(offset, markdown.length));
  const { lines, total } = visibleLines(markdown);
  if (lines.length === 0) return 0;

  for (const line of lines) {
    if (clamped <= line.sourceStart) return line.visibleStart;
    if (clamped <= line.sourceEnd) {
      const col = clamped - line.sourceStart;
      if (line.inFence) return line.visibleStart + Math.min(col, line.visible.length);
      if (line.visibleLengthBefore) return line.visibleStart + line.visibleLengthBefore(col);
      const textCol = Math.max(0, col - line.prefixLength);
      const stripped = line.raw.slice(line.prefixLength);
      return line.visibleStart + inlineVisibleLengthBefore(stripped, textCol);
    }
  }

  return total;
}

export function visibleOffsetToMarkdownOffset(markdown: string, visibleOffset: number): number {
  const target = Math.max(0, visibleOffset);
  let lo = 0;
  let hi = markdown.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (markdownOffsetToVisibleOffset(markdown, mid) < target) lo = mid + 1;
    else hi = mid;
  }
  while (lo < markdown.length && markdownOffsetToVisibleOffset(markdown, lo + 1) === target) {
    lo += 1;
  }
  while (
    lo < markdown.length
    && markdownOffsetToVisibleOffset(markdown, lo) === target
    && isSkippableMarkdownSyntax(markdown, lo)
  ) {
    lo += 1;
  }
  return lo;
}
