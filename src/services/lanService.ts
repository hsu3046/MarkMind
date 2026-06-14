/**
 * LAN 파일 공유 서버 제어 (데스크탑 앱 설정창 전용 — Tauri invoke).
 *
 * 설정창에서 Connect 하면 Rust 가 `0.0.0.0:8418` 에 bind 하고, 같은 Wi-Fi 의
 * 기기(아이폰 브라우저)가 `http://<ip>:8418/?token=<PIN>` 으로 접속해 지정 폴더의
 * 마크다운을 읽고 in-place 편집한다. MCP(127.0.0.1)와는 분리된 별도 서버.
 *
 * root(노출 폴더)·token(PIN)은 localStorage 에 보관하되, **연결 상태는 저장하지
 * 않는다**(앱 재시작 시 항상 OFF로 시작 — 명시적 ON 원칙).
 */

import { invoke } from '@tauri-apps/api/core';

export interface LanInfo {
    running: boolean;
    /** mDNS 호스트네임(*.local) — IP 가 바뀌어도 고정(권장). 못 구하면 null. */
    host: string | null;
    /** 현재 LAN IP — DHCP 라 바뀔 수 있음(폴백). */
    addr: string | null;
    port: number | null;
    root: string | null;
}

const ROOT_KEY = 'markmind.lan.root';
const TOKEN_KEY = 'markmind.lan.token';

export function getSavedRoot(): string {
    return localStorage.getItem(ROOT_KEY) || '';
}

export function setSavedRoot(value: string): void {
    localStorage.setItem(ROOT_KEY, value);
}

/** PIN 토큰을 가져오거나(없으면) 생성해 저장. URL-safe 12자 hex. */
export function getOrCreateToken(): string {
    let t = localStorage.getItem(TOKEN_KEY);
    if (!t) {
        t = regenerateToken();
    }
    return t;
}

export function regenerateToken(): string {
    const t = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    localStorage.setItem(TOKEN_KEY, t);
    return t;
}

export async function lanStart(root: string, token: string): Promise<LanInfo> {
    return invoke<LanInfo>('lan_start', { root, token });
}

export async function lanStop(): Promise<void> {
    await invoke('lan_stop');
}

export async function lanStatus(): Promise<LanInfo> {
    return invoke<LanInfo>('lan_status');
}

/** 호스트(또는 IP) + 포트 + 토큰으로 아이폰 접속 URL 생성. */
export function urlFor(hostOrIp: string, port: number, token: string): string {
    return `http://${hostOrIp}:${port}/?token=${encodeURIComponent(token)}`;
}

/** macOS AirDrop 으로 접속 URL 전송(시스템 수신자 선택 창). */
export async function shareAirdrop(url: string): Promise<void> {
    await invoke('share_url_airdrop', { url });
}
