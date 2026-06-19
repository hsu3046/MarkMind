// package.json 의 version 을 나머지 버전 파일들에 동기화한다.
// version:patch/minor/major 에서 `npm version <type>` 직후 호출 — npm 은 package.json 만
// 올리므로, 버전이 흩어진 4곳을 여기서 맞춘다. 놓치면 빌드 산출물 버전이 제각각이 된다
// (2026-06-18 v0.6.0 빌드 시 Cargo.toml 0.5.0 · mcpb 0.4.4 로 남아 MCP 서버 버전·mcpb 번들 불일치).
import { readFileSync, writeFileSync } from 'node:fs';

const v = JSON.parse(readFileSync('package.json', 'utf8')).version;

// 1) tauri.conf.json — 앱 번들(.app/.dmg) 버전. JSON 재직렬화.
const tauriPath = 'src-tauri/tauri.conf.json';
const tauri = JSON.parse(readFileSync(tauriPath, 'utf8'));
tauri.version = v;
writeFileSync(tauriPath, JSON.stringify(tauri, null, 2) + '\n');

// 2) Cargo.toml — CARGO_PKG_VERSION(MCP 서버 버전 등). [package] 의 첫 version 만, 포맷 보존.
const cargoPath = 'src-tauri/Cargo.toml';
writeFileSync(cargoPath, readFileSync(cargoPath, 'utf8').replace(/^version = ".*"$/m, `version = "${v}"`));

// 3) mcpb/manifest.json — Claude Desktop MCP 번들 버전. top-level "version" 만, 수동 포맷 보존.
const mcpbPath = 'mcpb/manifest.json';
writeFileSync(mcpbPath, readFileSync(mcpbPath, 'utf8').replace(/"version": "[^"]*"/, `"version": "${v}"`));

console.log(`→ v${v}  (package.json · tauri.conf.json · Cargo.toml · mcpb/manifest.json 동기화 완료)`);
