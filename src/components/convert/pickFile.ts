/**
 * Tauri 파일 다이얼로그 wrapper — Convert 윈도우 전용 헬퍼.
 */

import { isTauri } from '../../services/platform';

export interface PickedFile {
    path: string;
    name: string;
}

async function tauriOpenDialog(filters: { name: string; extensions: string[] }[]): Promise<string | null> {
    if (!isTauri()) {
        alert('파일 선택은 데스크탑 앱에서만 사용 가능합니다.');
        return null;
    }
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
        multiple: false,
        directory: false,
        filters,
    });
    if (typeof selected === 'string') return selected;
    return null;
}

function basename(path: string): string {
    const parts = path.split(/[\\\/]/);
    return parts[parts.length - 1] || path;
}

export async function pickAudioFile(): Promise<PickedFile | null> {
    const path = await tauriOpenDialog([
        {
            name: '오디오',
            extensions: ['mp3', 'wav', 'm4a', 'qta', 'aac', 'ogg', 'flac', 'wma', 'amr', 'opus', 'mp4', 'mov', 'webm', 'm4v'],
        },
    ]);
    if (!path) return null;
    return { path, name: basename(path) };
}

export async function pickImageOrPdfFile(): Promise<PickedFile | null> {
    const path = await tauriOpenDialog([
        {
            name: '이미지/PDF',
            extensions: ['png', 'jpg', 'jpeg', 'webp', 'heic', 'heif', 'gif', 'pdf'],
        },
    ]);
    if (!path) return null;
    return { path, name: basename(path) };
}

export async function pickTextFile(): Promise<PickedFile | null> {
    const path = await tauriOpenDialog([
        { name: '텍스트', extensions: ['txt', 'md', 'markdown', 'mdx'] },
    ]);
    if (!path) return null;
    return { path, name: basename(path) };
}
