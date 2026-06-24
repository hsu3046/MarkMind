const HTML_ENTITY_MAP: Record<string, string> = {
  amp: '&',
  apos: "'",
  colon: ':',
  gt: '>',
  lt: '<',
  newline: '\n',
  quot: '"',
  tab: '\t',
};

export function decodeHtmlAttributeValue(value: string): string {
  const codePointToString = (codePoint: number, fallback: string) =>
    Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
      ? String.fromCodePoint(codePoint)
      : fallback;
  return value.replace(/&(#x[0-9a-f]+;?|#\d+;?|[a-z][a-z0-9]+;?)/gi, (entity, body: string) => {
    const clean = body.endsWith(';') ? body.slice(0, -1) : body;
    if (clean.toLowerCase().startsWith('#x')) {
      const codePoint = Number.parseInt(clean.slice(2), 16);
      return Number.isFinite(codePoint) ? codePointToString(codePoint, entity) : entity;
    }
    if (clean.startsWith('#')) {
      const codePoint = Number.parseInt(clean.slice(1), 10);
      return Number.isFinite(codePoint) ? codePointToString(codePoint, entity) : entity;
    }
    return HTML_ENTITY_MAP[clean] ?? HTML_ENTITY_MAP[clean.toLowerCase()] ?? entity;
  });
}

function unquoteAttributeValue(raw: string): string {
  const trimmed = raw.trim();
  const quote = trimmed[0];
  if ((quote === '"' || quote === "'") && trimmed.endsWith(quote)) return trimmed.slice(1, -1);
  return trimmed;
}

export function compactDecodedHtmlUrl(rawValue: string): string {
  return decodeHtmlAttributeValue(unquoteAttributeValue(rawValue)).replace(/[\u0000-\u001f\u007f\s]+/g, '');
}

export function hasDangerousUrlScheme(rawValue: string): boolean {
  const normalized = compactDecodedHtmlUrl(rawValue).toLowerCase();
  return normalized.startsWith('javascript:') || normalized.startsWith('vbscript:');
}

export function normalizeRuntimeScriptSrc(src: string): string {
  return compactDecodedHtmlUrl(src).split(/[?#]/, 1)[0]?.replace(/\\/g, '/') ?? '';
}
