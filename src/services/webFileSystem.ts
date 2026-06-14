/**
 * Web-based file system operations
 * Uses File System Access API (Chrome/Edge) with fallback (Safari/Firefox)
 */

/** Check if File System Access API is available */
function hasFileSystemAccess(): boolean {
    return 'showOpenFilePicker' in window && 'showSaveFilePicker' in window;
}

/** Confirm unsaved changes via browser dialog */
export function webConfirmUnsavedChanges(): 'save' | 'discard' | 'cancel' {
    const result = window.confirm(
        'Current file has unsaved changes. Press OK to discard, or Cancel to go back.'
    );
    return result ? 'discard' : 'cancel';
}

// ─── File System Access API (Chrome/Edge) ───

let currentFileHandle: FileSystemFileHandle | null = null;

async function openWithFSA(): Promise<{ content: string; name: string } | null> {
    try {
        const [handle] = await (window as any).showOpenFilePicker({
            types: [
                {
                    description: 'Markdown files',
                    accept: { 'text/markdown': ['.md', '.markdown', '.mdx', '.txt'] },
                },
            ],
        });
        const file = await handle.getFile();
        const content = await file.text();
        currentFileHandle = handle;
        return { content, name: file.name };
    } catch {
        // User cancelled
        return null;
    }
}

async function saveWithFSA(content: string, fileName: string, saveAs: boolean): Promise<string | null> {
    try {
        let handle = currentFileHandle;

        if (!handle || saveAs) {
            handle = await (window as any).showSaveFilePicker({
                suggestedName: fileName,
                types: [
                    {
                        description: 'Markdown files',
                        accept: { 'text/markdown': ['.md', '.markdown'] },
                    },
                ],
            });
            if (!handle) return null;
            currentFileHandle = handle;
        }

        const writable = await (handle as any).createWritable();
        await writable.write(content);
        await writable.close();

        const file = await handle!.getFile();
        return file.name;
    } catch {
        // User cancelled or error
        return null;
    }
}

// ─── Fallback (Safari/Firefox) ───

function openWithFallback(): Promise<{ content: string; name: string } | null> {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.md,.markdown,.mdx,.txt,text/markdown,text/plain';

        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) {
                resolve(null);
                return;
            }
            const content = await file.text();
            resolve({ content, name: file.name });
        };

        input.oncancel = () => resolve(null);
        input.click();
    });
}

function saveWithFallback(content: string, fileName: string): string {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return fileName;
}

// ─── LAN 서버 모드 (아이폰 브라우저 등) ───
// MarkMind 데스크탑 앱이 Connect 로 띄운 LAN 서버에 같은 origin 으로 접속한 경우.
// 토큰은 첫 접속 URL(?token=)에서 받아 localStorage 에 저장 후 헤더로 첨부.
// filePath = 서버 루트 기준 상대경로 → 저장이 원본을 in-place 덮어쓴다.

const LAN_TOKEN_KEY = 'markmind.lan.client.token';

export interface LanFile {
    path: string;
    name: string;
    size: number;
    modified: number;
}

/** URL ?token= 우선(첫 접속 시 저장), 없으면 localStorage. */
function getClientToken(): string | null {
    try {
        const fromUrl = new URL(window.location.href).searchParams.get('token');
        if (fromUrl) {
            localStorage.setItem(LAN_TOKEN_KEY, fromUrl);
            return fromUrl;
        }
    } catch {
        // URL 파싱 불가 — localStorage 로 폴백
    }
    return localStorage.getItem(LAN_TOKEN_KEY);
}

/** LAN 서버로 서빙된 컨텍스트인지(= 토큰 보유). 웹 모드에서만 의미 있음. */
export function hasLanServer(): boolean {
    return getClientToken() !== null;
}

async function lanFetch(path: string, init?: RequestInit): Promise<Response> {
    const token = getClientToken();
    return fetch(path, {
        ...init,
        headers: { ...(init?.headers || {}), 'x-markmind-token': token || '' },
    });
}

export async function lanListFiles(): Promise<{ root: string; files: LanFile[] }> {
    const r = await lanFetch('/api/files');
    if (!r.ok) throw new Error(`목록을 불러오지 못했습니다 (${r.status})`);
    return r.json();
}

export async function lanReadFile(
    path: string,
): Promise<{ path: string; content: string; modified: number }> {
    const r = await lanFetch(`/api/file?path=${encodeURIComponent(path)}`);
    if (!r.ok) throw new Error(`파일을 읽지 못했습니다 (${r.status})`);
    return r.json();
}

/** 저장 충돌(외부에서 변경됨, HTTP 409)을 식별하기 위한 에러 플래그. */
export interface LanWriteError extends Error {
    conflict?: boolean;
}

/**
 * in-place 저장. baseModified(읽을 때의 mtime)를 주면 서버가 그 사이 외부
 * 변경을 감지해 409 를 던진다(lost update 방지). 강제 저장은 baseModified 생략.
 * 반환: 저장 후 새 mtime(다음 저장의 base).
 */
export async function lanWriteFile(
    path: string,
    content: string,
    baseModified?: number,
): Promise<{ modified: number }> {
    const r = await lanFetch('/api/file', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path, content, base_modified: baseModified }),
    });
    if (r.status === 409) {
        const err: LanWriteError = new Error('파일이 외부에서 변경되었습니다');
        err.conflict = true;
        throw err;
    }
    if (!r.ok) throw new Error(`저장하지 못했습니다 (${r.status})`);
    return r.json();
}

// ─── Public API ───

export async function webOpenFile(): Promise<{ content: string; name: string } | null> {
    if (hasFileSystemAccess()) {
        return openWithFSA();
    }
    return openWithFallback();
}

export async function webSaveFile(
    content: string,
    fileName: string,
    saveAs: boolean = false
): Promise<string | null> {
    if (hasFileSystemAccess()) {
        return saveWithFSA(content, fileName, saveAs);
    }
    return saveWithFallback(content, fileName);
}
