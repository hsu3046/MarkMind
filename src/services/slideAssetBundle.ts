import { extFromMime, resolveCollision, sanitizeFileName } from '../lib/imageAttach';
import type { SlideAssetRecord } from './slideAssets';

export interface SavedSlideAssetRecord extends Omit<SlideAssetRecord, 'dataUrl'> {
  file?: string;
}

export interface SaveSlideAssetBundleResult {
  dir: string;
  saved: number;
  manifestPath: string;
}

function pathSeparatorFor(path: string): '/' | '\\' {
  return path.lastIndexOf('\\') > path.lastIndexOf('/') ? '\\' : '/';
}

function joinPath(parent: string, child: string): string {
  if (!parent) return child;
  const sep = pathSeparatorFor(parent);
  const trimmed = parent.replace(/[\\/]+$/, '');
  if (!trimmed) return `${sep}${child}`;
  return `${trimmed}${sep}${child}`;
}

function parentDirFromPath(path: string): string {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  if (idx < 0) return '';
  if (idx === 0) return path[0] ?? '';
  return path.slice(0, idx);
}

function deckStemFromPath(pptxPath: string): string {
  const file = pptxPath.split(/[\\/]/).pop() || 'deck.pptx';
  return sanitizeFileName(file.replace(/\.pptx$/i, '') || 'deck');
}

export function slideAssetBundleDir(pptxPath: string): string {
  const parent = parentDirFromPath(pptxPath);
  return joinPath(parent, `${deckStemFromPath(pptxPath)}.assets`);
}

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mime: string } | null {
  const match = dataUrl.match(/^data:([^;,]+)(;base64)?,(.*)$/s);
  if (!match) return null;
  const mime = match[1] || 'image/png';
  const payload = match[3] || '';
  const binary = match[2] ? atob(payload) : decodeURIComponent(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, mime };
}

function shortSourceLabel(record: SlideAssetRecord): string {
  if (record.sourceMode === 'generated') return sanitizeFileName(record.provider).toLowerCase();
  try {
    const host = record.sourceUrl ? new URL(record.sourceUrl).hostname.toLowerCase() : '';
    const cleaned = host.replace(/^www\./, '').replace(/^commons\./, '');
    const parts = cleaned.split('.').filter(Boolean);
    if (parts.length >= 2) return sanitizeFileName(parts[parts.length - 2]).toLowerCase();
    if (parts.length === 1) return sanitizeFileName(parts[0]).toLowerCase();
  } catch {
    // Fall through to provider label.
  }
  return sanitizeFileName(record.provider).toLowerCase();
}

export function slideAssetFileStem(record: SlideAssetRecord): string {
  const slideNo = String(record.slideIndex + 1).padStart(2, '0');
  const title = sanitizeFileName(record.slideTitle).slice(0, 42).trim() || 'slide';
  const mode = record.sourceMode === 'generated' ? 'generated' : 'search';
  const provider = shortSourceLabel(record);
  return sanitizeFileName(`slide-${slideNo}-${mode}-${provider}-${record.role}-${title}`);
}

function attributionText(records: SavedSlideAssetRecord[]): string {
  const lines = ['# PPTX Image Assets', ''];
  for (const record of records) {
    lines.push(`## Slide ${record.slideIndex + 1}: ${record.slideTitle}`);
    lines.push(`- File: ${record.file ?? '(not saved)'}`);
    lines.push(`- Used in PPTX: ${record.inserted ? 'yes' : 'no'}`);
    lines.push(`- Provider: ${record.provider}`);
    lines.push(`- Importance: ${record.importance}`);
    lines.push(`- Image score: ${record.imageScore}`);
    if (record.importanceReason) lines.push(`- Importance reason: ${record.importanceReason}`);
    if (record.sourceUrl) lines.push(`- Source URL: ${record.sourceUrl}`);
    if (record.license) lines.push(`- License: ${record.license}`);
    if (record.attribution) lines.push(`- Attribution: ${record.attribution}`);
    if (record.query) lines.push(`- Query: ${record.query}`);
    if (record.generatedPrompt) lines.push(`- Generated prompt: ${record.generatedPrompt.replace(/\s+/g, ' ').slice(0, 500)}`);
    lines.push('');
  }
  return lines.join('\n');
}

export async function saveSlideAssetBundle(
  pptxPath: string,
  records: SlideAssetRecord[],
): Promise<SaveSlideAssetBundleResult | null> {
  if (records.length === 0) return null;
  const fs = await import('@tauri-apps/plugin-fs');
  const dir = slideAssetBundleDir(pptxPath);
  const usedDir = joinPath(dir, 'used');
  const unusedDir = joinPath(dir, 'unused');
  await fs.mkdir(usedDir, { recursive: true });
  await fs.mkdir(unusedDir, { recursive: true });

  const manifest: SavedSlideAssetRecord[] = [];
  let saved = 0;
  for (const record of records) {
    const parsed = dataUrlToBytes(record.dataUrl);
    const withoutData = (({ dataUrl: _dataUrl, ...rest }) => rest)(record);
    if (!parsed) {
      manifest.push(withoutData);
      continue;
    }
    const targetDir = record.inserted ? usedDir : unusedDir;
    const folderName = record.inserted ? 'used' : 'unused';
    const desired = `${slideAssetFileStem(record)}.${extFromMime(parsed.mime)}`;
    const name = await resolveCollision(targetDir, desired, fs.exists);
    await fs.writeFile(joinPath(targetDir, name), parsed.bytes);
    saved += 1;
    manifest.push({ ...withoutData, file: `${folderName}/${name}` });
  }

  const manifestPath = joinPath(dir, 'manifest.json');
  await fs.writeTextFile(manifestPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), assets: manifest }, null, 2)}\n`);
  await fs.writeTextFile(joinPath(dir, 'ATTRIBUTION.md'), attributionText(manifest));
  return { dir, saved, manifestPath };
}
