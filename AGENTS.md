# Repository Guidelines

## Project Structure & Module Organization

MarkMind is a Tauri v2 desktop app with a React 19 + TypeScript frontend and a Rust backend. Frontend code lives in `src/`: UI in `src/components`, hooks in `src/hooks`, parsing/export logic in `src/lib`, editor extensions in `src/extensions`, and shared types/constants in `src/types` and `src/constants`. Rust commands, native services, converters, MCP, Google Drive integration, resources, and icons live under `src-tauri/`. Static assets are in `public/`, docs in `docs/`, MCP packaging in `mcpb/`, and utilities in `scripts/`.

## Build, Test, and Development Commands

- `npm run dev`: start the Vite web app for browser-only development.
- `npm run tauri dev`: run the native Tauri app with hot reload.
- `npm test`: run the Vitest suite once.
- `npm run build`: type-check with `tsc` and build the Vite frontend.
- `npm run tauri:build`: setup ffmpeg, then build the production native app.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`: run Rust library tests.
- `npm run pack:mcpb`: package the MCP bundle into `markmind.mcpb`.

## Coding Style & Naming Conventions

Use TypeScript with React function components. Name components in PascalCase (`SettingsModal.tsx`), hooks with `use` prefixes (`useTheme.ts`), and library modules in camelCase or descriptive kebab-case matching nearby files (`markdownTree.ts`, `flowchart-converter.ts`). Keep tests colocated as `*.test.ts`. Use 2-space indentation in frontend files and standard `rustfmt` formatting for Rust. Prefer existing CSS files beside components.

## Testing Guidelines

Vitest covers frontend parsing and serialization logic, especially in `src/lib`. Add or update colocated `*.test.ts` files for parser, converter, export, and state-transform changes. For native behavior, add Rust tests near the affected module. Run `npm test` before submitting frontend changes and include `npm run build` when touching shared types, app bootstrapping, or build configuration.

## Commit & Pull Request Guidelines

Recent history uses Conventional Commit-style subjects such as `feat(slideshow): ...`, `fix(preview): ...`, and `chore: ...`. Keep commits focused and include a scope when it clarifies the affected area. Pull requests should describe the user-visible change, list test commands run, link issues, and include screenshots or recordings for UI changes. Note setup-sensitive behavior, such as Keychain, ffmpeg, OAuth, or AI provider configuration.

## Security & Configuration Tips

Do not commit API keys, OAuth secrets, generated credentials, or local media. The desktop app stores provider keys in macOS Keychain; keep configuration examples generic and document required environment variables without real values.

## Agent-Specific Instructions

Respond to the user in Korean unless they explicitly request another language.

## Claude Code Context

This project was originally developed with Claude Code. Before substantial edits, check for Claude-specific guidance and reuse it when present:

- Look for repository-local `CLAUDE.md`, `Claud.md`, `.claude/commands/`, `.claude/skills/`, or any `SKILL.md` files near the repository root.
- Also check Claude's global folder at `/Users/yuhitomi/.claude` when project history or prior Claude Code decisions may help. Start with `/Users/yuhitomi/.claude/CLAUDE.md`, `COMMON_PATTERNS.md`, `TOOL_GOTCHAS.md`, and this project's memory index at `/Users/yuhitomi/.claude/projects/-Users-yuhitomi-Documents-Antigravity-MarkMind/memory/MEMORY.md`.
- Use detailed files under that MarkMind `memory/` directory on demand when their titles match the task, for example `project_universal_undo.md`, `project_flowchart_edit.md`, `project_ai_company_unified.md`, or `project_versioning.md`.
- Use global skills under `/Users/yuhitomi/.claude/skills/<skill>/SKILL.md` only when the task clearly matches that skill. Read the relevant `SKILL.md` before applying it; do not bulk-load unrelated skills.
- Treat Claude files as complementary project guidance. Follow `AGENTS.md` for Codex-specific behavior and use Claude files for project history, workflows, known pitfalls, and task-specific conventions.
- If instructions conflict, prefer the more specific file for the touched area. If still ambiguous, follow the newest explicit user request.
- At the time of writing, this repository only contains `.claude/settings.local.json` with `outputStyle: default`; no Claude guide or skills are present.
- Do not copy secrets, sessions, telemetry, cache files, or machine-local settings from `.claude/` into commits unless the user explicitly requests it.

## PPTX Design Direction

For slide export work, keep design deterministic instead of letting an LLM freely style slides. Use Anthropic's public `pptx` skill as a design/QA reference only; do not vendor proprietary skill code, scripts, text, or assets. Use Google `DESIGN.md` as the user-facing design-system direction: built-in `SlideTheme` defaults first, `*.theme.json` user themes next, and optional `DESIGN.md` import later. The LLM may choose slide narrative, layout enum, semantic blocks, and image intent, but renderer code must own colors, typography, spacing, coordinates, contrast, and overflow. Support user-added rules through theme rules, `DESIGN.md` prose, and per-export options, with safety/layout rules taking precedence when content would be lost or unreadable.
