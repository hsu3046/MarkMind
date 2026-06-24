import { isLocalAbsolutePath, resolveCollision, sanitizeFileName } from '../imageAttach';
import { resolveRelativePath } from '../imageSrc';
import { decodeHtmlAttributeValue } from './htmlUrlSafety';

export interface HtmlSourceImageRebaseDeps {
  mkdir: (path: string, opts: { recursive: boolean }) => Promise<unknown>;
  copyFile: (src: string, dest: string) => Promise<unknown>;
  exists: (path: string) => Promise<boolean>;
}

export interface HtmlSourceImageRebaseResult {
  html: string;
  copied: number;
  rewritten: number;
}

const IMAGE_SRC_RE = /(<(?:img|source)\b[^>]*\bsrc\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const CSS_URL_RE = /(url\(\s*)(?:"([^"]*)"|'([^']*)'|([^'")\s]+))(\s*\))/gi;
const STYLE_TAG_RE = /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi;
const STYLE_ATTR_RE = /(\bstyle\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const MARKDOWN_IMAGE_RE = /!\[[^\]]*]\(([^)]+)\)/g;
const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|svg|avif|bmp|ico)(?:[?#].*)?$/i;
const PASS_THROUGH_URL_RE = /^(?:https?:|data:|blob:|asset:|tauri:|mailto:|#|javascript:|vbscript:|markmind-asset:)/i;

function parentDirFromPath(path: string): string {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  if (idx < 0) return '';
  if (idx === 0) return path[0] ?? '';
  return path.slice(0, idx);
}

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() || 'image';
}

function deckStemFromPath(path: string): string {
  return sanitizeFileName(fileNameFromPath(path).replace(/\.html?$/i, '') || 'deck');
}

function joinPath(parent: string, child: string): string {
  if (!parent) return child;
  return `${parent.replace(/[\\/]+$/, '')}/${child}`;
}

function safeDecodeUri(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

function fileUrlToPath(value: string): string | null {
  if (!/^file:/i.test(value)) return null;
  try {
    const url = new URL(value);
    return decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
}

function splitPathSuffix(value: string): { path: string; suffix: string } {
  const match = value.match(/^([^?#]*)([?#].*)?$/s);
  return { path: match?.[1] ?? value, suffix: match?.[2] ?? '' };
}

function sourceDirFromPath(path?: string | null): string | null {
  if (!path) return null;
  const dir = parentDirFromPath(path);
  return dir || null;
}

function localSourcePathCandidates(rawValue: string, sourceDocDir: string | null, requireImageExt: boolean): string[] {
  const decoded = decodeHtmlAttributeValue(rawValue).trim();
  if (!decoded || decoded.startsWith('{{') || PASS_THROUGH_URL_RE.test(decoded)) return [];

  const fileUrlPath = fileUrlToPath(decoded);
  const { path } = splitPathSuffix(fileUrlPath ?? decoded);
  if (!path) return [];

  const candidates = [safeDecodeUri(path), path].filter((candidate, index, all) => candidate && all.indexOf(candidate) === index);
  const resolved: string[] = [];
  for (const candidate of candidates) {
    if (requireImageExt && !IMAGE_EXT_RE.test(candidate)) continue;
    if (isLocalAbsolutePath(candidate)) {
      resolved.push(candidate);
      continue;
    }
    if (!sourceDocDir || candidate.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(candidate)) continue;
    resolved.push(resolveRelativePath(candidate, sourceDocDir));
  }
  return resolved.filter((candidate, index, all) => all.indexOf(candidate) === index);
}

function maskCodeFences(content: string): string {
  const lines = content.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const open = lines[i].match(/^[ ]{0,3}(([`~])\2{2,})/);
    if (open) {
      const ch = open[2];
      const minLen = open[1].length;
      const closeRe = new RegExp(`^[ ]{0,3}${ch === '`' ? '`' : '~'}{${minLen},}[ \\t]*$`);
      i += 1;
      while (i < lines.length && !closeRe.test(lines[i])) i += 1;
      if (i < lines.length) i += 1;
      out.push('');
      continue;
    }
    out.push(lines[i]);
    i += 1;
  }
  return out.join('\n');
}

function markdownImageDestination(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('<')) {
    const end = trimmed.indexOf('>');
    return end >= 0 ? trimmed.slice(1, end).trim() : trimmed;
  }
  const titleMatch = trimmed.match(/^(\S+)(?:\s+["'][\s\S]*["'])$/);
  return (titleMatch?.[1] ?? trimmed).trim();
}

function collectKnownSourceImagePaths(sourceMarkdown: string | null | undefined, sourceDocDir: string | null): Set<string> {
  const known = new Set<string>();
  if (!sourceMarkdown || !sourceDocDir) return known;
  const markdown = maskCodeFences(sourceMarkdown);
  for (const match of markdown.matchAll(MARKDOWN_IMAGE_RE)) {
    const raw = markdownImageDestination(match[1] ?? '');
    for (const candidate of localSourcePathCandidates(raw, sourceDocDir, true)) {
      known.add(candidate);
    }
  }
  for (const match of markdown.matchAll(IMAGE_SRC_RE)) {
    const raw = match[2] ?? match[3] ?? match[4] ?? '';
    for (const candidate of localSourcePathCandidates(raw, sourceDocDir, true)) {
      known.add(candidate);
    }
  }
  return known;
}

function htmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function cssString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\A ');
}

async function defaultDeps(): Promise<HtmlSourceImageRebaseDeps> {
  const fs = await import('@tauri-apps/plugin-fs');
  return {
    mkdir: (path, opts) => fs.mkdir(path, opts),
    copyFile: (src, dest) => fs.copyFile(src, dest),
    exists: (path) => fs.exists(path),
  };
}

function addRawCandidates(rawToCandidates: Map<string, string[]>, raw: string, candidates: string[]): void {
  if (candidates.length === 0) return;
  const existing = rawToCandidates.get(raw) ?? [];
  rawToCandidates.set(
    raw,
    [...existing, ...candidates].filter((candidate, index, all) => all.indexOf(candidate) === index),
  );
}

function collectCssUrlCandidates(css: string, sourceDocDir: string | null, rawToCandidates: Map<string, string[]>): void {
  for (const match of css.matchAll(CSS_URL_RE)) {
    const raw = match[2] ?? match[3] ?? match[4] ?? '';
    addRawCandidates(rawToCandidates, raw, localSourcePathCandidates(raw, sourceDocDir, true));
  }
}

function collectStyleContextCssUrlCandidates(html: string, sourceDocDir: string | null, rawToCandidates: Map<string, string[]>): void {
  for (const match of html.matchAll(STYLE_TAG_RE)) {
    collectCssUrlCandidates(match[2] ?? '', sourceDocDir, rawToCandidates);
  }
  for (const match of html.matchAll(STYLE_ATTR_RE)) {
    collectCssUrlCandidates(match[2] ?? match[3] ?? match[4] ?? '', sourceDocDir, rawToCandidates);
  }
}

async function firstExistingPath(candidates: string[], exists: (path: string) => Promise<boolean>): Promise<string | null> {
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  return null;
}

function replaceImageSrcs(
  html: string,
  rawToSource: Map<string, string>,
  sourceToRel: Map<string, string>,
): { html: string; rewritten: number } {
  let rewritten = 0;
  const nextHtml = html.replace(IMAGE_SRC_RE, (full, prefix, doubleQuoted, singleQuoted, bare) => {
    const raw = doubleQuoted ?? singleQuoted ?? bare ?? '';
    const sourcePath = rawToSource.get(raw);
    const rel = sourcePath ? sourceToRel.get(sourcePath) : undefined;
    if (!rel) return full;
    rewritten += 1;
    return `${prefix}"${htmlAttr(rel)}"`;
  });
  return { html: nextHtml, rewritten };
}

function replaceCssUrls(
  css: string,
  rawToSource: Map<string, string>,
  sourceToRel: Map<string, string>,
): { css: string; rewritten: number } {
  let rewritten = 0;
  const nextCss = css.replace(CSS_URL_RE, (full, prefix, doubleQuoted, singleQuoted, bare, suffix) => {
    const raw = doubleQuoted ?? singleQuoted ?? bare ?? '';
    const sourcePath = rawToSource.get(raw);
    const rel = sourcePath ? sourceToRel.get(sourcePath) : undefined;
    if (!rel) return full;
    rewritten += 1;
    return `${prefix}"${cssString(rel)}"${suffix}`;
  });
  return { css: nextCss, rewritten };
}

function replaceStyleContextCssUrls(
  html: string,
  rawToSource: Map<string, string>,
  sourceToRel: Map<string, string>,
): { html: string; rewritten: number } {
  let rewritten = 0;
  let nextHtml = html.replace(STYLE_TAG_RE, (full, open, css, close) => {
    const replaced = replaceCssUrls(css, rawToSource, sourceToRel);
    rewritten += replaced.rewritten;
    return replaced.rewritten > 0 ? `${open}${replaced.css}${close}` : full;
  });
  nextHtml = nextHtml.replace(STYLE_ATTR_RE, (full, prefix, doubleQuoted, singleQuoted, bare) => {
    const css = doubleQuoted ?? singleQuoted ?? bare ?? '';
    const replaced = replaceCssUrls(css, rawToSource, sourceToRel);
    if (replaced.rewritten === 0) return full;
    rewritten += replaced.rewritten;
    return `${prefix}"${htmlAttr(replaced.css)}"`;
  });
  return { html: nextHtml, rewritten };
}

export async function rebaseHtmlSourceImageReferences(
  html: string,
  {
    sourceDocPath,
    sourceMarkdown,
    htmlPath,
    deps,
  }: {
    sourceDocPath?: string | null;
    sourceMarkdown?: string | null;
    htmlPath: string;
    deps?: HtmlSourceImageRebaseDeps;
  },
): Promise<HtmlSourceImageRebaseResult> {
  const sourceDocDir = sourceDirFromPath(sourceDocPath);
  const knownSourceImages = collectKnownSourceImagePaths(sourceMarkdown, sourceDocDir);
  if (knownSourceImages.size === 0) return { html, copied: 0, rewritten: 0 };
  const htmlDir = parentDirFromPath(htmlPath);
  const bundleDirName = `${deckStemFromPath(htmlPath)}.assets`;
  const targetRelDir = `${bundleDirName}/source`;
  const targetDir = joinPath(joinPath(htmlDir, bundleDirName), 'source');
  const rawToCandidates = new Map<string, string[]>();

  for (const match of html.matchAll(IMAGE_SRC_RE)) {
    const raw = match[2] ?? match[3] ?? match[4] ?? '';
    addRawCandidates(rawToCandidates, raw, localSourcePathCandidates(raw, sourceDocDir, false));
  }
  collectStyleContextCssUrlCandidates(html, sourceDocDir, rawToCandidates);

  if (rawToCandidates.size === 0) return { html, copied: 0, rewritten: 0 };

  const d = deps ?? (await defaultDeps());
  const rawToSource = new Map<string, string>();
  const sourceToRel = new Map<string, string>();
  let copied = 0;
  let mkdirDone = false;

  for (const [raw, candidates] of rawToCandidates) {
    const sourcePath = await firstExistingPath(
      candidates.filter((candidate) => knownSourceImages.has(candidate)),
      d.exists,
    );
    if (!sourcePath) continue;
    rawToSource.set(raw, sourcePath);
    if (sourceToRel.has(sourcePath)) continue;

    if (sourcePath.startsWith(`${targetDir}/`)) {
      sourceToRel.set(sourcePath, `${targetRelDir}/${sourcePath.slice(targetDir.length + 1)}`);
      continue;
    }

    if (!mkdirDone) {
      await d.mkdir(targetDir, { recursive: true });
      mkdirDone = true;
    }
    const desired = sanitizeFileName(fileNameFromPath(sourcePath));
    const name = await resolveCollision(targetDir, desired, d.exists);
    await d.copyFile(sourcePath, joinPath(targetDir, name));
    sourceToRel.set(sourcePath, `${targetRelDir}/${name}`);
    copied += 1;
  }

  if (sourceToRel.size === 0) return { html, copied: 0, rewritten: 0 };

  const imageRebase = replaceImageSrcs(html, rawToSource, sourceToRel);
  const cssRebase = replaceStyleContextCssUrls(imageRebase.html, rawToSource, sourceToRel);
  const rebased = cssRebase.html;
  const rewritten = imageRebase.rewritten + cssRebase.rewritten;

  return { html: rebased, copied, rewritten };
}
