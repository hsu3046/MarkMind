/**
 * Google Drive 통합 — Tauri Rust 백엔드 (src-tauri/src/gdrive/) 의 JS 래퍼.
 *
 * 모든 함수는 Tauri 환경에서만 동작. 웹 빌드에서는 isConfigured() 가 false 반환.
 *
 * 사용 흐름:
 *   1. await isConfigured()  → 빌드에 OAuth client ID 가 주입됐는지
 *   2. await getStatus()     → 이미 연결된 사용자 email (또는 null)
 *   3. await connect()       → 브라우저 OAuth → refresh_token 저장
 *   4. await listFiles()     → 마크다운 파일 목록
 *   5. await downloadFile(id) / uploadFile(...) / updateFile(id, ...)
 *   6. await disconnect()    → 자격증명 삭제
 */

import { isTauri } from './platform';

export interface DriveFile {
    id: string;
    name: string;
    mimeType: string;
    modifiedTime?: string | null;
    size?: string | null;
}

export interface ConnectResult {
    email: string;
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    if (!isTauri()) {
        throw new Error('Google Drive 는 데스크탑 앱에서만 사용 가능합니다.');
    }
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<T>(cmd, args);
}

export async function isConfigured(): Promise<boolean> {
    if (!isTauri()) return false;
    try {
        return await tauriInvoke<boolean>('gdrive_is_configured');
    } catch {
        return false;
    }
}

/** Settings UI 표시용 — 저장된 OAuth client_id (전체 문자열, 없으면 null). */
export async function getClientId(): Promise<string | null> {
    if (!isTauri()) return null;
    try {
        return await tauriInvoke<string | null>('gdrive_get_client_id');
    } catch {
        return null;
    }
}

/** OAuth client credentials 저장. 둘 다 비어있으면 안 됨. */
export async function setCredentials(clientId: string, clientSecret: string): Promise<void> {
    await tauriInvoke<void>('gdrive_set_credentials', { clientId, clientSecret });
}

/** OAuth credentials + 연결 정보 완전 삭제. */
export async function clearCredentials(): Promise<void> {
    await tauriInvoke<void>('gdrive_clear_credentials');
}

export async function getStatus(): Promise<string | null> {
    if (!isTauri()) return null;
    try {
        return await tauriInvoke<string | null>('gdrive_status');
    } catch (err) {
        console.warn('[gdrive] status 조회 실패:', err);
        return null;
    }
}

export async function connect(): Promise<ConnectResult> {
    return await tauriInvoke<ConnectResult>('gdrive_connect');
}

export async function disconnect(): Promise<void> {
    await tauriInvoke<void>('gdrive_disconnect');
}

/**
 * 마크다운 파일 목록.
 * @param maxResults 최대 개수 (undefined = 전부, 안전한도 10000).
 */
export async function listFiles(maxResults?: number): Promise<DriveFile[]> {
    return await tauriInvoke<DriveFile[]>('gdrive_list', { maxResults: maxResults ?? null });
}

/**
 * 파일 본문 다운로드. mimeType 으로 Google Docs (export) / 일반 파일 (alt=media) 분기.
 */
export async function downloadFile(fileId: string, mimeType: string): Promise<string> {
    return await tauriInvoke<string>('gdrive_download', { fileId, mimeType });
}

export async function uploadFile(
    name: string,
    content: string,
    parentId?: string | null,
): Promise<DriveFile> {
    return await tauriInvoke<DriveFile>('gdrive_upload', {
        name,
        content,
        parentId: parentId ?? null,
    });
}

export async function updateFile(fileId: string, content: string): Promise<DriveFile> {
    return await tauriInvoke<DriveFile>('gdrive_update', { fileId, content });
}
