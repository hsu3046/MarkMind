/**
 * 마크다운 이미지 src 경로 해석 (#55).
 *
 * 로컬 파일 경로(`./img.png`, `/Users/.../a.png`)를 Tauri asset:// URL 로 변환해
 * webview 가 표시할 수 있게 한다. http(s)/data/blob/이미 변환된 asset URL 은 통과.
 * Markdown 이 SSOT 이므로 변환은 **표시 시점에만** — 직렬화/저장 경로는 원본 유지.
 */
import { isTauri as defaultIsTauri } from '../services/platform';
import { convertFileSrc as defaultConvertFileSrc } from '@tauri-apps/api/core';

export interface ResolveDeps {
    isTauri: () => boolean;
    convertFileSrc: (path: string) => string;
}

const defaultDeps: ResolveDeps = {
    isTauri: defaultIsTauri,
    convertFileSrc: (p) => defaultConvertFileSrc(p),
};

/** 통과 대상: 원격/인라인/이미 절대 스킴 + fragment. (재변환 방지) */
const PASSTHROUGH = /^(?:https?:|data:|blob:|asset:|tauri:|mailto:|#)/i;

/** POSIX 절대경로 또는 Windows 드라이브(`C:\`)/UNC(`\\`) 경로인지. */
function isAbsolutePath(s: string): boolean {
    return s.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(s) || s.startsWith('\\\\');
}

/**
 * baseDir(POSIX 절대경로) 기준으로 상대경로를 결합하고 `.`/`..` 를 정규화한다.
 * 순수 함수 — 테스트 핵심. (Windows 경로는 비목표, 본 제품은 macOS 전용)
 */
export function resolveRelativePath(relative: string, baseDir: string): string {
    const combined = `${baseDir}/${relative}`;
    const isAbs = combined.startsWith('/');
    const stack: string[] = [];
    for (const part of combined.split('/')) {
        if (part === '' || part === '.') continue;
        if (part === '..') {
            stack.pop();
            continue;
        }
        stack.push(part);
    }
    return (isAbs ? '/' : '') + stack.join('/');
}

/**
 * 마크다운 이미지 src 를 표시용 URL 로 해석한다.
 * @param src     마크다운의 원본 src (예: `./assets/a.png`, `https://...`)
 * @param docDir  현재 문서 디렉토리(POSIX 절대경로). 미저장이면 null.
 * @param deps    isTauri/convertFileSrc 주입(테스트용). 기본은 실제 Tauri API.
 */
export function resolveImageSrc(
    src: string,
    docDir: string | null,
    deps: ResolveDeps = defaultDeps,
): string {
    if (!src) return src;
    const s = src.trim();
    if (PASSTHROUGH.test(s)) return src;
    if (s.includes('asset.localhost')) return src; // 이미 convertFileSrc 거친 URL
    // 비-Tauri(웹/테스트)에선 convertFileSrc 가 throw → 원본 그대로
    if (!deps.isTauri()) return src;
    if (isAbsolutePath(s)) return deps.convertFileSrc(s);
    // 상대경로인데 문서가 미저장(docDir null)이면 해석 불가 → 원본 유지
    if (docDir == null) return src;
    return deps.convertFileSrc(resolveRelativePath(s, docDir));
}
