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
