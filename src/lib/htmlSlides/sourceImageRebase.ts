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

function resolveLocalSourcePath(rawValue: string, sourceDocDir: string | null, requireImageExt: boolean): string | null {
  const decoded = decodeHtmlAttributeValue(rawValue).trim();
  if (!decoded || decoded.startsWith('{{') || PASS_THROUGH_URL_RE.test(decoded)) return null;

  const fileUrlPath = fileUrlToPath(decoded);
  const { path } = splitPathSuffix(fileUrlPath ?? decoded);
  if (!path || (requireImageExt && !IMAGE_EXT_RE.test(path))) return null;

  const candidates = [path, safeDecodeUri(path)].filter((candidate, index, all) => candidate && all.indexOf(candidate) === index);
  for (const candidate of candidates) {
    if (isLocalAbsolutePath(candidate)) return candidate;
    if (!sourceDocDir || candidate.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(candidate)) continue;
    return resolveRelativePath(candidate, sourceDocDir);
  }
  return null;
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

export async function rebaseHtmlSourceImageReferences(
  html: string,
  {
    sourceDocPath,
    htmlPath,
    deps,
  }: {
    sourceDocPath?: string | null;
    htmlPath: string;
    deps?: HtmlSourceImageRebaseDeps;
  },
): Promise<HtmlSourceImageRebaseResult> {
  const sourceDocDir = sourceDirFromPath(sourceDocPath);
  const htmlDir = parentDirFromPath(htmlPath);
  const bundleDirName = `${deckStemFromPath(htmlPath)}.assets`;
  const targetRelDir = `${bundleDirName}/source`;
  const targetDir = joinPath(joinPath(htmlDir, bundleDirName), 'source');
  const rawToSource = new Map<string, string>();

  for (const match of html.matchAll(IMAGE_SRC_RE)) {
    const raw = match[2] ?? match[3] ?? match[4] ?? '';
    const sourcePath = resolveLocalSourcePath(raw, sourceDocDir, false);
    if (sourcePath) rawToSource.set(raw, sourcePath);
  }
  for (const match of html.matchAll(CSS_URL_RE)) {
    const raw = match[2] ?? match[3] ?? match[4] ?? '';
    const sourcePath = resolveLocalSourcePath(raw, sourceDocDir, true);
    if (sourcePath) rawToSource.set(raw, sourcePath);
  }

  if (rawToSource.size === 0) return { html, copied: 0, rewritten: 0 };

  const d = deps ?? (await defaultDeps());
  const sourceToRel = new Map<string, string>();
  let copied = 0;
  let mkdirDone = false;

  for (const sourcePath of rawToSource.values()) {
    if (sourceToRel.has(sourcePath)) continue;
    if (!(await d.exists(sourcePath))) continue;

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

  let rewritten = 0;
  const rebased = html
    .replace(IMAGE_SRC_RE, (full, prefix, doubleQuoted, singleQuoted, bare) => {
      const raw = doubleQuoted ?? singleQuoted ?? bare ?? '';
      const sourcePath = rawToSource.get(raw);
      const rel = sourcePath ? sourceToRel.get(sourcePath) : undefined;
      if (!rel) return full;
      rewritten += 1;
      return `${prefix}"${htmlAttr(rel)}"`;
    })
    .replace(CSS_URL_RE, (full, prefix, doubleQuoted, singleQuoted, bare, suffix) => {
      const raw = doubleQuoted ?? singleQuoted ?? bare ?? '';
      const sourcePath = rawToSource.get(raw);
      const rel = sourcePath ? sourceToRel.get(sourcePath) : undefined;
      if (!rel) return full;
      rewritten += 1;
      return `${prefix}"${cssString(rel)}"${suffix}`;
    });

  return { html: rebased, copied, rewritten };
}
