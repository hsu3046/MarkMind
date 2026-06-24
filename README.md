<p align="center">
  <img src="src-tauri/icons/icon.png" alt="MarkMind" width="128" />
</p>

# MarkMind

Current version: **0.9.8**

## Tagline-en

Markdown is the best source of truth for AI work, but it should not stay trapped as raw text.
MarkMind turns one Markdown document into an editor, reader, AI workspace, visual board, timeline, and slide deck without breaking the original file.

## Tagline-ko

AI에게는 마크다운이 가장 다루기 좋은 원본이지만, 사람에게는 그대로 읽고 정리하기 불편할 때가 많습니다.
MarkMind는 하나의 마크다운 문서를 편집기, 리더, AI 작업실, 마인드맵, 플로우차트, 간트, 칸반, 슬라이드로 바꿔 보여줍니다.
원본 파일은 유지하면서 읽고, 고치고, 생성하고, 발표 자료까지 이어가는 macOS용 AI 문서 도구입니다.


## Tagline-ja

MarkdownはAIにとって扱いやすい原本ですが、人がそのまま読み、整理し、発表に使うには少し不便です。
MarkMindはひとつのMarkdownを、エディタ、読みやすいプレビュー、AI作業スペース、マインドマップ、フローチャート、ガント、カンバン、スライドへと切り替えて扱えるmacOS向けドキュメントツールです。

---

## Summary-en

AI work often starts as a messy pile: meeting audio, screenshots, PDFs, bullets, pasted research, and half-written drafts. MarkMind keeps Markdown as the single source of truth, then layers useful views on top of it: rich preview, slideshow, mindmap, flowchart, Gantt, and Kanban. You can ask AI to proofread, translate, improve, make meeting notes, generate slide drafts, export PPTX or HTML slides, and keep working inside the same document. API keys stay in macOS Keychain, and provider selection is unified across Gemini, Claude, OpenAI, and Grok.

## Summary-ko

AI 작업은 회의 음성, 스크린샷, PDF, 조사 메모, 불릿 초안처럼 흩어진 자료에서 시작되는 경우가 많습니다. MarkMind는 그 결과를 하나의 마크다운 원본으로 묶고, 같은 문서를 읽기 모드, 슬라이드쇼, 마인드맵, 플로우차트, 간트, 칸반으로 바꿔 보게 합니다. 문법 교정, 번역, 문서 개선, 회의록, 이미지 생성, PPTX/HTML 슬라이드 생성까지 한 흐름 안에서 이어지고, 칸반 카드 편집과 드래그 정렬도 실제 마크다운 마커에 반영됩니다. AI 키는 macOS Keychain에 저장되고, Gemini·Claude·OpenAI·Grok 선택은 한 설정 화면에서 관리합니다.

## Summary-ja

AIで作った文章は、録音、画像、PDF、メモ、箇条書きが混ざった状態から始まることがよくあります。MarkMindはMarkdownを唯一の原本として保ち、その上にプレビュー、スライドショー、マインドマップ、フローチャート、ガント、カンバンを重ねます。校正、翻訳、改善、議事録作成、画像生成、PPTX/HTMLスライド生成まで同じ流れで進められ、カンバンのカード編集や並び替えもMarkdownのマーカーに反映されます。AIキーはmacOS Keychainに保存され、Gemini、Claude、OpenAI、Grokを統一された設定で切り替えられます。

---

## ✨ What It Does

### AI Agent (⌘⇧I)

One side panel with eight modes — speech recognition, image OCR, meeting notes, slides, image generation, plus three text-editing modes. Switch the AI model **inline per mode** (a dropdown that shows only available key/subscription models, each with its company logo), or set the default in Settings (company / auth / model).

- **Fixes grammar in-place** — Select text, pick "문법 교정," and see word-level highlights of every correction — accept or reject one by one.
- **Translates seamlessly** — Korean ↔ English ↔ Japanese with paragraph-by-paragraph before/after diffs.
- **Improves entire documents** — Free-form prompt with Gemini 3.1 Pro for deep rewrites.
- **Generates meeting notes** — Full document as transcript → structured Markdown notes via Claude Sonnet 4.6 or Gemini 3.1 Pro. Built-in templates (general / detailed / team-sync) + user-defined templates.
- **Generates slide decks** — Turn the current document into editable slide drafts, `.pptx`, or self-contained HTML decks with template-aware design rules.
- **Generates images** — Text-to-image (plus reference images) via Gemini (Nano Banana), ChatGPT (GPT Image 2), or Grok (Grok Imagine); insert into the document or save to file. Works with an API key **or a subscription**.
- **Pops up an AI bar on selection** — Highlight any text in the editor and a floating action bar appears instantly.
- **Streams AI responses live** — Watch the rewrite appear in real time, then review the smart diff.

### Multimodal Input (doc-converter integration)

- **Speech → Text (음성 인식)** — Drop an audio file (up to 4h / 1GB). Auto-chunked, speaker-labeled transcription with **Silero VAD** silence trimming (saves ~30–40% Gemini cost). Original recording timestamps preserved across chunks.
- **Image → Text (이미지 인식)** — 2-pass OCR (Gemini Flash extraction → Gemini Pro refinement) for handwriting, screenshots, and PDFs up to 250MB. Auto-fallback to pdfium rasterization for stubborn PDFs.
- **Inline OCR drag-drop** — Drop an image directly into the editor (when no sidebar active) → OCR result inserted at cursor.
- **Sidebar drag-drop** — Drop audio/PDF/image files into the active sidebar → file auto-attached by extension.
- **Speaker diarization (화자 분리)** — Verified **pyannote**, two ways: local (free/offline `pyannote.audio` Python sidecar) or cloud (pyannote.ai API). Post-transcription speaker rename/merge; falls back to Gemini's own speaker guesses if neither is configured.

### Visualization

- **Mindmap (⌘3)** — Render the document's heading/bullet hierarchy as an interactive node graph; edit nodes to update the document.
- **Flowchart (⌘4)** — AI generates a BPMN-lite flow diagram from the document or a topic (an empty-state guide is shown before generation).
- **Gantt (⌘5)** — AI breaks the document or a topic into a scheduled Gantt chart.
- **Kanban (⌘6)** — AI creates a Kanban board from the document or a topic, groups checkbox, `@status`, and Gantt-compatible task markers into Todo / Doing / Review / Blocked / Done columns, and lets you edit card labels, priority, dates, progress, and drag order directly.
- **AI generation (auto-generate modal)** — Mindmap/Flowchart/Gantt/Kanban each open a generate modal: pick the **source** (*auto-analyze* the current document, or *direct input* of a topic — the current document is still passed as background context) and the **write mode** (*append to* or *replace* the document).

Kanban edits keep Markdown as the source of truth. A card is stored as one Markdown line, and edits update inline markers such as `@status(doing)`, `@priority(high)`, `@start(2026-07-01)`, `@due(2026-07-10)`, `@progress(40)`, and Kanban-only `@order(1000)`. Gantt-compatible date/progress markers remain usable in the Gantt view, while `@order(...)` only controls Kanban visual ordering.

### Editor Experience

- **Renames files inline** — Click the filename in the toolbar to edit. Saved files renamed on disk automatically.
- **Renders beautiful previews** — Side-by-side split, full-width reading mode, synchronized scroll, code syntax highlighting, frontmatter rendered as metadata box.
- **Navigates with outline** — Auto-extracted H1–H6 headings, click to jump.
- **Opens multiple windows** — Cascade-positioned, `⌘N` shortcut, recent files in File menu, Finder file association for `.md`.
- **Searches everywhere** — CodeMirror search in the editor (Korean UI, `⌘F`) plus DOM-based highlight in preview mode.
- **Switches themes instantly** — Dark and light with Pretendard CJK-optimized typography.
- **Custom editor background** — Pick a custom background color per preference (BackgroundPicker), preserved across light/dark.
- **Rich table editing** — Table bubble menu, merged-cell rendering, and column-width control for Markdown tables.

### Security & Settings

- **Unified Settings modal** — One place for Gemini, Claude, OpenAI, and Grok (xAI) keys (File → Settings).
- **macOS Keychain storage** — All API keys live in the OS Keychain (`space.knowai.markmind`), never in localStorage on the desktop app.
- **Legacy migration** — First launch auto-migrates any old `localStorage` keys to Keychain.
- **Subscription OAuth** — Reuse an existing AI subscription by reading the local CLI login — no API key needed: **Claude** (Max/Pro via `claude`), **ChatGPT** (Plus via `codex`, text + image), **Gemini** (via the `agy` Antigravity CLI), **Grok** (via `grok login`; note the general API needs a paid SuperGrok plan). Used for both text and image generation.

### Claude Integration (MCP) — new in 0.4.0

- **Reads & edits your open documents from Claude** — An in-process **MCP server** (Streamable HTTP, `127.0.0.1:8417`) lets Claude Desktop / Claude Code see the documents you have open (live editor content, including unsaved changes) and modify them.
- **Read tools** — list open documents, current (focused) document, heading outline, the user's current text selection.
- **Edit tools** — surgical `str_replace`, full rewrite, replace selection, insert at cursor/end. Changes apply to the **live editor and are left unsaved** (you save) — preserving undo where possible.
- **`propose_edit`** — Claude proposes a rewrite shown as a **diff you must accept or reject**; nothing changes unless you accept.
- **`create_document` / `save_document`** — open a Claude-drafted document in a new window; persist to disk on request.
- **Local & isolated** — binds `127.0.0.1` only; one-line setup via `mcp-remote` (see in-app Tutorial § 7).

### Cloud Sync & Export

- **Google Drive sync** — Bring-your-own OAuth client; saved files auto-upload to a `MarkMind` Drive folder, and you can browse/open documents from Drive across machines.
- **PDF export** — Native macOS WKWebView print pipeline (`NSPrintInfo`) → PDF of the rendered document.
- **PPTX / HTML slide export** — Generate AI-planned decks as PowerPoint files or standalone HTML. Image sourcing can use source-only assets, stock/logos only, generated images, or automatic selection depending on the export options.

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | [Tauri v2](https://v2.tauri.app) |
| Frontend | React 19 + TypeScript 5.8 (strict) |
| Editor | CodeMirror 6 (Korean i18n phrases) |
| Markdown | react-markdown + remark-gfm + remark-frontmatter + rehype-highlight |
| AI (LLM) | Google Gemini SDK · Anthropic Claude REST · OpenAI · Grok/xAI |
| AI (Audio) | **Silero VAD v5** ([ort](https://crates.io/crates/ort) 2.0) + **ffmpeg-sidecar** auto-download |
| AI (Diarization) | **pyannote** — local (`pyannote.audio` Python sidecar) or [pyannote.ai](https://pyannote.ai) cloud |
| AI (PDF fallback) | [pdfium-render](https://crates.io/crates/pdfium-render) |
| MCP server | [rmcp](https://crates.io/crates/rmcp) 1.7 (Streamable HTTP) + [axum](https://crates.io/crates/axum) 0.8 |
| Cloud / Export | Google Drive API (OAuth) · macOS WKWebView print → PDF · PptxGenJS · HTML slide templates |
| Secrets | macOS Keychain via [keyring](https://crates.io/crates/keyring) crate |
| Icons | Lucide React |
| Build | Vite 7 + Tauri CLI |
| Backend | Rust (tokio async + reqwest + ort + ffmpeg-sidecar) |

---

## 📦 Installation

### macOS (Native App)

Download the latest `.dmg` from [Releases](https://github.com/yuhitomi/markmind/releases).

First launch:
1. Open **File → Settings** to enter at least one API key:
   - **Gemini** (required for speech/OCR/grammar/translate/improve): [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
   - **Claude** (optional, default for meeting notes): [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
   - **OpenAI** (optional): [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. macOS Keychain may prompt — choose **"Always Allow"** to avoid future prompts for the same build.
3. (Audio first run only) ffmpeg auto-downloads to user cache — takes ~30s on first transcription.

### Build from Source

```bash
# Prerequisites: Node.js 18+, Rust 1.75+, Xcode CLI Tools

git clone https://github.com/yuhitomi/markmind.git
cd markmind
npm install

# Speaker diarization (optional): verified pyannote, two ways —
#   • Local (free/offline): set MARKMIND_DIAR_PYTHON to a Python with `pyannote.audio`
#     installed (+ a free HuggingFace token, accept the gated models once).
#   • Cloud (paid): enter a pyannote.ai API key in Settings.
# Without either, transcription falls back to Gemini's own speaker guesses.

# Development (HMR enabled)
npm run tauri dev

# Production build (.app + .dmg in src-tauri/target/release/bundle/)
npm run tauri build

# Run Rust unit tests (VAD post-process, timestamp mapping, etc.)
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

### Web Only (no AI sidebars)

```bash
npm run dev
# Open http://localhost:1420
```

---

## ⌨️ Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| New Window | `⌘N` |
| Open File | `⌘O` |
| Save | `⌘S` |
| Save As | `⌘⇧S` |
| Find | `⌘F` |
| Markdown (Editor) | `⌘1` |
| Rich Text (Preview) | `⌘2` |
| Mindmap | `⌘3` |
| Flowchart | `⌘4` |
| Gantt | `⌘5` |
| Kanban | `⌘6` |
| Reserved | `⌘7` |
| Split View | `⌘8` |
| Slideshow | `⌘9` |
| Zoom In | `⌘+` |
| Zoom Out | `⌘-` |
| Reset Zoom | `⌘0` |
| AI Agent | `⌘⇧I` |

---

## 📁 Project Structure

```
markmind/
├── src/                                    # React frontend
│   ├── components/
│   │   ├── AIPanel.tsx                     # AI side panel (mode + LLM selector)
│   │   ├── ai/                             # AIPanel sub-components
│   │   │   ├── ModeSelector.tsx            # Mode radio (grammar/translate/improve/notes)
│   │   │   ├── LlmSelector.tsx             # Gemini/Claude/OpenAI dropdown
│   │   │   ├── NotesOptions.tsx            # Template select + user template folder
│   │   │   └── NotesResultCard.tsx         # Meeting notes result card
│   │   ├── convert/                        # Multimodal input panels
│   │   │   ├── AudioTab.tsx                # Speech → text (음성 인식)
│   │   │   ├── OcrTab.tsx                  # Image/PDF → text (이미지 인식)
│   │   │   ├── NotesTab.tsx                # (kept for fallback)
│   │   │   ├── SettingsView.tsx            # Unified key management UI
│   │   │   ├── ProgressPanel.tsx           # Step log with lucide icons
│   │   │   ├── ResultCard.tsx              # Output .md file links
│   │   │   └── pickFile.ts                 # Tauri file dialog wrappers
│   │   ├── sidebar/ConvertSidebar.tsx      # Sidebar wrapper (340px)
│   │   ├── SettingsModal.tsx               # Settings overlay (File → Settings)
│   │   ├── Editor.tsx                      # CodeMirror 6 (KO phrases)
│   │   ├── Preview.tsx                     # Markdown + frontmatter renderer
│   │   ├── Toolbar.tsx                     # File ▾ · Outline · Search · 음성 인식 · 이미지 인식 · AI 에이전트
│   │   ├── InlineDiffView.tsx              # Block-level accept/reject diff
│   │   ├── McpProposalView.tsx             # MCP propose_edit diff preview (accept/reject)
│   │   ├── DriveBrowser.tsx                # Google Drive open/save browser
│   │   ├── KanbanView.tsx                  # Kanban board view + inline card editing
│   │   ├── BackgroundPicker.tsx            # Custom editor background color
│   │   ├── TableBubbleMenu.tsx             # Inline table editing menu
│   │   ├── FloatingAIBar.tsx               # Selection popup for AI actions
│   │   ├── OutlinePanel.tsx                # H1–H6 navigator
│   │   ├── RecentFilesPanel.tsx            # Recent file list (also in File menu submenu)
│   │   └── StatusBar.tsx                   # Bottom status bar
│   ├── hooks/
│   │   ├── useAI.ts                        # AI state + selected LLM + notes state
│   │   ├── useConverter.ts                 # Tauri invoke wrappers + progress events
│   │   ├── useFileSystem.ts                # Tauri fs + web FS Access fallback
│   │   ├── useTheme.ts                     # Light/dark
│   │   └── useRecentFiles.ts               # Persisted recent files
│   ├── services/
│   │   ├── aiService.ts                    # Gemini SDK calls
│   │   ├── slideAssets.ts                  # Stock/logo/generated slide asset resolution
│   │   ├── secureStorage.ts                # Keychain wrapper + localStorage fallback
│   │   ├── platform.ts                     # isTauri() detection
│   │   └── knowaiAuth.ts                   # KnowAI SSO (login button)
│   ├── lib/
│   │   ├── kanban-parser.ts                # Markdown marker → Kanban cards
│   │   ├── kanbanEdit.ts                   # Single-line Markdown patches for card edits
│   │   ├── htmlSlides/                     # HTML slide templates and render pipeline
│   │   └── pptx-export.ts                  # PPTX slide renderer
│   └── types/                              # AI modes, converter, Kanban, slide types
├── src-tauri/                              # Rust backend
│   ├── src/
│   │   ├── lib.rs                          # Window mgmt + invoke handlers + MCP wiring
│   │   ├── mcp/mod.rs                      # MCP server (rmcp + axum) — read/edit open docs
│   │   ├── gdrive/                         # Google Drive OAuth + sync commands
│   │   ├── secrets.rs                      # Unified Keychain vault (batch save)
│   │   ├── print_pdf.rs                    # macOS WKWebView print → PDF export
│   │   └── converters/                     # doc-converter integration (Rust port)
│   │       ├── mod.rs                      # Model IDs, pricing, common types
│   │       ├── error.rs                    # ConverterError enum
│   │       ├── keychain.rs                 # macOS Keychain wrapper (3 providers)
│   │       ├── progress.rs                 # Tauri event emitter
│   │       ├── templates.rs                # Meeting note template loader
│   │       ├── commands.rs                 # Tauri command registrations
│   │       ├── audio_pipeline.rs           # Speech → text (chunking + context)
│   │       ├── audio_splitter.rs           # ffmpeg chunk splitter
│   │       ├── vad.rs                      # Silero VAD ONNX + ffmpeg concat demuxer
│   │       ├── diarize_local.rs            # Speaker diarization — local pyannote (Python sidecar)
│   │       ├── diarize_cloud.rs            # Speaker diarization — pyannote.ai cloud API
│   │       ├── speaker_dedup.rs            # LLM merge of mis-split speaker labels
│   │       ├── ocr_pipeline.rs             # 2-pass OCR + pdfium fallback
│   │       ├── notes_pipeline.rs           # Meeting notes generation
│   │       ├── pdf_extractor.rs            # PDF → PNG via pdfium-render
│   │       └── llm/
│   │           ├── gemini.rs               # inline + File API + exponential backoff
│   │           └── anthropic.rs            # Claude messages API + retry
│   ├── resources/
│   │   ├── silero_vad.onnx                 # VAD model (2.2 MB, bundled)
│   │   ├── diarize_pyannote.py             # Local diarization sidecar (pyannote.audio)
│   │   └── meeting-templates/              # Built-in templates (general/detailed/team-sync)
│   ├── capabilities/default.json           # Tauri v2 ACL (windows + event + fs scope)
│   └── tauri.conf.json                     # Bundle config
├── docs/                                   # Internal documentation
└── package.json
```

---

## 🗺 Roadmap

> **Core Vision**: *Read beautifully → Edit quickly → Convert anything → Export to final format*

- [x] **Phase 1**: Viewing — Font size, outline panel, reading mode, frontmatter box
- [x] **Phase 2**: Editing — Search & replace (Korean UI), recent files, multi-window
- [x] **Phase 3**: AI Editing — Grammar fix, translate, document improvement, inline diff, streaming
- [x] **Phase 3.5**: UX polish — Lucide icons, inline file rename, version display
- [x] **Phase 4**: Multimodal — Speech-to-text with VAD, image/PDF OCR, meeting notes (Claude/Gemini)
- [x] **Phase 4.5**: Integration — Unified settings, Keychain storage, multi-LLM selector (Gemini/Claude/OpenAI)
- [x] **Phase 5**: Speaker diarization — verified pyannote (local/cloud), speaker rename/merge
- [x] **Phase 6 (partial)**: Export — PDF (native WKWebView print), AI-planned PPTX, and template-based HTML slides. Google Docs still planned.
- [x] **Phase 7 (partial)**: Cloud sync — Google Drive (auto-upload + browse). Share links still planned.
- [x] **Phase 8**: Claude integration — in-process MCP server (read + edit open documents, diff-gated proposals)
- [x] **Phase 9**: Generation & visualization — slide (`.pptx` / `.html`) export, AI image generation (Gemini / ChatGPT / Grok, API key or subscription), mindmap / flowchart / Gantt / Kanban views and auto-generation
- [x] **Phase 9.5**: Kanban editing — full-color cards, inline card editing, date-range picker, progress slider, drag/drop column moves, and persisted `@order(...)` card ordering
- [x] **Phase 10**: Subscription OAuth — reuse Claude (Max) / ChatGPT (Plus) / Gemini (agy) / Grok logins for text & image generation
- [x] **Phase 11**: Grok (xAI) integration — text (grok-4.3) + image (Grok Imagine), API key & subscription; inline per-mode model dropdown with company logos
- [ ] **Next**: Google Docs export, share links

See [docs/TODO.md](docs/TODO.md) for the detailed roadmap.

---

## 🧪 Testing

```bash
# Rust unit tests (14 tests covering VAD post-process, timestamp mapping, regex extraction)
cargo test --manifest-path src-tauri/Cargo.toml --lib

# TypeScript type check
npx tsc --noEmit
```

---

## 🤝 Contributing

Contributions welcome:

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/amazing-feature`)
3. Commit your changes (`git commit -m 'feat(scope): add amazing feature'`)
4. Push to the branch (`git push origin feat/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the [GNU General Public License v3.0](LICENSE).

The Silero VAD model (silero_vad.onnx) is included under the [MIT license](https://github.com/snakers4/silero-vad).

Speaker diarization uses [pyannote](https://github.com/pyannote/pyannote-audio) — locally via the `pyannote.audio` Python package, or via the [pyannote.ai](https://pyannote.ai) cloud API. Models are gated on HuggingFace (free, accept once).

---

*Built by [KnowAI](https://knowai.space) · © 2026 KnowAI*
