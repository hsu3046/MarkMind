/**
 * 이미지 인라인 첨부 — 임시 표시 → 저장 시 복사 방식 (#56).
 *
 * 흐름:
 *   1) 드롭(외부 파일 경로) / 붙여넣기(클립보드 바이트) → 마크다운에 **로컬 절대경로**로 삽입.
 *      (붙여넣기는 바이트라 $TEMP 에 먼저 써서 경로를 만든다.) 표시는 #55(asset://)가 담당.
 *   2) 문서 저장(⌘S) 시 → `flushImagesOnSave` 가 본문의 로컬 절대경로 이미지를 문서의
 *      `assets/` 로 복사하고 경로를 상대경로 `./assets/<name>` 로 치환 → 휴대성 확보.
 *
 * 순수 로직(경로/파일명/치환)과 Tauri fs 호출을 분리해 테스트 가능.
 */

/** 파일명에서 경로 구분자·제어문자·금지문자 제거. 비면 'image' 폴백. */
export function sanitizeFileName(name: string): string {
    const cleaned = name
        // eslint-disable-next-line no-control-regex
        .replace(/[/\\:*?"<>|\x00-\x1f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned || 'image';
}

/** MIME 타입 → 정규화된 확장자. 빈/미상이면 'png'. */
export function extFromMime(mime: string): string {
    const sub = (mime.split('/')[1] || '').toLowerCase();
    if (!sub) return 'png';
    return sub.replace('jpeg', 'jpg').replace('svg+xml', 'svg').replace('x-icon', 'ico');
}

/** POSIX 로컬 절대경로인지 (protocol-relative `//`·URL 제외). */
export function isLocalAbsolutePath(p: string): boolean {
    return p.startsWith('/') && !p.startsWith('//');
}

/**
 * 충돌 없는 파일명 반환. `name.png` 충돌 시 `name-1.png`, `name-2.png` …
 * @param exists  절대경로가 이미 존재하는지 (주입 — 테스트/Tauri fs).
 */
export async function resolveCollision(
    assetsDir: string,
    desiredName: string,
    exists: (absPath: string) => Promise<boolean>,
): Promise<string> {
    const dot = desiredName.lastIndexOf('.');
    const stem = dot > 0 ? desiredName.slice(0, dot) : desiredName;
    const ext = dot > 0 ? desiredName.slice(dot) : '';
    let candidate = desiredName;
    let n = 0;
    while (await exists(`${assetsDir}/${candidate}`)) {
        n += 1;
        candidate = `${stem}-${n}${ext}`;
    }
    return candidate;
}

// ─── 1) 임시 저장 (붙여넣기 바이트 → $TEMP 절대경로) ───────────────────

export interface TempDeps {
    writeFile: (path: string, data: Uint8Array) => Promise<unknown>;
    tempFilePath: (name: string) => Promise<string>;
    now: () => number;
}

async function defaultTempDeps(): Promise<TempDeps> {
    const [{ tempDir, join }, fs] = await Promise.all([
        import('@tauri-apps/api/path'),
        import('@tauri-apps/plugin-fs'),
    ]);
    return {
        writeFile: (p, data) => fs.writeFile(p, data),
        tempFilePath: async (name) => join(await tempDir(), name),
        now: () => Date.now(),
    };
}

/** 클립보드 이미지 바이트를 $TEMP 에 쓰고 절대경로를 반환(저장 전 임시 표시용). */
export async function writeTempImage(
    bytes: Uint8Array,
    ext: string,
    deps?: TempDeps,
): Promise<string> {
    const d = deps ?? (await defaultTempDeps());
    const path = await d.tempFilePath(`markmind-img-${d.now()}.${ext}`);
    await d.writeFile(path, bytes);
    return path;
}

// ─── 2) 저장 시 flush (로컬 절대경로 → assets 복사 + 상대경로 치환) ──────

/** `![alt](path)` 매칭 — pre/path/post 3그룹. */
const IMAGE_RE = /(!\[[^\]]*\]\()([^)]+)(\))/g;

/** ``` / ~~~ 코드펜스를 sentinel 로 마스킹 (이미지 치환이 코드 예시를 안 건드리게). */
function maskCodeFences(content: string): { masked: string; fences: string[] } {
    const fences: string[] = [];
    const lines = content.split('\n');
    const out: string[] = [];
    let i = 0;
    while (i < lines.length) {
        const open = lines[i].match(/^[ ]{0,3}(([`~])\2{2,})/);
        if (open) {
            const ch = open[2];
            const minLen = open[1].length;
            const closeRe = new RegExp(`^[ ]{0,3}${ch === '`' ? '`' : '~'}{${minLen},}[ \\t]*$`);
            let j = i + 1;
            while (j < lines.length && !closeRe.test(lines[j])) j++;
            const endIdx = j < lines.length ? j + 1 : j;
            fences.push(lines.slice(i, endIdx).join('\n'));
            out.push(`\x00MMIMG${fences.length - 1}\x00`);
            i = endIdx;
            continue;
        }
        out.push(lines[i]);
        i++;
    }
    return { masked: out.join('\n'), fences };
}

function restoreCodeFences(masked: string, fences: string[]): string {
    return masked.replace(/\x00MMIMG(\d+)\x00/g, (_, n) => fences[Number(n)]);
}

export interface FlushDeps {
    mkdir: (path: string, opts: { recursive: boolean }) => Promise<unknown>;
    copyFile: (src: string, dest: string) => Promise<unknown>;
    exists: (path: string) => Promise<boolean>;
}

async function defaultFlushDeps(): Promise<FlushDeps> {
    const fs = await import('@tauri-apps/plugin-fs');
    return {
        mkdir: (p, o) => fs.mkdir(p, o),
        copyFile: (s, d) => fs.copyFile(s, d),
        exists: (p) => fs.exists(p),
    };
}

/**
 * 저장 직전 본문을 변환 — 로컬 절대경로 이미지를 문서 `assets/` 로 복사하고
 * 경로를 `./assets/<name>` 로 치환한 새 본문을 반환.
 * - http/data/blob/asset/상대경로(`./`,`../`)는 그대로. 코드펜스 안도 그대로.
 * - 원본이 없거나(삭제됨) 이미 assets/ 안이면 스킵.
 * - 복사 실패는 throw 하지 않고 해당 이미지만 건너뜀(저장은 진행).
 * @returns 치환된 content + 복사된 이미지 수
 */
export async function flushImagesOnSave(
    content: string,
    docPath: string,
    deps?: FlushDeps,
): Promise<{ content: string; copied: number }> {
    const dir = docPath.slice(0, docPath.lastIndexOf('/'));
    const assetsDir = `${dir}/assets`;
    const { masked, fences } = maskCodeFences(content);

    // 1) 코드펜스 밖의 로컬 절대경로 이미지 수집 (중복 제거)
    const targets = new Set<string>();
    for (const m of masked.matchAll(IMAGE_RE)) {
        const p = m[2].trim();
        if (isLocalAbsolutePath(p) && !p.startsWith(`${assetsDir}/`)) targets.add(p);
    }
    if (targets.size === 0) return { content, copied: 0 };

    // 2) 복사 + 경로 매핑
    const d = deps ?? (await defaultFlushDeps());
    await d.mkdir(assetsDir, { recursive: true });
    const map = new Map<string, string>();
    for (const absPath of targets) {
        try {
            if (!(await d.exists(absPath))) continue; // 원본 사라짐 → 경로 유지
            const base = sanitizeFileName(absPath.split('/').pop() || 'image');
            const name = await resolveCollision(assetsDir, base, d.exists);
            await d.copyFile(absPath, `${assetsDir}/${name}`);
            map.set(absPath, `./assets/${name}`);
        } catch (err) {
            console.error('[flushImagesOnSave] 복사 실패, 건너뜀:', absPath, err);
        }
    }
    if (map.size === 0) return { content, copied: 0 };

    // 3) 코드펜스 밖에서만 경로 치환 후 복원
    const replaced = masked.replace(IMAGE_RE, (full, pre, p, post) => {
        const rel = map.get(p.trim());
        return rel ? `${pre}${rel}${post}` : full;
    });
    return { content: restoreCodeFences(replaced, fences), copied: map.size };
}
