# MarkMind

> **Where Markdown Meets Mind** — A lightning-fast Markdown editor built for the AI era.

<p align="center">
  <img src="src-tauri/icons/icon.png" alt="MarkMind" width="128" />
</p>

---

## Summary-en

**MarkMind** is a native macOS Markdown editor designed for AI-powered workflows. Write, preview, and refine AI-generated documents in a beautiful split-view interface. Also available as a zero-install web app.

**Key highlights:**
- ⚡ Native macOS app (Tauri v2) + Web deployable
- 🤖 AI Assistant — Grammar fix, translate, document improvement (Gemini)
- 🧪 Smart Diff — Word-level highlights for grammar, paragraph before/after for translation
- 🪟 Multi-window support with cascade positioning
- 📖 Reading mode, outline panel, synchronized scroll
- 🔍 Full-featured search with highlight
- 🎨 Dark/Light theme with Pretendard typography

## Summary-ko

**MarkMind**는 AI 시대를 위한 네이티브 macOS 마크다운 에디터입니다. AI가 생성한 문서를 아름다운 분할 뷰에서 읽고, 미리보기하고, 다듬을 수 있습니다. 설치 없이 웹에서도 사용할 수 있습니다.

**주요 특징:**
- ⚡ 네이티브 macOS 앱 (Tauri v2) + 웹 배포 가능
- 🤖 AI 어시스턴트 — 문법 교정, 번역, 문서 개선 (Gemini)
- 🧪 스마트 Diff — 교정은 단어 수준 하이라이트, 번역은 문단별 before/after
- 🪟 다중 창 지원 (cascade 위치 배치)
- 📖 읽기 모드, 아웃라인 패널, 동기 스크롤
- 🔍 하이라이트가 포함된 검색 기능
- 🎨 다크/라이트 테마 + Pretendard 타이포그래피

## Summary-ja

**MarkMind**はAI時代のためのネイティブmacOSマークダウンエディタです。AIが生成したドキュメントを美しいスプリットビューで閲覧・プレビュー・編集できます。インストール不要のWebアプリとしても利用可能です。

**主な特徴:**
- ⚡ ネイティブmacOSアプリ (Tauri v2) + Webデプロイ対応
- 🤖 AIアシスタント — 文法修正、翻訳、文書改善 (Gemini)
- 🧪 スマートDiff — 文法修正は単語レベルハイライト、翻訳は段落別before/after
- 🪟 マルチウィンドウサポート（カスケード配置）
- 📖 リーディングモード、アウトラインパネル、同期スクロール
- 🔍 ハイライト付き検索機能
- 🎨 ダーク/ライトテーマ + Pretendardタイポグラフィ

---

## Features

### Editor
- **Split View** — Side-by-side editor and preview with adjustable ratio
- **CodeMirror 6** — Syntax highlighting, bracket matching, smart indentation
- **GFM Support** — Tables, task lists, strikethrough, footnotes
- **Code Highlighting** — `highlight.js` powered syntax coloring in preview

### Viewing
- **Reading Mode** — Distraction-free full-width preview
- **Outline Panel** — Auto-extracted H1–H6 headings with click-to-navigate
- **Font Size Control** — `⌘+` / `⌘-` / `⌘0` for zoom
- **Synchronized Scroll** — Editor and preview scroll in sync (toggle on/off)

### File Management
- **Multi-Window** — Open multiple files in separate windows (`⌘N`, `⌘O`)
- **Recent Files** — Quick access to recently opened documents
- **File Association** — Double-click `.md` files in Finder to open in MarkMind
- **Auto-detect** — Supports `.md`, `.markdown`, `.mdx`, `.txt`

### Search
- **Editor Search** — CodeMirror's built-in search panel (`⌘F`)
- **Preview Search** — DOM-based highlight search in preview mode

### Theming
- **Dark / Light Mode** — One-click toggle
- **Pretendard Font** — CJK-optimized typography

### AI Assistant
- **Grammar Fix** — Auto-correct typos and grammar (flash-lite / flash)
- **Translation** — Korean ↔ English ↔ Japanese
- **Document Improvement** — Speed mode (flash) or Quality mode (pro)
- **FloatingAIBar** — Select text → instant AI action popup (partial text support)
- **Smart Diff** — Word-level highlights for grammar, paragraph before/after for translation
- **Per-block Accept/Reject** — Review each change individually or apply/reject all at once
- **Streaming** — Real-time preview of AI responses
- **Prompt Support** — Optional detailed instructions for any mode

### Platform
- **Native macOS** — Tauri v2 with overlay titlebar, traffic lights
- **Web Compatible** — Same codebase deploys as a web app (no install needed)

---

## Installation

### macOS (Native App)

Download the latest `.dmg` from [Releases](https://github.com/yuhitomi/markmind/releases).

### Web

Visit the hosted version at [markmind.app](https://markmind.app) *(coming soon)*.

### Build from Source

```bash
# Prerequisites: Node.js 18+, Rust, Xcode CLI Tools

# Clone
git clone https://github.com/yuhitomi/markmind.git
cd markmind

# Install dependencies
npm install

# Development (HMR enabled)
npm run tauri dev

# Production build
npm run tauri build
```

---

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| New Window | `⌘N` |
| Open File | `⌘O` |
| Save | `⌘S` |
| Save As | `⌘⇧S` |
| Find | `⌘F` |
| Preview Mode | `⌘3` |
| Editor Mode | `⌘1` |
| Split View | `⌘2` |
| Zoom In | `⌘+` |
| Zoom Out | `⌘-` |
| Reset Zoom | `⌘0` |
| AI Assistant | `⌘I` |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Tauri v2](https://v2.tauri.app) |
| Frontend | React 19 + TypeScript |
| Editor | CodeMirror 6 |
| Markdown | react-markdown + remark-gfm + rehype-highlight |
| AI | Google Gemini SDK (@google/genai) |
| Icons | Lucide React |
| Build | Vite 7 |
| Backend | Rust |

---

## Roadmap

> **Core Vision**: *Read beautifully → Edit quickly → Export to final format*

- [x] **Phase 1**: Viewing — Font size, outline panel, reading mode
- [x] **Phase 2**: Editing — Search & replace, recent files, multi-window
- [x] **Phase 3**: AI Editing — Grammar fix, translate, document improvement, inline diff
- [ ] **Phase 4**: Export — PDF, Google Docs, PPTX conversion
- [ ] **Phase 5**: Cloud — Google Drive sync, share links

See [TODO.md](docs/TODO.md) for the detailed feature roadmap.

---

## Project Structure

```
markmind/
├── src/                    # React frontend
│   ├── components/         # UI (Editor, Preview, Toolbar, AIPanel, InlineDiffView, FloatingAIBar)
│   ├── hooks/              # Custom hooks (useFileSystem, useTheme, useAI)
│   ├── services/           # Platform detection, AI service, web file system
│   ├── types/              # TypeScript types (AI modes, diff chunks)
│   └── constants/          # Tutorial content
├── src-tauri/              # Rust backend
│   ├── src/lib.rs          # Window management, file association
│   └── capabilities/       # Tauri v2 permissions
├── docs/                   # Internal documentation
└── public/                 # Static assets
```

---

## License

This project is licensed under the [GNU General Public License v3.0](LICENSE).

© 2026 [KnowAI](https://knowai.space)
