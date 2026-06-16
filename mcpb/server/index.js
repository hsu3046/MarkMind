#!/usr/bin/env node
/*
 * MarkMind .mcpb shim — 실행 중인 MarkMind 앱의 in-process HTTP MCP 서버
 * (127.0.0.1:8417)에 mcp-remote 로 브릿지한다.
 *
 * Claude Desktop 은 보통 manifest 의 server.mcp_config(`npx mcp-remote ...`)를
 * 직접 실행하지만, entry_point 로 실행되는 클라이언트를 위한 동등 폴백.
 * 전제: MarkMind 앱이 실행 중이어야 한다(앱이 8417 HTTP 서버를 띄운다).
 */
const { spawn } = require('node:child_process');

const child = spawn(
  'npx',
  ['-y', 'mcp-remote', 'http://localhost:8417/mcp'],
  { stdio: 'inherit' },
);
child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (err) => {
  process.stderr.write(`[markmind-mcpb] mcp-remote 실행 실패: ${err.message}\n`);
  process.exit(1);
});
