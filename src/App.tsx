import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AIMode, DiffChunk } from './types/ai';
import { Editor, EditorHandle } from './components/Editor';
import { McpProposalView } from './components/McpProposalView';
import { generateDiff } from './services/aiService';
import { Preview, type PreviewHandle } from './components/Preview';
import { MindmapView } from './components/MindmapView';
import { VaultGraphView } from './components/VaultGraphView';
import { FlowchartView } from './components/FlowchartView';
import { GanttView } from './components/GanttView';
import { Toolbar, ViewMode } from './components/Toolbar';
import { StatusBar } from './components/StatusBar';
import { OutlinePanel } from './components/OutlinePanel';
import { RecentFilesPanel } from './components/RecentFilesPanel';
import { AIPanel } from './components/AIPanel';
import { FloatingAIBar } from './components/FloatingAIBar';
import { InlineDiffView } from './components/InlineDiffView';
import { AuthCallback } from './components/AuthCallback';
import { SettingsModal } from './components/SettingsModal';
import { DriveBrowser } from './components/DriveBrowser';
import { LanFileBrowser } from './components/LanFileBrowser';
import { hasLanServer, lanReadFile } from './services/webFileSystem';
import type { DriveFile } from './services/gdriveService';
import { confirmAction } from './services/dialogService';
import { buildIndex, resolveTarget, type VaultFile } from './lib/vault';
import { useFileSystem } from './hooks/useFileSystem';
import { useTheme } from './hooks/useTheme';
import { useRecentFiles } from './hooks/useRecentFiles';
import { useScrollSync } from './hooks/useScrollSync';
import { useAI } from './hooks/useAI';
import { useAuth } from './hooks/useAuth';
import { useConverter } from './hooks/useConverter';
import { isTauri } from './services/platform';
import { getCallbackPath } from './services/knowaiAuth';
import { TUTORIAL_CONTENT } from './constants/tutorial';
import { Link, Unlink, Mic, ScanText, BookOpen, X as IconX, Sparkles, Loader2 } from 'lucide-react';
import { ConvertSidebar } from './components/sidebar/ConvertSidebar';
import { AudioTab } from './components/convert/AudioTab';
import { OcrTab } from './components/convert/OcrTab';
import type { DroppedFile } from './components/convert/types';
import './App.css';
import './components/convert/convert.css';
import './components/sidebar/sidebar.css';

const FONT_SIZE_MIN = 12;
const FONT_SIZE_MAX = 28;
const FONT_SIZE_DEFAULT = 14;

/** MCP 제안 배너용 — 변경 구역(연속된 removed/added 런) 개수. 빈 unchanged
    separator 가 구역을 가르므로 removed+added 쌍 1개 = 1곳으로 집계된다. */
function countMcpChanges(chunks: DiffChunk[]): number {
  let n = 0;
  let inChange = false;
  for (const c of chunks) {
    const changed = c.type !== 'unchanged';
    if (changed && !inChange) n++;
    inChange = changed;
  }
  return n;
}

function App() {
  const { theme, setThemeTransient, resetThemeToOS } = useTheme();
  const auth = useAuth();
  const [isAuthCallback, setIsAuthCallback] = useState(
    () => window.location.pathname === getCallbackPath()
  );
  // Callback ref: switch to preview when a real file is opened
  // Using a ref avoids initialization order issues (viewMode state declared below)
  const onFileOpenedRef = useRef<(() => void) | undefined>(undefined);
  // Drill-in (mindmap → linked doc) suppresses the auto preview-switch + manages nav.
  const drillingRef = useRef(false);
  // Jump-to-section: line to scroll to once the editor mounts (set when jumping from mindmap/graph).
  const pendingScrollLineRef = useRef<number | null>(null);
  const {
    content,
    filePath,
    fileName,
    isDirty,
    updateContent,
    openFile,
    saveFile,
    saveFileAs,
    newFile,
    openFromRecent,
    loadFromMemory,
    renameFile,
  } = useFileSystem(
    () => onFileOpenedRef.current?.(),
    // 저장 직전: 본문의 임시(절대경로) 이미지를 문서 assets/ 로 복사 + 상대경로 치환(#56)
    useCallback(async (c: string, path: string) => {
      const { flushImagesOnSave } = await import('./lib/imageAttach');
      return (await flushImagesOnSave(c, path)).content;
    }, []),
  );

  const { recentFiles, addRecentFile, removeRecentFile, clearRecentFiles } =
    useRecentFiles();

  const [viewMode, setViewMode] = useState<ViewMode>('editor');
  const [splitRatio, setSplitRatio] = useState(0.5);
  // Drill-in breadcrumb stack (mindmap "마인드맵 속 마인드맵" navigation).
  const [mindmapNav, setMindmapNav] = useState<{ filePath: string; fileName: string; content: string }[]>([]);

  // Wire up the file-opened callback now that viewMode/setViewMode exist
  onFileOpenedRef.current = () => {
    // Drill-in manages its own view mode + nav stack — don't reset to preview.
    if (drillingRef.current) return;
    setViewMode('preview');
    setReadingMode(false);
    setMindmapNav([]); // a regular file open ends any drill-in trail
  };
  const { syncEnabled, toggleSync, reattach } = useScrollSync(true);
  const [fontSize, setFontSize] = useState(() => {
    const saved = localStorage.getItem('md-editor-font-size');
    return saved ? parseInt(saved, 10) : FONT_SIZE_DEFAULT;
  });
  // 행간 — compact (1.5) / normal (1.8) / relaxed (2.2) cycle, localStorage 보존
  const [lineHeight, setLineHeight] = useState<'compact' | 'normal' | 'relaxed'>(() => {
    const v = localStorage.getItem('markmind-line-height');
    return v === 'compact' || v === 'relaxed' ? v : 'normal';
  });
  useEffect(() => {
    localStorage.setItem('markmind-line-height', lineHeight);
  }, [lineHeight]);
  const cycleLineHeight = () => {
    setLineHeight((prev) =>
      prev === 'compact' ? 'normal' : prev === 'normal' ? 'relaxed' : 'compact',
    );
  };

  // 배경색 — 빈 문자열 = 테마 기본, 그 외엔 사용자 지정 CSS color
  const [bgColor, setBgColor] = useState<string>(
    () => localStorage.getItem('markmind-bg-color') || '',
  );
  useEffect(() => {
    if (bgColor) localStorage.setItem('markmind-bg-color', bgColor);
    else localStorage.removeItem('markmind-bg-color');
  }, [bgColor]);

  // 배경색의 WCAG 상대 휘도 (0~1). 0.5 미만이면 dark 텍스트가 안 보임 → theme dark 로.
  const luminance = useMemo(() => {
    if (!bgColor) return null;
    const hex = bgColor.replace('#', '');
    if (hex.length !== 3 && hex.length !== 6) return null;
    const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
    const r = parseInt(full.slice(0, 2), 16) / 255;
    const g = parseInt(full.slice(2, 4), 16) / 255;
    const b = parseInt(full.slice(4, 6), 16) / 255;
    const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }, [bgColor]);

  // bgColor 변경 시 theme transient 동기화 (localStorage 안 건드림 → 다음 세션 OS follow 유지).
  // bgColor='' (기본) 으로 되돌리면 OS prefers-color-scheme 으로 복귀 — 사용자가 dark bg 후
  // "기본" 골라도 dark theme 에 갇히지 않음.
  useEffect(() => {
    if (luminance == null) {
      resetThemeToOS();
      return;
    }
    setThemeTransient(luminance < 0.5 ? 'dark' : 'light');
  }, [luminance, setThemeTransient, resetThemeToOS]);
  const [outlineVisible, setOutlineVisible] = useState(false);
  const [readingMode, setReadingMode] = useState(false);
  const [tutorialVisible, setTutorialVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [driveBrowserMode, setDriveBrowserMode] = useState<'open' | 'save' | null>(null);
  // LAN 서버 모드(아이폰 브라우저 등)에서 공유 폴더 파일 목록 브라우저
  const [lanBrowserVisible, setLanBrowserVisible] = useState(false);
  const [recentPanelVisible, setRecentPanelVisible] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatchCount, setSearchMatchCount] = useState(0);
  const [searchCurrentIndex, setSearchCurrentIndex] = useState(-1);
  const searchMatchesRef = useRef<HTMLElement[]>([]);
  const searchCurrentIndexRef = useRef(-1);
  const isDragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // viewMode 전환 시 scroll 위치 보존 — Markdown(CodeMirror) ↔ Rich Text(.preview-wrapper) ↔ Split
  const scrollRatioRef = useRef<number>(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<EditorHandle>(null);
  const previewRef = useRef<PreviewHandle>(null); // Rich Text 이미지 삽입 라우팅(#56)

  // PDF export — 옵션 B1: WKWebView.createPDFWithConfiguration 으로 dialog 없이
  // PDF 생성 + tauri-plugin-dialog 의 save() 로 사용자 저장 위치 지정.
  //
  // 이전 옵션 A (NSPrintOperation modal dialog) 는 paperSize/horizontallyCentered
  // 명시해도 사용자 환경에 따라 비대칭 잔존 + dialog UX 부담. B1 은:
  //   1) preview 강제 + hydration 대기
  //   2) save dialog → path
  //   3) invoke('export_pdf', { path }) → Rust 가 WKWebView createPDF + fs write
  //   4) viewMode 복원
  const prevViewModeRef = useRef<ViewMode | null>(null);
  const handleExportPdf = useCallback(async () => {
    if (viewMode === 'editor' || viewMode === 'split') {
      prevViewModeRef.current = viewMode;
      setViewMode('preview');
      await new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r())),
      );
      await new Promise<void>((r) => setTimeout(r, 80));
    }

    const defaultName = (fileName || 'Untitled').replace(/\.md$/i, '') + '.pdf';
    try {
      const [{ save }, { invoke }] = await Promise.all([
        import('@tauri-apps/plugin-dialog'),
        import('@tauri-apps/api/core'),
      ]);
      const path = await save({
        defaultPath: defaultName,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
        title: 'PDF로 내보내기',
      });
      if (!path) {
        // 사용자 취소
        return;
      }
      await invoke('export_pdf', { path });
    } catch (err) {
      console.error('[export_pdf] failed:', err);
    } finally {
      if (prevViewModeRef.current) {
        setViewMode(prevViewModeRef.current);
        prevViewModeRef.current = null;
      }
    }
  }, [viewMode, fileName]);

  // ⌘P / Ctrl+P 단축키 (IME 합성 중 보호)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'p' && !e.shiftKey) {
        if (e.isComposing || e.keyCode === 229) return;
        e.preventDefault();
        handleExportPdf();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleExportPdf]);

  // PPTX export (이슈 #6) — 규칙 기반 + LLM 스마트 레이아웃.
  // 프론트 PptxGenJS 로 ArrayBuffer 생성 → Rust save_pptx 로 저장(WKWebView blob 버그 우회).
  const [pptxAiProviders, setPptxAiProviders] = useState<{ claude: boolean; gemini: boolean }>({
    claude: false,
    gemini: false,
  });
  // PPTX 내보내기 진행 표시(특히 AI 레이아웃은 LLM 호출로 수초~수십초 소요).
  const [pptxBusy, setPptxBusy] = useState<string | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const [claude, gemini] = await Promise.all([
          invoke<boolean>('has_api_key', { provider: 'claude' }),
          invoke<boolean>('has_api_key', { provider: 'gemini' }),
        ]);
        setPptxAiProviders({ claude, gemini });
      } catch {
        /* 키 조회 실패 시 AI 옵션 비활성 유지 */
      }
    })();
  }, [settingsVisible]);

  // PPTX 내보내기 — LLM 스마트 레이아웃 단일 경로(디폴트). 규칙 기반은 LLM 응답을
  // 전혀 해석 못한 catastrophic 실패 시의 안전망으로만 내부 사용한다.
  const handleExportPptx = useCallback(async () => {
    if (!pptxAiProviders.claude && !pptxAiProviders.gemini) {
      alert('PPTX 내보내기는 AI 레이아웃을 사용합니다. Settings 에서 Claude 또는 Gemini API 키를 등록하세요.');
      return;
    }
    const baseName = (fileName || 'Untitled').replace(/\.(md|markdown|mdx|txt)$/i, '');
    try {
      const [{ save }, { invoke }, { markdownToSlides, slidesFromLlmJson }, { buildPptx }] =
        await Promise.all([
          import('@tauri-apps/plugin-dialog'),
          import('@tauri-apps/api/core'),
          import('./lib/markdownToSlides'),
          import('./lib/buildPptx'),
        ]);
      const path = await save({
        defaultPath: `${baseName}.pptx`,
        filters: [{ name: 'PowerPoint', extensions: ['pptx'] }],
        title: 'PPTX로 내보내기',
      });
      if (!path) return; // 사용자 취소

      const provider = pptxAiProviders.claude ? 'claude' : 'gemini';
      setPptxBusy(`AI 슬라이드 생성 중… (${provider === 'claude' ? 'Claude' : 'Gemini'})`);

      const raw = await invoke<string>('generate_slides_llm', { markdown: content, provider });
      let slides = slidesFromLlmJson(raw);
      console.log(
        `[export_pptx] AI(${provider}) 응답 ${raw.length}자 → 슬라이드 ${slides?.length ?? 0}장`,
      );
      if (!slides || slides.length === 0) {
        // 조용한 폴백 금지 — 사용자에게 알리고 원문 로깅(메모리: silent fallback 함정)
        console.warn('[export_pptx] AI 응답 파싱 실패, 규칙 기반 안전망으로 폴백. 원문:', raw);
        alert('AI 응답을 해석하지 못해 기본 레이아웃으로 저장합니다.\n(개발자 콘솔에 원문이 로깅되었습니다)');
        slides = markdownToSlides(content);
      }

      setPptxBusy('PPTX 파일 생성 중…');
      const baseDir = filePath ? filePath.replace(/\/[^/]*$/, '') : undefined;
      const buf = await buildPptx(slides, { title: baseName, baseDir });
      await invoke('save_pptx', { path, data: Array.from(new Uint8Array(buf)) });
    } catch (err) {
      console.error('[export_pptx] failed:', err);
      alert(`PPTX 내보내기에 실패했습니다.\n${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPptxBusy(null);
    }
  }, [fileName, filePath, content, pptxAiProviders]);

  // AI
  const ai = useAI();
  // AI 결과(InlineDiff)는 에디터 페인에서만 보이므로, 마인드맵/그래프 뷰에서
  // 실행해 응답이 오면 에디터로 전환해 diff 를 보이게 한다(구조화 등).
  useEffect(() => {
    if (ai.response && !ai.isLoading && (viewMode === 'mindmap' || viewMode === 'graph')) {
      setViewMode('editor');
    }
  }, [ai.response, ai.isLoading, viewMode]);
  const [selectedText, setSelectedText] = useState('');
  const [selectionCoords, setSelectionCoords] = useState<{ top: number; left: number } | null>(null);
  const aiSelectionRef = useRef<{ fullContent: string; selectedText: string } | null>(null);

  // MCP propose_edit — Claude 수정 제안을 큐에 쌓아 head 부터 순차 검토(#39).
  // 무인증 localhost 라 여러 클라이언트(Claude Desktop + Cursor 등)가 같은 창에 동시
  // propose 를 보낼 수 있다. 단일 슬롯이면 뒤 제안이 앞 제안을 덮어 첫 제안이 손실되므로
  // 큐(FIFO)로 보관 — 사용자가 하나 수락/거절하면 다음 제안이 이어서 표시된다.
  type McpQueuedProposal = {
    requestId: string;
    newContent: string;
    description?: string;
    // 제안 도착 시점의 문서 내용 — 수락 시 그 사이 변경(lost update) 감지용.
    arrivalContent: string;
  };
  const MCP_QUEUE_MAX = 50; // 안전장치 — 무한 누적 방지
  const [mcpProposals, setMcpProposals] = useState<McpQueuedProposal[]>([]);
  const head = mcpProposals[0] ?? null;
  // 제안 도착 시 뷰를 뺏지 않고 배너만 띄운다. '변경 보기' 누르면 오버레이로 diff 리뷰.
  // (현재 뷰 모드 무관 — 리치 텍스트로 보던 중에도 그대로 유지.)
  const [mcpReviewOpen, setMcpReviewOpen] = useState(false);
  // 리스너 클로저가 항상 최신 content 로 diff 를 만들도록 ref 로 추적(렌더마다 동기 갱신).
  const latestContentRef = useRef(content);
  latestContentRef.current = content;
  // head 표시 뷰 — chunks 를 현재 content 기준으로 파생한다. 앞 제안 수락으로 content 가
  // 바뀌어도 다음 제안 diff 가 현재 기준으로 정확. 큐가 비면 계산하지 않음.
  const mcpHeadView = useMemo(
    () => (head ? { ...head, chunks: generateDiff(content, head.newContent) } : null),
    [head, content],
  );
  // 리스너(deps []) 가 stale 없이 쓰도록 ref 로 최신 큐 추적.
  const mcpProposalsRef = useRef(mcpProposals);
  mcpProposalsRef.current = mcpProposals;
  // MCP 리스너가 AI diff 정리를 stale 없이 호출하도록 ref 경유.
  const clearAiDiffRef = useRef<() => void>(() => {});
  clearAiDiffRef.current = () => {
    if (ai.response) ai.setResponse(null);
    aiSelectionRef.current = null;
  };
  // 아래 ackMcpProposal 정의 후 .current 가 채워진다(listener deps [] 경유 호출용).
  const ackMcpProposalRef = useRef<(rid: string, accepted: boolean, cc: number | null) => void>(
    () => {},
  );

  // Convert (음성/이미지) 사이드바 — AI Agent 와 mutex
  // (회의록 작성은 AI Agent의 'meeting-notes' 모드로 병합됨)
  const converter = useConverter();
  const [audioPanelVisible, setAudioPanelVisible] = useState(false);
  const [ocrPanelVisible, setOcrPanelVisible] = useState(false);

  const closeAllConvertPanels = useCallback(() => {
    setAudioPanelVisible(false);
    setOcrPanelVisible(false);
  }, []);

  // 사이드 패널 열 때 reading mode 만 해제 — 현재 viewMode 는 그대로 유지
  // (이전엔 강제로 editor 모드로 전환했으나 사용자 의도와 어긋남)
  const exitReadingMode = useCallback(() => {
    if (readingMode) setReadingMode(false);
  }, [readingMode]);

  const handleToggleAI = useCallback(() => {
    if (!ai.panelVisible) {
      exitReadingMode();
      closeAllConvertPanels();
    }
    ai.togglePanel();
  }, [ai, exitReadingMode, closeAllConvertPanels]);

  const handleToggleAudio = useCallback(() => {
    if (audioPanelVisible) {
      setAudioPanelVisible(false);
    } else {
      if (ai.panelVisible) ai.togglePanel();
      setOcrPanelVisible(false);
      exitReadingMode();
      setAudioPanelVisible(true);
    }
  }, [audioPanelVisible, ai, exitReadingMode]);

  const handleToggleOcr = useCallback(() => {
    if (ocrPanelVisible) {
      setOcrPanelVisible(false);
    } else {
      if (ai.panelVisible) ai.togglePanel();
      setAudioPanelVisible(false);
      exitReadingMode();
      setOcrPanelVisible(true);
    }
  }, [ocrPanelVisible, ai, exitReadingMode]);

  // 사이드바로 drop된 파일을 자식 컴포넌트에 전달하기 위한 state
  const [audioDropped, setAudioDropped] = useState<DroppedFile | null>(null);
  const [ocrDropped, setOcrDropped] = useState<DroppedFile | null>(null);
  const [dragActive, setDragActive] = useState(false); // #14 파일 드롭 시각 피드백

  // 최신 패널 state 를 ref 로 유지 — useEffect deps 최소화 (listener 등록/해제 빈도 ↓)
  const panelStateRef = useRef({ audioPanelVisible: false, ocrPanelVisible: false });
  useEffect(() => {
    panelStateRef.current = { audioPanelVisible, ocrPanelVisible };
  }, [audioPanelVisible, ocrPanelVisible]);

  // drop 시 이미지를 활성 에디터로 라우팅하기 위해 viewMode 를 ref 로(#56)
  const viewModeRef = useRef(viewMode);
  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  // 드래그&드롭 핸들러에서 최신 handleOpenInCurrentEditor 를 stale 없이 호출(#14)
  const handleOpenInCurrentEditorRef = useRef<((path: string) => Promise<void>) | null>(null);

  // OS-level 파일 드롭 라우팅 (mount 시 1회만 등록)
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | null = null;
    let disposed = false;
    (async () => {
      try {
        const { getCurrentWebview } = await import('@tauri-apps/api/webview');
        const { invoke } = await import('@tauri-apps/api/core');
        // 공식 onDragDropEvent — enter/over/drop/leave 를 한 핸들러에서 받는다(Tauri v2).
        const fn = await getCurrentWebview().onDragDropEvent(async (event) => {
          const p = event.payload;
          // 드롭 영역 시각 피드백(#14): hover 중엔 overlay 표시, drop/cancel 시 해제
          if (p.type === 'enter' || p.type === 'over') { setDragActive(true); return; }
          if (p.type === 'leave') { setDragActive(false); return; }
          // 이하 p.type === 'drop'
          setDragActive(false);
          const paths = p.paths ?? [];
          if (paths.length === 0) return;
          const mdExts = ['md','markdown','mdx','txt'];
          // 첨부 대상 이미지 확장자 (pdf 제외 — pdf 는 OCR 패널 전용)
          const imageExts = ['png','jpg','jpeg','webp','heic','heif','gif'];

          // 드롭 좌표 → 마우스가 가리킨 문서 위치에 삽입(#56). macOS 의 Tauri drop position 은
          // 이미 logical(CSS) 좌표라 devicePixelRatio 로 나누면 안 된다(나누면 위쪽으로 쏠림).
          const dropPos = (p as { position?: { x: number; y: number } }).position;
          const cx = dropPos ? dropPos.x : null;
          const cy = dropPos ? dropPos.y : null;

          // 드롭한 외부 이미지(절대경로)를 활성 에디터의 드롭 지점에 `![](절대경로)` 삽입(#56).
          // Rich Text(preview) 모드면 Tiptap, 그 외(editor/split)면 CodeMirror 로 라우팅.
          // 표시는 #55(asset://), 실제 assets/ 복사·상대경로 치환은 저장 시 flush 가 처리.
          const insertImageAbs = (absPath: string) => {
            if (viewModeRef.current === 'preview') {
              if (cx != null && cy != null) previewRef.current?.insertImageAtCoords(absPath, cx, cy);
              else previewRef.current?.insertImageMarkdown(absPath);
            } else {
              if (cx != null && cy != null) editorRef.current?.insertAtCoords(`\n![](${absPath})\n`, cx, cy);
              else editorRef.current?.insertAtCursor(`\n![](${absPath})\n`);
            }
          };

          // 여러 파일 동시 드롭: 마크다운은 새 창, 이미지는 전부 삽입(#56), 나머지 무시.
          if (paths.length > 1) {
            for (const fp of paths) {
              const e = fp.split('.').pop()?.toLowerCase() ?? '';
              if (mdExts.includes(e)) {
                try { await invoke('open_new_window', { filePath: fp }); }
                catch (err) { console.error('[App] 새 창 열기 실패:', err); }
              } else if (imageExts.includes(e)) {
                insertImageAbs(fp);
              }
            }
            return;
          }

          const path = paths[0];
          const ext = path.split('.').pop()?.toLowerCase() ?? '';
          const name = path.split(/[\\/]/).pop() ?? path;
          const audioExts = ['mp3','wav','m4a','qta','aac','ogg','flac','wma','amr','opus','mp4','mov','webm','m4v'];
          const ocrExts = ['png','jpg','jpeg','webp','heic','heif','gif','pdf'];
          const { audioPanelVisible: audOn, ocrPanelVisible: ocrOn } = panelStateRef.current;

          // 1) 활성 사이드바 우선 라우팅 (명시적 OCR/음성 패널은 그대로 유지)
          if (audOn && audioExts.includes(ext)) {
            setAudioDropped({ path, name });
            return;
          }
          if (ocrOn && ocrExts.includes(ext)) {
            setOcrDropped({ path, name });
            return;
          }

          // 2) 사이드바 비활성 + 이미지 → 활성 에디터에 삽입(#56, 기존 자동 OCR 대체).
          //    미저장 문서여도 OK — 저장 시 flush 가 assets/ 로 복사·치환.
          if (imageExts.includes(ext)) {
            insertImageAbs(path);
            return;
          }

          // 3) 마크다운/텍스트 → 현재 창에서 열기 (unsaved 시 확인). #14:
          // 기존엔 무동작이었음(RunEvent::Opened 는 Finder 더블클릭용이라 드롭엔 안 불림).
          if (mdExts.includes(ext)) {
            await handleOpenInCurrentEditorRef.current?.(path);
          }
        });
        // 등록 완료 전에 cleanup 됐으면(StrictMode/리렌더) 즉시 해제 — 리스너 누수/중복 방지
        if (disposed) { fn(); return; }
        unlisten = fn;
      } catch (err) {
        console.warn('[App] drop listener 등록 실패:', err);
      }
    })();
    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
    // mount 시 1회만 등록 — 핸들러 내부는 ref/setState 로만 접근(외부 의존 없음)
  }, []);

  /**
   * 변환 결과를 현재 에디터에 로드. 기존 파일 처리:
   * - dirty 면: confirm 후 저장 안 된 변경 폐기
   * - clean 이면: 곧바로 교체
   * 패널은 닫지 않음 (사용자가 다른 결과도 열어볼 수 있게)
   */
  const handleOpenInCurrentEditor = useCallback(
    async (path: string) => {
      if (isDirty) {
        let ok = false;
        if (isTauri()) {
          // Tauri native dialog (main thread block 안 함, macOS 표준 UI)
          try {
            const { ask } = await import('@tauri-apps/plugin-dialog');
            ok = await ask(
              '현재 문서에 저장되지 않은 변경사항이 있습니다.\n' +
              '변환 결과로 교체하시겠습니까? (변경사항은 사라집니다)',
              { title: '저장 안 됨', kind: 'warning' },
            );
          } catch {
            // dialog plugin 실패 시 fallback
            ok = confirm('변경사항이 사라집니다. 결과로 교체할까요?');
          }
        } else {
          ok = confirm('변경사항이 사라집니다. 결과로 교체할까요?');
        }
        if (!ok) return;
      }
      try {
        const text = await converter.readFileText(path);
        const name = path.split(/[\\/]/).pop() ?? path;
        openFromRecent(path, text, name);
      } catch (err) {
        console.error('[App] 결과 파일 읽기 실패:', err);
        alert('결과 파일 읽기 실패: ' + err);
      }
    },
    [isDirty, openFromRecent, converter],
  );
  // drag&drop 핸들러(mount 1회 등록)가 최신 handleOpenInCurrentEditor 를 ref 로 호출(#14)
  useEffect(() => {
    handleOpenInCurrentEditorRef.current = handleOpenInCurrentEditor;
  }, [handleOpenInCurrentEditor]);

  // ─── Mindmap drill-in (M2): open the document a node links to ───
  // Vault root = the current file's directory. Resolves [[wikilinks]] / [..](rel.md)
  // against the vault; opens the target in place (same window, stays in mindmap) and
  // pushes a breadcrumb. Unresolved targets are created on click (Obsidian behavior).
  const openInPlaceForDrill = useCallback((path: string, text: string, name: string) => {
    drillingRef.current = true;
    openFromRecent(path, text, name);
    drillingRef.current = false;
    setViewMode('mindmap');
  }, [openFromRecent]);

  const handleOpenLinkedDocument = useCallback(async (target: string, isWiki: boolean) => {
    if (!isTauri()) return;
    if (!filePath) {
      await confirmAction('문서를 먼저 저장하면 연결된 문서로 이동할 수 있어요.', { title: '안내', kind: 'info' });
      return;
    }
    // persist current edits before navigating away
    if (isDirty) {
      const r = await saveFile();
      if (r !== 'saved') return;
    }
    const root = filePath.slice(0, filePath.lastIndexOf('/'));
    const fromRel = filePath.slice(root.length + 1);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const files = await invoke<VaultFile[]>('scan_vault', { root });
      const hit = resolveTarget(target, isWiki, fromRel, buildIndex(files));
      const snapshot = { filePath, fileName, content };
      if (hit) {
        setMindmapNav((s) => [...s, snapshot]);
        openInPlaceForDrill(`${root}/${hit.path}`, hit.content, hit.name);
      } else {
        // create-on-click
        const baseName = (target.split('/').pop() ?? target).replace(/\.(md|markdown|mdx|txt)$/i, '');
        const rel = isWiki ? `${target}.md` : target;
        const stub = `# ${baseName}\n`;
        const created = await invoke<{ path: string; content: string }>('create_file_at', { root, relPath: rel, content: stub });
        const name = created.path.split('/').pop() ?? `${baseName}.md`;
        setMindmapNav((s) => [...s, snapshot]);
        openInPlaceForDrill(created.path, created.content, name);
      }
    } catch (err) {
      console.error('[App] 연결 문서 열기 실패:', err);
      alert('연결된 문서를 열지 못했어요: ' + err);
    }
  }, [filePath, fileName, content, isDirty, saveFile, openInPlaceForDrill]);

  // Vault graph node click → open that file (resets the drill breadcrumb).
  const handleOpenVaultFile = useCallback((absPath: string, fileContent: string, name: string) => {
    setMindmapNav([]);
    openInPlaceForDrill(absPath, fileContent, name);
  }, [openInPlaceForDrill]);

  // Vault graph ghost click → create the note then open it.
  const handleOpenVaultGhost = useCallback(async (name: string) => {
    if (!filePath || !isTauri()) return;
    const root = filePath.slice(0, filePath.lastIndexOf('/'));
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const stub = `# ${name}\n`;
      const created = await invoke<{ path: string; content: string }>('create_file_at', { root, relPath: `${name}.md`, content: stub });
      const fn = created.path.split('/').pop() ?? `${name}.md`;
      setMindmapNav([]);
      openInPlaceForDrill(created.path, created.content, fn);
    } catch (err) {
      console.error('[App] vault ghost 생성 실패:', err);
      alert('문서 생성 실패: ' + err);
    }
  }, [filePath, openInPlaceForDrill]);

  const handleMindmapBack = useCallback(async () => {
    if (mindmapNav.length === 0) return;
    if (isDirty) {
      const r = await saveFile();
      if (r !== 'saved') return;
    }
    const prev = mindmapNav[mindmapNav.length - 1];
    setMindmapNav((s) => s.slice(0, -1));
    openInPlaceForDrill(prev.filePath, prev.content, prev.fileName);
  }, [mindmapNav, isDirty, saveFile, openInPlaceForDrill]);

  // 마인드맵/그래프 노드의 "이 섹션으로 이동" — 에디터 라인으로 스크롤.
  // 다른 뷰면 split 으로 전환 후 에디터 마운트를 기다렸다가 스크롤.
  const handleJumpToSource = useCallback((line: number) => {
    if (viewMode === 'editor' || viewMode === 'split') {
      editorRef.current?.scrollToLine(line);
    } else {
      pendingScrollLineRef.current = line;
      setViewMode('split');
      setReadingMode(false);
    }
  }, [viewMode]);

  useEffect(() => {
    if ((viewMode === 'editor' || viewMode === 'split') && pendingScrollLineRef.current != null) {
      const line = pendingScrollLineRef.current;
      pendingScrollLineRef.current = null;
      const t = setTimeout(() => editorRef.current?.scrollToLine(line), 120);
      return () => clearTimeout(t);
    }
  }, [viewMode]);

  // AIPanel "실행" 클릭 → 모드에 따라 분기
  // - meeting-notes: converter.runNotes (새 .md 생성)
  // - 그 외: ai.runAI (현재 content 변형 → InlineDiff)
  const handleAIRun = useCallback(async (runContent: string, runPrompt?: string) => {
    if (ai.mode === 'meeting-notes') {
      ai.setNotesResult(null);
      ai.setError(null);
      ai.setIsLoading(true);
      try {
        // 회의록 백엔드는 gemini/claude 만 지원 → 그 외(openai/pyannoteai)는 Claude 폴백
        const provider = ai.selectedModel === 'gemini' ? 'gemini' : 'claude';
        const result = await converter.runNotes({
          transcript: runContent,
          template: ai.notesTemplate,
          source: fileName || 'document.md',
          provider,
        });
        if (result) ai.setNotesResult(result);
      } catch (err) {
        ai.setError(err instanceof Error ? err.message : '회의록 생성 실패');
      } finally {
        ai.setIsLoading(false);
      }
    } else {
      await ai.runAI(runContent, runPrompt);
    }
  }, [ai, converter, fileName]);

  const handleSelectionChange = useCallback((text: string, coords: { top: number; left: number } | null) => {
    // FloatingAIBar(선택 시 AI 액션 팝업) 용 — selection 텍스트/좌표 추적.
    setSelectedText(text);
    setSelectionCoords(coords);
  }, []);

  // 클립보드 이미지 붙여넣기(CodeMirror) → $TEMP 에 임시 저장 후 절대경로 `![]()` 삽입(#56).
  // 미저장 문서여도 OK — 저장 시 flush 가 assets/ 로 복사·치환한다.
  const handleImagePaste = useCallback(async (file: File) => {
    try {
      const { writeTempImage, extFromMime } = await import('./lib/imageAttach');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const path = await writeTempImage(bytes, extFromMime(file.type));
      editorRef.current?.insertAtCursor(`\n![](${path})\n`);
    } catch (err) {
      console.error('[App] 클립보드 이미지 첨부 실패:', err);
    }
  }, []);

  // MCP propose_edit 수락/거절 결과를 백엔드 tool 에 ack.
  const ackMcpProposal = useCallback((requestId: string, accepted: boolean, charCount: number | null) => {
    import('@tauri-apps/api/core')
      .then(({ invoke }) =>
        invoke('mcp_apply_edit_result', {
          requestId,
          ok: accepted,
          error: accepted ? null : '사용자가 제안을 거절했습니다',
          charCount,
        }),
      )
      .catch(() => {});
  }, []);
  ackMcpProposalRef.current = ackMcpProposal;

  // MCP propose_edit 수락(큐 head) — lost update(B) 방지: 제안 도착 이후 문서가 바뀌었으면
  // 그 변경분을 전체 교체로 덮어쓰기 전에 사용자에게 확인한다. 처리 후 head 를 큐에서 제거.
  const acceptMcpProposal = useCallback(async () => {
    const p = mcpProposalsRef.current[0];
    if (!p) return;
    if (latestContentRef.current !== p.arrivalContent) {
      const ok = await confirmAction(
        '제안을 만든 이후 문서가 변경되었습니다. 그래도 제안 내용으로 전체 교체할까요? (그 사이 변경분이 사라집니다)',
        { title: '덮어쓰기', kind: 'warning' },
      );
      if (!ok) return; // 모달 유지 — 사용자가 거절 버튼으로 명시적으로 닫게 함
    }
    updateContent(p.newContent);
    ackMcpProposal(p.requestId, true, [...p.newContent].length);
    setMcpProposals((q) => q.slice(1)); // head 제거 → 다음 제안이 배너로 표시
    setMcpReviewOpen(false);
  }, [ackMcpProposal, updateContent]);

  const rejectMcpProposal = useCallback(() => {
    const p = mcpProposalsRef.current[0];
    if (!p) return;
    ackMcpProposal(p.requestId, false, null);
    setMcpProposals((q) => q.slice(1));
    setMcpReviewOpen(false);
  }, [ackMcpProposal]);

  // MCP 리뷰 오버레이 ESC = 닫기(거절 아님 — 배너로 복귀). capture 로 다른 ESC
  // 핸들러(검색 닫기/리딩 모드)보다 먼저 가로채 부수효과를 막는다.
  useEffect(() => {
    if (!mcpReviewOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setMcpReviewOpen(false);
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [mcpReviewOpen]);

  // Outline panel: jump to heading in editor or preview depending on current mode
  const handleOutlineClick = useCallback((id: string, line: number) => {
    if (viewMode !== 'preview') {
      // Editor / split mode: move cursor to the heading line in CodeMirror
      editorRef.current?.scrollToLine(line);
    } else {
      // Preview mode: scroll the rendered heading into view
      const previewEl = document.querySelector('.preview-wrapper');
      if (!previewEl) return;
      const headingEls = previewEl.querySelectorAll('h1, h2, h3');
      for (const h of headingEls) {
        const hId = (h.textContent || '')
          .toLowerCase()
          .replace(/[^\w\s가-힣ぁ-んァ-ヶ一-龠-]/g, '')
          .replace(/\s+/g, '-');
        if (hId === id) {
          const wrapper = previewEl as HTMLElement;
          const wrapperRect = wrapper.getBoundingClientRect();
          const elRect = (h as HTMLElement).getBoundingClientRect();
          const relativeTop = elRect.top - wrapperRect.top + wrapper.scrollTop;
          wrapper.scrollTo({ top: Math.max(0, relativeTop - 32), behavior: 'smooth' });
          break;
        }
      }
    }
  }, [viewMode]);

  const handleFloatingAction = useCallback((mode: AIMode, text: string) => {
    // Open AI panel, set mode, and run with selected text
    ai.setMode(mode);
    if (!ai.panelVisible) {
      if (viewMode !== 'editor') {
        setViewMode('editor');
        setReadingMode(false);
      }
      ai.setPanelVisible(true);
    }
    // Store context for partial replacement
    aiSelectionRef.current = { fullContent: content, selectedText: text };
    // Run AI with the selected text, passing mode directly to avoid stale closure
    if (ai.apiKeySet) {
      ai.runAI(text, undefined, mode);
    }
    // Clear floating bar
    setSelectedText('');
    setSelectionCoords(null);
  }, [ai, viewMode]);

  // Track opened files in recent list
  useEffect(() => {
    if (filePath) {
      addRecentFile(filePath);
    }
  }, [filePath, addRecentFile]);

  // ─── MCP propose_edit 처리 ───
  // Claude 의 수정은 propose_edit 한 경로로 일원화 — diff 미리보기를 띄우고
  // 사용자가 수락/거절(ack 는 McpProposalView 핸들러). 즉시 적용/자동 저장 도구는
  // 제거됨(자동 저장 방지). emit_to 타게팅 + windowLabel 가드, deps [] (ref 경유).
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      const myLabel = getCurrentWebviewWindow().label;

      const u = await listen<{
        requestId: string;
        windowLabel: string;
        content?: string | null;
        description?: string | null;
      }>('mcp-propose-edit', (event) => {
        const { requestId, windowLabel, content: newContent, description } = event.payload;
        if (windowLabel !== myLabel) return;
        // 큐 상한 초과 시 새 제안 즉시 거절-ack(orphan 방지) 후 무시 — 무한 누적 방지.
        if (mcpProposalsRef.current.length >= MCP_QUEUE_MAX) {
          ackMcpProposalRef.current(requestId, false, null);
          return;
        }
        // 첫 제안일 때만 진행 중 AI diff 정리(같은 pane 공유). 큐에 이미 있으면 건드리지 않음.
        if (mcpProposalsRef.current.length === 0) clearAiDiffRef.current();
        // 큐에 append — 기존 제안을 거절하지 않고 보관해 순차 검토(#39). 도착 시점 content 를
        // arrivalContent 로 저장(lost-update 감지). diff/표시는 head 가 될 때 현재 기준으로 파생.
        setMcpProposals((q) => [
          ...q,
          {
            requestId,
            newContent: newContent ?? '',
            description: description ?? undefined,
            arrivalContent: latestContentRef.current,
          },
        ]);
      });

      if (cancelled) u();
      else unlisten = u;
    })();

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 새로 spawn 된 윈도우는 자기 label 로 take_pending_file 호출 → path 로드.
  // URL 쿼리 (?file=...) 방식은 macOS WKWebView 의 URL 길이 + 한글 인코딩 누락 버그로 폐기.
  useEffect(() => {
    if (!isTauri()) return;
    (async () => {
      try {
        const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        const { invoke } = await import('@tauri-apps/api/core');
        const label = getCurrentWebviewWindow().label;
        // 'main' 윈도우의 OS file association path 도 같은 명령으로 받음
        if (label === 'main') return; // main 은 useFileSystem 의 get_pending_file 흐름이 처리
        const path = await invoke<string | null>('take_pending_file', { label });
        if (!path) {
          // MCP create_document 로 생성된 창 — content 를 직접 로드
          const pc = await invoke<[string, string] | null>('take_pending_content', { label });
          if (pc) {
            const [contentText, name] = pc;
            loadFromMemory(contentText, name);
          }
          return;
        }
        try {
          const { readTextFile } = await import('@tauri-apps/plugin-fs');
          const content = await readTextFile(path);
          const name = path.split('/').pop() || 'Untitled.md';
          openFromRecent(path, content, name);
        } catch (readErr) {
          // 실패가 console 에만 남으면 새 윈도우가 "빈 페이지" 로만 보임 — 다이얼로그로 표시
          console.error('Failed to load pending file:', readErr);
          const { message } = await import('@tauri-apps/plugin-dialog');
          await message(`파일을 열 수 없습니다.\n\n${path}\n\n${String(readErr)}`, {
            title: 'MarkMind',
            kind: 'error',
          });
        }
      } catch (err) {
        console.error('Failed to load pending file:', err);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-attach scroll sync + close search on view mode change
  useEffect(() => {
    // Close preview search bar
    setSearchVisible(false);
    setSearchQuery('');
    // Close CodeMirror search panel
    editorRef.current?.closeSearch();

    if (viewMode === 'split') {
      reattach();
    }
  }, [viewMode, reattach]);

  // viewMode 전환 시 scroll 위치 보존 (Markdown ↔ Rich Text).
  // 이전 모드의 scroll 비율을 기억해 새 모드의 같은 비율 위치로 자동 이동.
  // 추적 element: editor → .cm-scroller, preview → .preview-wrapper.
  useEffect(() => {
    const scrollEl = (): HTMLElement | null => {
      const root = containerRef.current;
      if (!root) return null;
      if (viewMode === 'editor') return root.querySelector<HTMLElement>('.cm-scroller');
      if (viewMode === 'preview') return root.querySelector<HTMLElement>('.preview-wrapper');
      // split — 보존 안 함 (양쪽 모두 보임)
      return null;
    };

    // mount 직후 — 이전에 저장된 ratio 로 새 element 의 scrollTop 복원.
    // ResizeObserver 로 scrollHeight 변화 감지 → 안정될 때까지 자동 재시도 (매직 timeout 제거).
    const restore = () => {
      const el = scrollEl();
      if (!el) return;
      const max = el.scrollHeight - el.clientHeight;
      if (max > 0) el.scrollTop = Math.round(max * scrollRatioRef.current);
    };
    restore();

    const el = scrollEl();
    let restored = false;
    let ro: ResizeObserver | null = null;
    if (el && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        if (restored) return;
        const max = el.scrollHeight - el.clientHeight;
        if (max > 0) {
          el.scrollTop = Math.round(max * scrollRatioRef.current);
          restored = true;
          ro?.disconnect();
        }
      });
      // 내부 콘텐츠 영역의 첫 자식을 관찰 (Editor pane 의 .cm-content 또는 preview-wrapper 의 .markdown-body)
      const inner = el.firstElementChild;
      if (inner) ro.observe(inner);
    }

    // 이 mode 가 활성인 동안 scroll 변화를 ratio 로 추적.
    const tracker = () => {
      if (!el) return;
      const max = el.scrollHeight - el.clientHeight;
      if (max > 0) scrollRatioRef.current = el.scrollTop / max;
    };
    el?.addEventListener('scroll', tracker, { passive: true });
    return () => {
      ro?.disconnect();
      el?.removeEventListener('scroll', tracker);
    };
  }, [viewMode]);

  // Font size
  const handleFontSizeChange = useCallback((delta: number) => {
    setFontSize((prev) => {
      const next = Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, prev + delta));
      localStorage.setItem('md-editor-font-size', String(next));
      return next;
    });
  }, []);

  const resetFontSize = useCallback(() => {
    setFontSize(FONT_SIZE_DEFAULT);
    localStorage.setItem('md-editor-font-size', String(FONT_SIZE_DEFAULT));
  }, []);

  // Reading mode
  const toggleReadingMode = useCallback(() => {
    setReadingMode((prev) => {
      const next = !prev;
      if (next) {
        setViewMode('preview');
        setOutlineVisible(false);
      }
      return next;
    });
  }, []);

  // Search toggle
  const toggleSearch = useCallback(() => {
    // In editor or split mode, toggle CodeMirror's built-in search panel
    if (viewMode !== 'preview') {
      editorRef.current?.toggleSearch();
      return;
    }
    // In preview mode, show the preview search bar
    setSearchVisible((prev) => {
      const next = !prev;
      if (next) {
        setTimeout(() => searchInputRef.current?.focus(), 100);
      } else {
        setSearchQuery('');
        clearHighlights();
        // Rich Text 검색 highlight 도 같이 clear
        window.dispatchEvent(new Event('markmind:rich-search-clear'));
      }
      return next;
    });
  }, [viewMode]);

  // Preview search: scroll a match element into view precisely
  const scrollToMatch = useCallback((el: HTMLElement) => {
    const wrapper = document.querySelector('.preview-wrapper') as HTMLElement | null;
    if (!wrapper) return;
    const wrapperRect = wrapper.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const relativeTop = elRect.top - wrapperRect.top + wrapper.scrollTop;
    const targetScrollTop = relativeTop - wrapperRect.height / 2 + elRect.height / 2;
    wrapper.scrollTo({ top: Math.max(0, targetScrollTop), behavior: 'smooth' });
  }, []);

  // Navigate to a specific match index and update active highlight
  const goToMatchIndex = useCallback((index: number, matches: HTMLElement[]) => {
    if (matches.length === 0) return;
    // Remove active from previous
    const prevEl = matches[searchCurrentIndexRef.current];
    if (prevEl) prevEl.classList.remove('search-highlight-active');
    // Apply active to new
    const nextEl = matches[index];
    if (nextEl) {
      nextEl.classList.add('search-highlight-active');
      scrollToMatch(nextEl);
    }
    searchCurrentIndexRef.current = index;
    setSearchCurrentIndex(index);
  }, [scrollToMatch]);

  // Navigate by delta (+1 forward, -1 backward), wrapping around
  const navigateMatch = useCallback((delta: number) => {
    // Rich Text 모드 — TipTap search ext 명령으로 위임
    if (viewMode === 'preview') {
      const ev = delta > 0 ? 'markmind:rich-search-next' : 'markmind:rich-search-prev';
      window.dispatchEvent(new Event(ev));
      // current index UI 도 갱신 — count 가 0보다 크면 modulo
      setSearchCurrentIndex((cur) => {
        const total = searchMatchCount;
        if (total === 0) return -1;
        return (cur + delta + total) % total;
      });
      return;
    }
    const matches = searchMatchesRef.current;
    if (matches.length === 0) return;
    const next = (searchCurrentIndexRef.current + delta + matches.length) % matches.length;
    goToMatchIndex(next, matches);
  }, [goToMatchIndex, viewMode, searchMatchCount]);

  // Highlight all matches in the preview DOM
  const highlightMatches = useCallback((query: string) => {
    // Clear previous
    const oldMarks = document.querySelectorAll('.search-highlight');
    oldMarks.forEach((mark) => {
      const parent = mark.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
        parent.normalize();
      }
    });
    searchMatchesRef.current = [];
    searchCurrentIndexRef.current = -1;
    setSearchMatchCount(0);
    setSearchCurrentIndex(-1);

    if (!query.trim()) return;

    const previewEl = document.querySelector('.preview-wrapper .markdown-body');
    if (!previewEl) return;

    const walker = document.createTreeWalker(previewEl, NodeFilter.SHOW_TEXT);
    const found: { node: Text; index: number }[] = [];
    const lowerQuery = query.toLowerCase();

    let node;
    while ((node = walker.nextNode())) {
      const text = (node as Text).textContent || '';
      let idx = text.toLowerCase().indexOf(lowerQuery);
      while (idx !== -1) {
        found.push({ node: node as Text, index: idx });
        idx = text.toLowerCase().indexOf(lowerQuery, idx + 1);
      }
    }

    // Build marks in reverse order to preserve text node indices
    const marks: HTMLElement[] = [];
    for (let i = found.length - 1; i >= 0; i--) {
      const { node: textNode, index } = found[i];
      try {
        const range = document.createRange();
        range.setStart(textNode, index);
        range.setEnd(textNode, index + query.length);
        const mark = document.createElement('mark');
        mark.className = 'search-highlight';
        range.surroundContents(mark);
        marks.unshift(mark);
      } catch {
        // Skip if range operation fails (e.g., across element boundaries)
      }
    }

    searchMatchesRef.current = marks;
    setSearchMatchCount(marks.length);

    if (marks.length > 0) {
      goToMatchIndex(0, marks);
    }
  }, [goToMatchIndex]);

  const clearHighlights = useCallback(() => {
    const marks = document.querySelectorAll('.search-highlight');
    marks.forEach((mark) => {
      const parent = mark.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
        parent.normalize();
      }
    });
    searchMatchesRef.current = [];
    searchCurrentIndexRef.current = -1;
    setSearchMatchCount(0);
    setSearchCurrentIndex(-1);
  }, []);

  useEffect(() => {
    if (viewMode === 'preview') {
      // Rich Text 모드 — DOM surroundContents 대신 RichEditor 의 TipTap search 위임
      // (TipTap ProseMirror tree 와 직접 DOM 조작이 충돌하면 editor 깨짐)
      window.dispatchEvent(
        new CustomEvent('markmind:rich-search', { detail: { query: searchQuery } }),
      );
      return;
    }
    if (searchQuery) {
      const timer = setTimeout(() => highlightMatches(searchQuery), 200);
      return () => clearTimeout(timer);
    } else {
      clearHighlights();
    }
  }, [searchQuery, content, highlightMatches, clearHighlights, viewMode]);

  // Rich Text search 결과 count + 현재 index 회신 listen
  useEffect(() => {
    if (viewMode !== 'preview') return;
    const onCount = (e: Event) => {
      const detail = (e as CustomEvent<{ count: number; index: number }>).detail;
      setSearchMatchCount(detail.count ?? 0);
      setSearchCurrentIndex(detail.count > 0 ? (detail.index ?? 0) : -1);
    };
    window.addEventListener('markmind:rich-search-count', onCount);
    return () => window.removeEventListener('markmind:rich-search-count', onCount);
  }, [viewMode]);

  // Open recent
  const handleOpenRecent = useCallback(
    (path: string, content: string, name: string) => {
      openFromRecent(path, content, name);
      setRecentPanelVisible(false);
    },
    [openFromRecent],
  );

  // 파일 열기 — 웹 모드 + LAN 서버면 공유 폴더 브라우저, 아니면 기존 흐름
  // (Tauri 네이티브 다이얼로그 / 브라우저 input).
  const handleOpenFile = useCallback(() => {
    if (!isTauri() && hasLanServer()) {
      setLanBrowserVisible(true);
    } else {
      openFile();
    }
  }, [openFile]);

  // LAN 브라우저에서 파일 선택 → 내용 읽어 로드. filePath 를 서버 상대경로로
  // 유지(openFromRecent) → 저장이 원본을 in-place 덮어쓴다.
  const handleLanSelect = useCallback(
    async (relPath: string) => {
      if (isDirty) {
        const ok = await confirmAction(
          '현재 문서에 저장되지 않은 변경사항이 있습니다.\n' +
            '다른 파일을 열면 변경사항이 사라집니다. 계속할까요?',
          { title: '저장 안 됨', kind: 'warning' },
        );
        if (!ok) return;
      }
      try {
        const { content: text, path, modified } = await lanReadFile(relPath);
        const name = relPath.split('/').pop() || relPath;
        openFromRecent(path, text, name, modified);
        setLanBrowserVisible(false);
      } catch (err) {
        console.error('[App] LAN 파일 열기 실패:', err);
        alert('파일을 열지 못했습니다: ' + err);
      }
    },
    [isDirty, openFromRecent],
  );

  /** File 메뉴 submenu 에서 path 만으로 열기 — content 는 자체적으로 읽음 */
  const handleOpenRecentByPath = useCallback(
    async (path: string) => {
      if (!isTauri()) return;
      try {
        const { readTextFile } = await import('@tauri-apps/plugin-fs');
        const content = await readTextFile(path);
        const name = path.split(/[\\/]/).pop() ?? path;
        openFromRecent(path, content, name);
      } catch (err) {
        console.error('[App] Recent file open failed:', err);
      }
    },
    [openFromRecent],
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (settingsVisible) { setSettingsVisible(false); return; }
        if (tutorialVisible) { setTutorialVisible(false); return; }
        if (readingMode) { setReadingMode(false); return; }
        if (searchVisible) { toggleSearch(); return; }
        if (recentPanelVisible) { setRecentPanelVisible(false); return; }
      }

      if (e.metaKey || e.ctrlKey) {
        // shift 누르면 e.key 가 대문자 ('S') 또는 다른 글자 ('+' → '=') 로 바뀜 →
        // 일관 매칭 위해 letter 만 toLowerCase. 숫자/기호는 e.key 그대로.
        const k = e.key.length === 1 && /[a-zA-Z]/.test(e.key) ? e.key.toLowerCase() : e.key;
        switch (k) {
          case 's':
            e.preventDefault();
            if (e.shiftKey) saveFileAs();
            else saveFile();
            break;
          case 'o':
            e.preventDefault();
            handleOpenFile();
            break;
          case 'n':
            e.preventDefault();
            newFile();
            break;
          case 'f':
            if (viewMode === 'preview') {
              e.preventDefault();
              toggleSearch();
            }
            break;
          case '1':
            e.preventDefault();
            setViewMode('editor');
            setReadingMode(false);
            break;
          case '2':
            e.preventDefault();
            setViewMode('split');
            setReadingMode(false);
            break;
          case '3':
            e.preventDefault();
            setViewMode('preview');
            setReadingMode(false);
            break;
          case '4':
            e.preventDefault();
            setViewMode('mindmap');
            setReadingMode(false);
            break;
          case '5':
            e.preventDefault();
            setViewMode('graph');
            setReadingMode(false);
            break;
          case '6':
            e.preventDefault();
            setViewMode('flowchart');
            setReadingMode(false);
            break;
          case '7':
            e.preventDefault();
            setViewMode('gantt');
            setReadingMode(false);
            break;
          case '=':
          case '+':
            e.preventDefault();
            handleFontSizeChange(1);
            break;
          case '-':
            e.preventDefault();
            handleFontSizeChange(-1);
            break;
          case '0':
            e.preventDefault();
            resetFontSize();
            break;
          case 'i':
            // ⌘⇧I 만 AI Agent 토글 — ⌘I 는 TipTap Italic 과 충돌 회피
            if (e.shiftKey) {
              e.preventDefault();
              handleToggleAI();
            }
            break;
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    saveFile, saveFileAs, handleOpenFile, newFile, toggleSearch,
    handleFontSizeChange, resetFontSize, readingMode, recentPanelVisible,
    searchVisible, viewMode, handleToggleAI, tutorialVisible, settingsVisible,
  ]);

  // Split pane drag
  const handleMouseDown = useCallback(() => {
    isDragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.body.classList.add('is-resizing');
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      setSplitRatio(Math.max(0.2, Math.min(0.8, ratio)));
    };

    const handleMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.body.classList.remove('is-resizing');
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // Window title (+ Tauri native title sync)
  useEffect(() => {
    const title = `${isDirty ? '● ' : ''}${fileName} — MD Editor`;
    document.title = title;

    if (isTauri()) {
      (async () => {
        try {
          const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
          await getCurrentWebviewWindow().setTitle(title);
        } catch { /* ignore in non-Tauri */ }
      })();
    }
  }, [fileName, isDirty]);

  // Reading mode
  if (readingMode) {
    return (
      <div
        className="app reading-mode"
        data-line-height={lineHeight}
        style={
          bgColor
            ? ({
                '--user-bg': bgColor,
                '--preview-bg': bgColor,
              } as React.CSSProperties)
            : undefined
        }
        data-custom-bg={bgColor ? 'true' : undefined}
        onClick={() => setReadingMode(false)}
      >
        <div className="reading-mode-content" onClick={(e) => e.stopPropagation()}>
          <Preview content={content} fontSize={fontSize + 2} filePath={filePath} />
        </div>
        <div className="reading-mode-hint">
          Press <kbd>Esc</kbd> or click outside to exit
        </div>
      </div>
    );
  }

  // Auth callback route — show only the callback handler
  if (isAuthCallback) {
    return (
      <div className="app">
        <AuthCallback
          processCallback={auth.processCallback}
          onSuccess={() => setIsAuthCallback(false)}
          onError={(err) => {
            console.error('Auth callback error:', err);
            setIsAuthCallback(false);
          }}
        />
      </div>
    );
  }

  // MCP 수정 제안 배너 — 뷰 모드별로 위치가 달라(리치텍스트=툴바 아래, 마크다운=페인 상단)
  // 한 번 정의해 양쪽에서 재사용. 리뷰 오버레이가 열리면 숨긴다.
  const mcpBanner = mcpHeadView && !mcpReviewOpen ? (
    <div className="mcp-banner">
      <span className="mcp-banner-icon"><Sparkles size={16} strokeWidth={2} /></span>
      <span className="mcp-banner-text">
        Claude 수정 제안{mcpHeadView.description ? `: ${mcpHeadView.description}` : ''}
        {` · ${countMcpChanges(mcpHeadView.chunks)}곳`}
        {mcpProposals.length > 1 ? ` · 외 ${mcpProposals.length - 1}건 대기` : ''}
      </span>
      <button className="mcp-banner-btn mcp-banner-review" onClick={() => setMcpReviewOpen(true)}>
        변경 보기
      </button>
      <button
        className="mcp-banner-btn mcp-banner-reject"
        onClick={rejectMcpProposal}
        title="제안 거절"
      >
        거절
      </button>
    </div>
  ) : null;

  return (
    <div
      className="app"
      data-line-height={lineHeight}
      style={
        bgColor
          ? ({
              // content 영역만 적용 — UI chrome (popover/AIPanel/Toolbar) 영향 X
              '--user-bg': bgColor,
              '--preview-bg': bgColor,
            } as React.CSSProperties)
          : undefined
      }
      data-custom-bg={bgColor ? 'true' : undefined}
    >
      {dragActive && (
        <div className="file-drop-overlay" aria-hidden>
          <div className="file-drop-overlay-inner">Drag &amp; Drop</div>
        </div>
      )}
      <div
        className="titlebar-drag"
        onMouseDown={(e) => {
          if (e.buttons !== 1 || !isTauri()) return;
          e.preventDefault();
          import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
            if (e.detail === 2) {
              getCurrentWindow().toggleMaximize();
            } else {
              getCurrentWindow().startDragging();
            }
          });
        }}
      />
      <Toolbar
        fileName={fileName}
        isDirty={isDirty}
        viewMode={viewMode}
        fontSize={fontSize}
        outlineVisible={outlineVisible}
        onViewModeChange={setViewMode}
        onNewFile={newFile}
        onOpenFile={handleOpenFile}
        onSaveFile={saveFile}
        onSaveFileAs={saveFileAs}
        onExportPdf={handleExportPdf}
        onExportPptx={handleExportPptx}
        aiLayoutAvailable={pptxAiProviders.claude || pptxAiProviders.gemini}
        onShowTutorial={() => setTutorialVisible(true)}
        onShowSettings={() => setSettingsVisible(true)}
        onOpenFromDrive={() => setDriveBrowserMode('open')}
        onSaveToDrive={() => setDriveBrowserMode('save')}
        onFontSizeChange={handleFontSizeChange}
        onFontSizeReset={resetFontSize}
        lineHeight={lineHeight}
        onCycleLineHeight={cycleLineHeight}
        bgColor={bgColor}
        onBgColorChange={setBgColor}
        onToggleOutline={() => setOutlineVisible((v) => !v)}
        onToggleReadingMode={toggleReadingMode}
        onToggleRecentFiles={() => setRecentPanelVisible((v) => !v)}
        recentFiles={recentFiles}
        onOpenRecent={handleOpenRecentByPath}
        onToggleSearch={toggleSearch}
        onToggleAI={handleToggleAI}
        onToggleAudio={handleToggleAudio}
        onToggleOcr={handleToggleOcr}
        audioPanelVisible={audioPanelVisible}
        ocrPanelVisible={ocrPanelVisible}
        showRecent={isTauri()}
        aiPanelVisible={ai.panelVisible}
        onRename={renameFile}
      />

      {/* Search bar */}
      {searchVisible && (
        <div className="search-bar">
          <input
            ref={searchInputRef}
            type="text"
            className="search-input"
            placeholder="Search in preview…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { toggleSearch(); return; }
              if (e.key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) navigateMatch(-1);
                else navigateMatch(1);
              }
            }}
          />
          {searchMatchCount > 0 ? (
            <>
              <span className="search-count">
                {searchCurrentIndex + 1} / {searchMatchCount}
              </span>
              <button
                className="search-nav-btn"
                onClick={() => navigateMatch(-1)}
                title="Previous match (Shift+Enter)"
              >▲</button>
              <button
                className="search-nav-btn"
                onClick={() => navigateMatch(1)}
                title="Next match (Enter)"
              >▼</button>
            </>
          ) : searchQuery ? (
            <span className="search-count search-count-empty">No results</span>
          ) : null}
          <button
            className="search-close-btn"
            onClick={toggleSearch}
            title="검색 닫기 (Esc)"
            aria-label="검색 닫기"
          >
            <IconX size={20} strokeWidth={2} />
          </button>
        </div>
      )}

      <div className="main-content" ref={containerRef}>
        <OutlinePanel content={content} visible={outlineVisible} onHeadingClick={handleOutlineClick} />

        <div className="split-pane">
          {viewMode === 'mindmap' ? (
            <div className="pane" style={{ width: '100%', flexDirection: 'column' }}>
              {mcpBanner}
              {mindmapNav.length > 0 && (
                <div className="mindmap-breadcrumb">
                  <button className="mm-back-btn" onClick={handleMindmapBack} title="뒤로">
                    ← 뒤로
                  </button>
                  <span className="mm-crumbs">
                    {mindmapNav.map((n, i) => (
                      <span key={i}>{n.fileName.replace(/\.(md|markdown|mdx|txt)$/i, '')} ›&nbsp;</span>
                    ))}
                    <strong>{fileName.replace(/\.(md|markdown|mdx|txt)$/i, '')}</strong>
                  </span>
                </div>
              )}
              <MindmapView
                content={content}
                onChange={updateContent}
                fileName={fileName}
                onOpenDocument={handleOpenLinkedDocument}
                onJumpToSource={handleJumpToSource}
              />
            </div>
          ) : viewMode === 'graph' ? (
            <div className="pane" style={{ width: '100%' }}>
              {mcpBanner}
              <VaultGraphView
                filePath={filePath}
                onOpenFile={handleOpenVaultFile}
                onOpenGhost={handleOpenVaultGhost}
              />
            </div>
          ) : viewMode === 'flowchart' ? (
            <div className="pane" style={{ width: '100%' }}>
              {mcpBanner}
              <FlowchartView content={content} fileName={fileName} onChange={updateContent} />
            </div>
          ) : viewMode === 'gantt' ? (
            <div className="pane" style={{ width: '100%' }}>
              {mcpBanner}
              <GanttView content={content} fileName={fileName} onJumpToSource={handleJumpToSource} />
            </div>
          ) : (
          <>
          {viewMode !== 'preview' && (
            <div
              className="pane pane-editor"
              style={{
                width: viewMode === 'split' ? `${splitRatio * 100}%` : '100%',
              }}
            >
              {/* 마크다운/split 모드 — 페인 상단(메인 툴바 바로 아래)에 배너 */}
              {mcpBanner}
              {ai.response && !ai.isLoading ? (
                <InlineDiffView
                  chunks={ai.response.chunks}
                  onAcceptChunk={ai.acceptChunk}
                  onRejectChunk={ai.rejectChunk}
                  onAcceptAll={() => {
                    ai.acceptAll();
                    if (ai.response) {
                      const modified = ai.response.modifiedText;
                      if (aiSelectionRef.current) {
                        const { fullContent, selectedText: sel } = aiSelectionRef.current;
                        updateContent(fullContent.replace(sel, modified));
                        aiSelectionRef.current = null;
                      } else {
                        updateContent(modified);
                      }
                    }
                    ai.setResponse(null);
                  }}
                  onRejectAll={() => {
                    ai.rejectAll();
                    ai.setResponse(null);
                    aiSelectionRef.current = null;
                  }}
                  undecidedCount={ai.undecidedCount}
                  allDecided={ai.allDecided}
                  onApplyResult={() => {
                    const finalText = ai.getFinalText();
                    if (finalText !== null) {
                      if (aiSelectionRef.current) {
                        const { fullContent, selectedText: sel } = aiSelectionRef.current;
                        updateContent(fullContent.replace(sel, finalText));
                        aiSelectionRef.current = null;
                      } else {
                        updateContent(finalText);
                      }
                    }
                    ai.setResponse(null);
                  }}
                />
              ) : (
                <Editor ref={editorRef} content={content} onChange={updateContent} theme={theme} onSelectionChange={handleSelectionChange} onImagePaste={handleImagePaste} />
              )}
            </div>
          )}

          {viewMode === 'split' && (
            <div className="split-handle-area">
              <div
                className={`split-handle${isDragging.current ? ' dragging' : ''}`}
                onMouseDown={handleMouseDown}
              />
              <button
                className={`sync-toggle${syncEnabled ? ' active' : ''}`}
                onClick={toggleSync}
                title={syncEnabled ? 'Scroll Sync ON' : 'Scroll Sync OFF'}
              >
                {syncEnabled ? <Link size={12} /> : <Unlink size={12} />}
              </button>
              <div
                className={`split-handle${isDragging.current ? ' dragging' : ''}`}
                onMouseDown={handleMouseDown}
              />
            </div>
          )}

          {viewMode !== 'editor' && (
            <div
              className="pane"
              style={{
                width: viewMode === 'split' ? `${(1 - splitRatio) * 100}%` : '100%',
              }}
            >
              {/* split 모드에선 source 가 CodeMirror 가 담당 — Preview 는 read-only.
                  preview-only 모드에선 onChange 연결해 WYSIWYG 편집 가능. */}
              <Preview
                ref={previewRef}
                content={content}
                fontSize={fontSize}
                onChange={viewMode === 'preview' ? updateContent : undefined}
                banner={mcpBanner}
                filePath={filePath}
              />
            </div>
          )}
          </>
          )}
        </div>

        {/* Floating AI Bar */}
        {(viewMode === 'editor' || viewMode === 'split') && (
          <FloatingAIBar
            selectedText={selectedText}
            coords={selectionCoords}
            onAction={handleFloatingAction}
          />
        )}

        <AIPanel
          visible={ai.panelVisible}
          mode={ai.mode}
          language={ai.language}
          isLoading={ai.isLoading}
          error={ai.error}
          streamingText={ai.streamingText}
          apiKeySet={ai.apiKeySet}
          content={content}
          selectedModel={ai.selectedModel}
          onSelectedModelChange={ai.setSelectedModel}
          onModeChange={ai.setMode}
          onLanguageChange={ai.setLanguage}
          notesTemplate={ai.notesTemplate}
          notesResult={ai.notesResult}
          loadTemplates={converter.listTemplates}
          openEditorWindow={handleOpenInCurrentEditor}
          onNotesTemplateChange={ai.setNotesTemplate}
          onRun={handleAIRun}
          onShowSettings={() => setSettingsVisible(true)}
        />

        <ConvertSidebar
          visible={audioPanelVisible}
          title="음성→텍스트 변환"
          icon={<Mic size={14} />}
          onClose={() => setAudioPanelVisible(false)}
        >
          <AudioTab
            converter={converter}
            onOpenResult={handleOpenInCurrentEditor}
            droppedFile={audioDropped}
            onConsumeDropped={() => setAudioDropped(null)}
          />
        </ConvertSidebar>

        <ConvertSidebar
          visible={ocrPanelVisible}
          title="이미지→텍스트 변환"
          icon={<ScanText size={14} />}
          onClose={() => setOcrPanelVisible(false)}
        >
          <OcrTab
            converter={converter}
            onOpenResult={handleOpenInCurrentEditor}
            droppedFile={ocrDropped}
            onConsumeDropped={() => setOcrDropped(null)}
          />
        </ConvertSidebar>

      </div>

      <StatusBar content={content} filePath={filePath} />

      {pptxBusy && (
        <div className="pptx-busy-overlay" role="status" aria-live="polite">
          <div className="pptx-busy-card">
            <Loader2 size={20} className="spinning" />
            <span>{pptxBusy}</span>
          </div>
        </div>
      )}

      <RecentFilesPanel
        files={recentFiles}
        visible={recentPanelVisible}
        onOpenRecent={handleOpenRecent}
        onRemove={removeRecentFile}
        onClear={clearRecentFiles}
        onClose={() => setRecentPanelVisible(false)}
      />

      {/* Tutorial overlay */}
      {tutorialVisible && (
        <div className="tutorial-overlay" onClick={() => setTutorialVisible(false)}>
          <div className="tutorial-overlay-content" onClick={(e) => e.stopPropagation()}>
            <div className="tutorial-overlay-header">
              <span className="tutorial-overlay-title"><BookOpen size={16} strokeWidth={1.5} /> Tutorial</span>
              <button className="tutorial-overlay-close" onClick={() => setTutorialVisible(false)}><IconX size={16} /></button>
            </div>
            <div className="tutorial-overlay-body">
              <Preview content={TUTORIAL_CONTENT} fontSize={fontSize} />
            </div>
          </div>
          <div className="reading-mode-hint">
            Press <kbd>Esc</kbd> or click outside to close
          </div>
        </div>
      )}

      {/* 통합 Settings 모달 — STT/OCR/AI 에이전트 API 키 */}
      <SettingsModal visible={settingsVisible} onClose={() => setSettingsVisible(false)} />

      {/* LAN 서버 모드(아이폰 등) — 공유 폴더 파일 브라우저 */}
      <LanFileBrowser
        visible={lanBrowserVisible}
        onClose={() => setLanBrowserVisible(false)}
        onSelect={handleLanSelect}
      />

      {/* Google Drive 파일 브라우저 (Open from / Save to) */}
      <DriveBrowser
        visible={driveBrowserMode !== null}
        mode={driveBrowserMode ?? 'open'}
        onClose={() => setDriveBrowserMode(null)}
        onOpen={async (file: DriveFile, contentText: string) => {
          // unsaved-changes 가드 — 기존 openFile 패턴과 동일
          if (isDirty) {
            const ok = await confirmAction(
              `현재 문서에 저장되지 않은 변경사항이 있습니다.\n` +
              `Drive 파일 "${file.name}" 의 내용으로 교체하시겠습니까? (변경사항은 사라집니다)`,
              { title: '저장 안 됨', kind: 'warning' },
            );
            if (!ok) return;
          }
          // 새 가상 파일로 로드 — filePath 없음 → Save 시 Save As 다이얼로그
          loadFromMemory(contentText, file.name);
          setDriveBrowserMode(null);
        }}
        saveContent={driveBrowserMode === 'save' ? content : undefined}
        defaultSaveName={fileName || 'Untitled'}
        onSaved={(file) => {
          console.log('[Drive] 저장됨:', file.name);
        }}
      />

      {/* MCP 수정 제안 리뷰 오버레이 — '변경 보기' 클릭 시. 현재 뷰 모드와 무관하게
          어디서든 diff 를 검토(수락/거절). Base UI Dialog 의 iOS/WKWebView 스크롤
          버그 회피를 위해 커스텀 포털 사용. backdrop/ESC = 닫기(거절 아님, 배너로 복귀). */}
      {mcpHeadView && mcpReviewOpen && createPortal(
        <div className="mcp-review-overlay" role="dialog" aria-modal="true">
          <div
            className="mcp-review-backdrop"
            onClick={() => setMcpReviewOpen(false)}
            aria-hidden="true"
          />
          <div className="mcp-review-panel">
            <McpProposalView
              chunks={mcpHeadView.chunks}
              description={mcpHeadView.description}
              onAccept={acceptMcpProposal}
              onReject={rejectMcpProposal}
            />
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

export default App;
