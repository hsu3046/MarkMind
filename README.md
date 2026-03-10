<p align="center">
  <img src="src-tauri/icons/icon.png" alt="MarkMind" width="128" />
</p>

# MarkMind

## Tagline-en

Markdown is the format AI understands best.
But for most of us, it's not exactly easy on the eyes. That's why MarkMind was built.
An editor designed for people — to read and edit AI-generated text, effortlessly.

## Tagline-ko

마크다운은 AI가 가장 잘 이해하는 문서 형식입니다.
그런데 막상 읽으려면 눈에 잘 안 들어오죠. 그래서 MarkMind가 탄생했습니다.
AI가 만들어준 텍스트를, 사람이 가장 편하게 읽고 수정할 수 있는 에디터입니다.

## Tagline-ja

マークダウンは、AIが最も得意とする文書形式です。
でも、いざ読もうとすると、なんだか読みづらい。そこで生まれたのが MarkMind です。
AIが生成したテキストを、人が一番快適に読んで編集できるエディターです。

---

## Summary-en

Reading long AI-generated documents is frustrating, isn't it?
Too awkward in a browser, too disruptive to open in another app.
MarkMind was built for exactly that moment.
Just select the text and press one button.
Grammar fixes, translations, and improvements appear with every change clearly highlighted — and you choose what to keep.
Need to focus? Switch to reading mode. Want to compare? Open a split view.
Beautiful dark and light themes, available on both Mac and the web.

## Summary-ko

AI가 만든 긴 문서, 제대로 읽기가 불편하셨죠?
웹에서 열자니 어색하고, 다른 앱으로 옮기자니 흐름이 끊기고.
MarkMind는 바로 그 순간을 위해 만들어졌습니다.
텍스트를 선택하고 버튼 하나만 누르세요.
문법 교정, 번역, 문서 개선이 어디가 바뀌었는지 한눈에 보이고, 마음에 드는 부분만 골라서 반영할 수 있습니다.
집중해서 읽고 싶을 땐 읽기 모드로, 나란히 비교하고 싶을 땐 분할 화면으로.
아름다운 다크/라이트 테마와 함께, Mac 앱과 웹 모두에서 똑같이 쓸 수 있습니다.

## Summary-ja

AIが生成した長い文書、ちゃんと読むのが意外と不便ですよね。
ブラウザで開くと使いにくいし、別のアプリに移すと集中力が途切れてしまう。
MarkMind は、まさにその瞬間のために作られました。
テキストを選択して、ボタンを一つ押すだけ。
文法の修正、翻訳、文章の改善が、どこが変わったか一目でわかる形で表示され、気に入った部分だけを反映できます。
じっくり読みたいときは読書モードに、見比べたいときは分割画面に。
ダーク／ライトテーマの美しいインターフェースで、Mac アプリとウェブ、どちらでも同じように使えます。

---

## ✨ What It Does

- **Fixes grammar in-place** — Select text, tap "Grammar Fix," and see word-level highlights of every correction — accept or reject one by one.
- **Translates seamlessly** — Korean ↔ English ↔ Japanese with paragraph-by-paragraph before/after diffs so nothing gets lost.
- **Improves entire documents** — Speed mode (Gemini Flash) for quick polish or Quality mode (Gemini Pro) for deep rewrites.
- **Pops up an AI bar on selection** — Highlight any text in the editor and a floating action bar appears instantly — no panels to open.
- **Streams AI responses live** — Watch the rewrite appear in real time, then review the smart diff when it's done.
- **Renders beautiful previews** — Side-by-side split view, full-width reading mode, and synchronized scroll with code syntax highlighting.
- **Navigates with an outline panel** — Auto-extracted H1–H6 headings, click to jump, always in sync.
- **Opens multiple windows** — Cascade-positioned windows with `⌘N`, recent file access, and Finder file association for `.md` files.
- **Searches everywhere** — CodeMirror search in the editor (`⌘F`) plus DOM-based highlight search in preview mode.
- **Switches themes instantly** — Dark and light mode with Pretendard CJK-optimized typography.
- **Runs as a web app too** — Same React codebase deploys to the web with zero Tauri dependency.

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | [Tauri v2](https://v2.tauri.app) |
| Frontend | React 19 + TypeScript (Strict) |
| Editor | CodeMirror 6 |
| Markdown | react-markdown + remark-gfm + rehype-highlight |
| AI | Google Gemini SDK (@google/genai) |
| Icons | Lucide React |
| Build | Vite 7 |
| Backend | Rust |

---

## 📦 Installation

### macOS (Native App)

Download the latest `.dmg` from [Releases](https://github.com/yuhitomi/markmind/releases).

### Build from Source

```bash
# Prerequisites: Node.js 18+, Rust, Xcode CLI Tools

git clone https://github.com/yuhitomi/markmind.git
cd markmind
npm install

# Development (HMR enabled)
npm run tauri dev

# Production build
npm run tauri build
```

### Web Only

```bash
npm run dev
# Open http://localhost:5173
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
| Preview Mode | `⌘3` |
| Editor Mode | `⌘1` |
| Split View | `⌘2` |
| Zoom In | `⌘+` |
| Zoom Out | `⌘-` |
| Reset Zoom | `⌘0` |
| AI Assistant | `⌘I` |

---

## 📁 Project Structure

```
markmind/
├── src/                        # React frontend
│   ├── components/             # UI components
│   │   ├── AIPanel.tsx         # AI side panel (mode, prompt, streaming)
│   │   ├── Editor.tsx          # CodeMirror 6 editor
│   │   ├── Preview.tsx         # Markdown preview renderer
│   │   ├── Toolbar.tsx         # Top toolbar with actions
│   │   ├── InlineDiffView.tsx  # Block-level accept/reject diff
│   │   ├── FloatingAIBar.tsx   # Selection popup for AI actions
│   │   ├── DiffView.tsx        # Diff comparison renderer
│   │   ├── OutlinePanel.tsx    # H1–H6 heading navigator
│   │   ├── RecentFilesPanel.tsx # Recent file list
│   │   └── StatusBar.tsx       # Bottom status bar
│   ├── hooks/                  # Custom React hooks
│   │   └── useAI.ts            # AI service integration hook
│   ├── services/               # Platform detection, AI client, web FS
│   ├── types/                  # TypeScript types (AI modes, diff chunks)
│   ├── constants/              # Tutorial content
│   └── App.tsx                 # Root component
├── src-tauri/                  # Rust backend
│   ├── src/lib.rs              # Window management, file association
│   └── capabilities/           # Tauri v2 permissions
├── docs/                       # Internal documentation
│   ├── MEMORY.md               # Persistent AI/dev context
│   └── TODO.md                 # Feature roadmap
├── public/                     # Static assets
└── package.json                # Dependencies & scripts
```

---

## 🗺 Roadmap

> **Core Vision**: *Read beautifully → Edit quickly → Export to final format*

- [x] **Phase 1**: Viewing — Font size, outline panel, reading mode
- [x] **Phase 2**: Editing — Search & replace, recent files, multi-window
- [x] **Phase 3**: AI Editing — Grammar fix, translate, document improvement, inline diff
- [ ] **Phase 3.5**: UX polish — Start mode branching, icon-only toolbar
- [ ] **Phase 3.6**: AI prompt templates — CRUD, mode filtering, file-based sharing
- [ ] **Phase 3.7**: Internationalization — EN/KO/JA UI switching
- [ ] **Phase 4**: Export — PDF, Google Docs, PPTX conversion
- [ ] **Phase 5**: Cloud — Google Drive sync, share links

See [TODO.md](docs/TODO.md) for the detailed feature roadmap.

---

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/amazing-feature`)
3. Commit your changes (`git commit -m 'feat(scope): add amazing feature'`)
4. Push to the branch (`git push origin feat/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the [GNU General Public License v3.0](LICENSE).

---

*Built by [KnowAI](https://knowai.space) · © 2026 KnowAI*
