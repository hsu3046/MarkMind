import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AIMode, DiffChunk } from './types/ai';
import { Editor, EditorHandle } from './components/Editor';
import { McpProposalView } from './components/McpProposalView';
import { generateDiff, isAuthError } from './services/aiService';
import { getAIModelSelection } from './services/aiModelConfig';
import { setValidationStatus } from './services/apiValidation';
import { Preview, type PreviewHandle } from './components/Preview';
import { MindmapView } from './components/MindmapView';
import { FlowchartView } from './components/FlowchartView';
import { SearchBar } from './components/SearchBar';
import { GanttView } from './components/GanttView';
import { KanbanView } from './components/KanbanView';
import { SlideshowView } from './components/SlideshowView';
import { getSlideshowSettings, setSlideshowSettings as persistSlideshowSettings, type SlideshowSettings } from './lib/slideSplit';
import { applySlideDesignOptions, BUILTIN_SLIDE_THEMES, DEFAULT_SLIDE_THEME, getSlideTheme, type SlideExportOptions } from './lib/slideTheme';
import { DEFAULT_HTML_SLIDE_THEME, getHtmlSlideTheme } from './lib/htmlSlideTheme';
import { clampMarkdownSlideDraft, PPTX_MAX_SLIDES, slideImagePolicyMode, slideImageSourceMode } from './lib/slideLimits';
import { markMindPptxDesignRulesText } from './lib/pptxDesignSystem';
import { Toolbar, EditableFileName, PaneHeader, ViewMode, PaneView, EDITABLE_VIEWS, isPaneView } from './components/Toolbar';
import { StatusBar } from './components/StatusBar';
import { OutlinePanel } from './components/OutlinePanel';
import { RecentFilesPanel } from './components/RecentFilesPanel';
import { AIPanel } from './components/AIPanel';
import { FloatingAIBar } from './components/FloatingAIBar';
import { quoteRange } from './lib/quoteMatch';
import { InlineDiffView } from './components/InlineDiffView';
import { BeforeAfterView } from './components/BeforeAfterView';
import { AuthCallback } from './components/AuthCallback';
import { SettingsModal } from './components/SettingsModal';
import { DriveBrowser } from './components/DriveBrowser';
import { LanFileBrowser } from './components/LanFileBrowser';
import { hasLanServer, lanReadFile } from './services/webFileSystem';
import type { DriveFile } from './services/gdriveService';
import { confirmAction } from './services/dialogService';
import { useFileSystem } from './hooks/useFileSystem';
import { useTheme } from './hooks/useTheme';
import { useRecentFiles } from './hooks/useRecentFiles';
import { useAI } from './hooks/useAI';
import { useAuth } from './hooks/useAuth';
import { useConverter } from './hooks/useConverter';
import { ProgressPanel } from './components/convert/ProgressPanel';
import type { JobState, ProgressStep } from './types/converter';
import { isTauri } from './services/platform';
import { useNativeMenu } from './hooks/useNativeMenu';
import { getCallbackPath } from './services/knowaiAuth';
import { TUTORIAL_CONTENT } from './constants/tutorial';
import { Sparkles, Loader2, ArrowLeftRight, Square } from 'lucide-react';
import type { DroppedFile } from './components/convert/types';
// 본문 명조(뷰어 설정) — Noto Serif KR 한글 서브셋 번들(영문은 Georgia 폴백). ~2MB.
import '@fontsource/noto-serif-kr/korean-400.css';
import '@fontsource/noto-serif-kr/korean-700.css';
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

const SLIDE_REVIEW_MARKER_RE =
  /^\s*>\s*(?:코멘트|검토 필요|확인 필요|추가 정보 필요|정보 필요|TODO|NEEDS REVIEW|CHECK)\s*:/im;
const SLIDE_DRAFT_MARKER_RE = /^\s*(?:<!--\s*markmind:slide-draft\b[^>]*-->|&lt;!--\s*markmind:slide-draft\b.*?--&gt;)\s*$/im;
const SLIDE_DRAFT_MARKER_VERSION_RE =
  /^\s*(?:<!--\s*markmind:slide-draft\s+v(\d+)\b[^>]*-->|&lt;!--\s*markmind:slide-draft\s+v(\d+)\b.*?--&gt;)\s*$/im;
const HTML_NATIVE_MAX_IMAGE_ASSETS = PPTX_MAX_SLIDES;
const HTML_NATIVE_EMPTY_IMAGE_DATA_URL =
  'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%221%22%20height%3D%221%22/%3E';

function getSlideDraftMarkerVersion(markdown: string): number {
  const match = markdown.match(SLIDE_DRAFT_MARKER_VERSION_RE);
  if (!match) return SLIDE_DRAFT_MARKER_RE.test(markdown) ? 1 : 0;
  const raw = match[1] ?? match[2];
  const version = Number.parseInt(raw, 10);
  return Number.isFinite(version) && version > 0 ? version : 1;
}

function withSlideDraftMarker(markdown: string, version: number): string {
  const body = markdown.replace(SLIDE_DRAFT_MARKER_RE, '').trim();
  const safeVersion = Math.max(1, Math.floor(version));
  return `<!-- markmind:slide-draft v${safeVersion} -->\n${body}\n`;
}

function createSlideProgressJobId(): string {
  const uuid =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '')
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `slide-${uuid}`;
}

function isRetryableHtmlNativeError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  if (/(401|403|429|quota|billing|usage_limit|rate limit|api 키|인증|할당량|결제)/i.test(message)) {
    return false;
  }
  return /(network|네트워크|decoding response body|body decode|timeout|timed out|connection|reset|closed|incomplete|unexpected eof)/i.test(
    message,
  );
}

function isUserStoppedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /(사용자가 작업을 정지|aborted|aborterror|cancelled|canceled)/i.test(message);
}

function pathSeparatorFor(path: string): '/' | '\\' {
  return path.lastIndexOf('\\') > path.lastIndexOf('/') ? '\\' : '/';
}

function joinLocalPath(parent: string, child: string): string {
  if (!parent) return child;
  const sep = pathSeparatorFor(parent);
  const trimmed = parent.replace(/[\\/]+$/, '');
  if (!trimmed) return `${sep}${child}`;
  return `${trimmed}${sep}${child}`;
}

function parentDirFromPath(path: string): string {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  if (idx < 0) return '';
  if (idx === 0) return path[0] ?? '';
  return path.slice(0, idx);
}

function normalizeLocalRuntimePath(path: string): string | null {
  const clean = path.split(/[?#]/, 1)[0]?.trim().replace(/\\/g, '/').replace(/^\.\//, '') ?? '';
  if (!clean || /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(clean)) return null;
  const parts = clean.split('/').filter((part) => part && part !== '.');
  if (parts.includes('..')) return null;
  return parts.join('/');
}

function siblingPathForRuntime(deckPath: string, runtimePath: string): string | null {
  const normalized = normalizeLocalRuntimePath(runtimePath);
  if (!normalized) return null;
  return normalized.split('/').reduce((acc, part) => joinLocalPath(acc, part), parentDirFromPath(deckPath));
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
  // Jump-to-section: line to scroll to once the editor mounts (set when jumping from the mindmap).
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
    undo,
    redo,
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
  // Split View(이슈 #64) — 좌/우 패인 뷰 + active 패인(편집 source). viewMode==='split' 일 때만 의미.
  const [splitLeft, setSplitLeft] = useState<PaneView>(() => {
    const v = localStorage.getItem('markmind-split-left');
    return isPaneView(v) ? v : 'editor';
  });
  const [splitRight, setSplitRight] = useState<PaneView>(() => {
    const v = localStorage.getItem('markmind-split-right');
    return isPaneView(v) ? v : 'preview';
  });
  const [activePane, setActivePane] = useState<'left' | 'right'>('left');
  // 현재 편집 source 가 되는 뷰 — split 이면 active 패인의 뷰, slideshow(전체화면, 비편집)는
  // editor 로 폴백, 아니면 viewMode 그대로.
  const activeView: PaneView =
    viewMode === 'split'
      ? activePane === 'left'
        ? splitLeft
        : splitRight
      : viewMode === 'slideshow'
        ? 'editor'
        : viewMode;

  // Wire up the file-opened callback now that viewMode/setViewMode exist
  onFileOpenedRef.current = () => {
    setViewMode('preview');
  };
  // split 좌/우 뷰 선택을 세션 간 영속.
  useEffect(() => { localStorage.setItem('markmind-split-left', splitLeft); }, [splitLeft]);
  useEffect(() => { localStorage.setItem('markmind-split-right', splitRight); }, [splitRight]);
  const [fontSize, setFontSize] = useState(() => {
    const saved = localStorage.getItem('md-editor-font-size');
    return saved ? parseInt(saved, 10) : FONT_SIZE_DEFAULT;
  });
  // 행간 배율 — 1.2~3.0, 기본 1.8. CSS var(--md-line-height) 로 본문 line-height 제어.
  const [lineHeight, setLineHeight] = useState<number>(() => {
    const v = parseFloat(localStorage.getItem('markmind-line-height') || '');
    return v >= 1.2 && v <= 3 ? v : 1.8;
  });
  useEffect(() => {
    localStorage.setItem('markmind-line-height', String(lineHeight));
  }, [lineHeight]);

  // 배경색 — 빈 문자열 = 테마 기본, 그 외엔 사용자 지정 CSS color
  const [bgColor, setBgColor] = useState<string>(
    () => localStorage.getItem('markmind-bg-color') || '',
  );
  useEffect(() => {
    if (bgColor) localStorage.setItem('markmind-bg-color', bgColor);
    else localStorage.removeItem('markmind-bg-color');
  }, [bgColor]);

  // 본문 폰트 — 'sans'(고딕, Pretendard 기본) / 'serif'(명조). data-font-family 로 CSS 분기.
  const [fontFamily, setFontFamily] = useState<'sans' | 'serif'>(
    () => (localStorage.getItem('markmind-font-family') === 'serif' ? 'serif' : 'sans'),
  );
  useEffect(() => {
    localStorage.setItem('markmind-font-family', fontFamily);
  }, [fontFamily]);

  // 좌우 여백(%) — 0(여백 없음=본문 풀폭) ~ 40. 본문 max-width = 100% − 2×여백%.
  const [readingWidth, setReadingWidth] = useState<number>(() => {
    const v = parseFloat(localStorage.getItem('markmind-side-margin') || '');
    return v >= 0 && v <= 40 ? v : 12;
  });
  useEffect(() => {
    localStorage.setItem('markmind-side-margin', String(readingWidth));
  }, [readingWidth]);
  // 좌우 여백 % → CSS var. 본체에서 max-width: calc(100% − 2×var) 로 본문 폭 결정.
  const readingWidthCss = `${readingWidth}%`;

  // 슬라이드쇼 설정 — 분할 기준(HR/H1/H2) + 숨길 요소. localStorage 영속.
  const [slideshowSettings, setSlideshowSettings] = useState<SlideshowSettings>(getSlideshowSettings);
  const handleSlideshowChange = useCallback((patch: Partial<SlideshowSettings>) => {
    setSlideshowSettings((prev) => {
      const next = { ...prev, ...patch };
      persistSlideshowSettings(next);
      return next;
    });
  }, []);
  // 슬라이드쇼 진입 직전 뷰 — Esc/닫기로 복귀.
  const lastNonSlideshowView = useRef<ViewMode>('editor');
  useEffect(() => {
    if (viewMode !== 'slideshow') lastNonSlideshowView.current = viewMode;
  }, [viewMode]);

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
  const [settingsVisible, setSettingsVisible] = useState(false);
  // 프레임워크 생성 패널 — 메인 툴바 "마인드맵 AI 변환" 버튼이 열고, MindmapView 가 패널을 렌더(#60 통합).
  const [frameworkOpen, setFrameworkOpen] = useState(false);
  // 플로우차트 생성 — 메인 툴바 버튼이 FlowchartPanel 모달을 연다(마인드맵 frameworkOpen 과 동형).
  const [flowchartPanelOpen, setFlowchartPanelOpen] = useState(false);
  // 간트 차트 생성 — 메인 툴바 버튼이 GanttPanel 모달을 연다(플로우차트와 동형).
  const [ganttPanelOpen, setGanttPanelOpen] = useState(false);
  // 칸반 보드 생성 — 메인 툴바 버튼이 KanbanPanel 모달을 연다(간트와 동형).
  const [kanbanPanelOpen, setKanbanPanelOpen] = useState(false);
  // 시각 뷰 PDF 생성 진행 — 저장 다이얼로그 후 캡처/PDF 가 무거워 진행 오버레이를 띄운다.
  const [pdfExporting, setPdfExporting] = useState(false);
  // macOS full screen 시 툴바 숨김 — Tauri 윈도우 fullscreen 상태 추적(진입/해제는 resize 동반)
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      const sync = async () => setIsFullscreen(await win.isFullscreen());
      await sync();
      const un = await win.onResized(sync);
      if (disposed) Promise.resolve(un()).catch(() => { /* listener race */ });
      else unlisten = un;
    })();
    return () => {
      disposed = true;
      if (unlisten) Promise.resolve(unlisten()).catch(() => { /* listener race */ });
    };
  }, []);
  const [driveBrowserMode, setDriveBrowserMode] = useState<'open' | 'save' | null>(null);
  // LAN 서버 모드(아이폰 브라우저 등)에서 공유 폴더 파일 목록 브라우저
  const [lanBrowserVisible, setLanBrowserVisible] = useState(false);
  const [recentPanelVisible, setRecentPanelVisible] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchReplace, setSearchReplace] = useState('');
  const [searchShowReplace, setSearchShowReplace] = useState(false);
  const [searchMatchCount, setSearchMatchCount] = useState(0);
  const [searchCurrentIndex, setSearchCurrentIndex] = useState(-1);
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
    const defaultName = (fileName || 'Untitled').replace(/\.md$/i, '') + '.pdf';

    // 시각 뷰(간트/마인드맵/플로우차트/칸반) — 캡처 경로. 다이얼로그 → 진행표시 → 생성 → 저장.
    if (viewMode === 'gantt' || viewMode === 'mindmap' || viewMode === 'flowchart' || viewMode === 'kanban') {
      const { hasVisualContent, buildVisualViewPdf, writePdfBlob } = await import('./lib/pdf/exportVisualPdf');
      const { save, message } = await import('@tauri-apps/plugin-dialog');
      if (!hasVisualContent(viewMode)) {
        await message('표시할 내용이 없습니다. 먼저 내용을 만든 뒤 다시 시도해주세요.', { title: 'PDF 내보내기', kind: 'info' });
        return;
      }
      const path = await save({
        defaultPath: defaultName,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
        title: 'PDF로 내보내기',
      });
      if (!path) return;
      // 다이얼로그 확정 후부터 진행 오버레이 — 캡처/PDF 가 끝나야 Finder 에 파일이 보이므로.
      setPdfExporting(true);
      try {
        const blob = await buildVisualViewPdf(viewMode);
        if (blob) await writePdfBlob(blob, path);
      } catch (err) {
        console.error('[export_pdf visual] failed:', err);
      } finally {
        setPdfExporting(false);
      }
      return;
    }

    // 텍스트 뷰(editor/split → preview 전환) — 기존 NSPrint 경로.
    if (viewMode === 'editor' || viewMode === 'split') {
      prevViewModeRef.current = viewMode;
      setViewMode('preview');
      await new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r())),
      );
      await new Promise<void>((r) => setTimeout(r, 80));
    }

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
  // 전역 AI 선택(회사/인증)이 슬라이드 생성에 쓸 준비가 됐는지.
  // API 키 인증이면 그 회사 키 등록 여부, 구독 인증이면 백엔드가 호출 시 검증(여기선 준비로 간주).
  const [pptxAiReady, setPptxAiReady] = useState(false);
  // PPTX 내보내기 진행 표시(특히 AI 레이아웃은 LLM 호출로 수초~수십초 소요).
  const [pptxBusy, setPptxBusy] = useState<string | null>(null);
  const [pptxProgress, setPptxProgress] = useState<JobState>({ phase: 'idle', steps: [] });
  const pptxProgressJobIdRef = useRef<string | null>(null);
  const [pptxCanceling, setPptxCanceling] = useState(false);
  const pptxCancelRequestedRef = useRef(false);
  const [pptxOptions, setPptxOptions] = useState<SlideExportOptions>({
    themeId: DEFAULT_SLIDE_THEME.id,
    language: '',
    draftPurpose: 'executive briefing for decision makers',
    draftStructure: 'choose the strongest narrative structure',
    draftDepth: 'standard',
    draftRevisionMode: 'apply detailed instructions while preserving the current slide order and count unless explicitly requested',
    draftReviewMode: 'add frequent reviewer comments and questions for gaps, assumptions, and choices',
    designLayout: 'auto content-aware layout mix with strong variety',
    visualDensity: 'balanced text density with readable slide capacity',
    imagePolicy: 'add image intent only when it materially improves the slide',
    imageSourceMode: 'auto choose stock photos, logos, or generated images based on slide intent',
    fontPreference: 'free multilingual sans font pairing',
    marginPreference: 'theme default balanced margins',
    htmlThemeId: DEFAULT_HTML_SLIDE_THEME.id,
  });
  useEffect(() => {
    if (!isTauri()) return;
    (async () => {
      try {
        const sel = getAIModelSelection();
        if (sel.auth === 'subscription') {
          // 구독 인증은 백엔드가 호출 시 검증 — 사전엔 준비된 것으로 간주.
          setPptxAiReady(true);
          return;
        }
        const { invoke } = await import('@tauri-apps/api/core');
        const ready = await invoke<boolean>('has_api_key', { provider: sel.company });
        setPptxAiReady(ready);
      } catch {
        setPptxAiReady(false);
      }
    })();
  }, [settingsVisible]);

  useEffect(() => {
    if (!isTauri()) return;
    let mounted = true;
    let unlisten: (() => void) | null = null;

    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen<ProgressStep>('converter-progress', (event) => {
          if (!mounted) return;
          const step = event.payload;
          if (!pptxProgressJobIdRef.current || step.jobId !== pptxProgressJobIdRef.current) return;
          setPptxProgress((prev) => {
            if (step.stepId) {
              const idx = prev.steps.findIndex((s) => s.stepId === step.stepId);
              if (idx >= 0) {
                const next = [...prev.steps];
                next[idx] = step;
                return { ...prev, steps: next };
              }
            }
            return { ...prev, steps: [...prev.steps, step] };
          });
        });
      } catch (err) {
        console.warn('[slide_progress] event listener 실패:', err);
      }
    })();

    return () => {
      mounted = false;
      if (unlisten) Promise.resolve(unlisten()).catch(() => { /* listener race */ });
    };
  }, []);

  const beginPptxProgress = useCallback((label: string): string => {
    const jobId = createSlideProgressJobId();
    pptxProgressJobIdRef.current = jobId;
    pptxCancelRequestedRef.current = false;
    setPptxCanceling(false);
    setPptxBusy(label);
    setPptxProgress({ phase: 'running', steps: [] });
    return jobId;
  }, []);

  const pushPptxProgressStep = useCallback((jobId: string, step: string, detail?: string, stepId?: string) => {
    if (pptxProgressJobIdRef.current !== jobId) return;
    const progressStep: ProgressStep = { jobId, step, detail, stepId };
    setPptxProgress((prev) => {
      if (stepId) {
        const idx = prev.steps.findIndex((s) => s.stepId === stepId);
        if (idx >= 0) {
          const next = [...prev.steps];
          next[idx] = progressStep;
          return { ...prev, steps: next };
        }
      }
      return { ...prev, steps: [...prev.steps, progressStep] };
    });
  }, []);

  const handleStopPptxJob = useCallback(async () => {
    const jobId = pptxProgressJobIdRef.current;
    if (!jobId || pptxCancelRequestedRef.current) return;
    pptxCancelRequestedRef.current = true;
    setPptxCanceling(true);
    pushPptxProgressStep(jobId, '정지 요청됨', '현재 요청을 중단하는 중...', 'slide-job-cancel');
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('cancel_slide_job', { jobId });
    } catch (err) {
      console.warn('[slide_progress] cancel failed:', err);
    }
  }, [pushPptxProgressStep]);

  const clearPptxProgress = useCallback(() => {
    pptxProgressJobIdRef.current = null;
    pptxCancelRequestedRef.current = false;
    setPptxCanceling(false);
    setPptxBusy(null);
    setPptxProgress({ phase: 'idle', steps: [] });
  }, []);

  const ensurePptxJobActive = useCallback((jobId: string) => {
    if (pptxCancelRequestedRef.current || pptxProgressJobIdRef.current !== jobId) {
      throw new DOMException('Aborted', 'AbortError');
    }
  }, []);

  // 슬라이드 초안 생성 — AI는 편집 가능한 Markdown 페이지만 생성한다.
  const handleGenerateSlideDraft = useCallback(async () => {
    if (content.trim().length === 0) return;
    const isExistingDraft = SLIDE_DRAFT_MARKER_RE.test(content);
    const nextDraftVersion = isExistingDraft ? getSlideDraftMarkerVersion(content) + 1 : 1;
    const ok = await confirmAction(
      isDirty
        ? isExistingDraft
          ? '수정 지시를 반영해 현재 슬라이드 초안을 수정합니다. 저장하지 않은 변경도 수정 결과로 바뀝니다. 계속할까요?'
          : 'AI 슬라이드 초안이 현재 문서를 교체합니다. 저장하지 않은 변경도 초안으로 바뀝니다. 계속할까요?'
        : isExistingDraft
          ? '수정 지시를 반영해 현재 슬라이드 초안을 수정합니다. 계속할까요?'
          : 'AI 슬라이드 초안이 현재 문서를 교체합니다. 계속할까요?',
      { title: isExistingDraft ? '슬라이드 초안 수정' : '슬라이드 초안 만들기', kind: 'warning' },
    );
    if (!ok) return;

    const sel = getAIModelSelection();
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const jobId = beginPptxProgress(isExistingDraft ? '슬라이드 초안 수정 중…' : '슬라이드 초안 생성 중…');

      const draft = await invoke<string>('generate_slide_markdown_draft', {
        markdown: content,
        company: sel.company,
        auth: sel.auth,
        model: sel.model,
        jobId,
        options: {
          audience: pptxOptions.audience?.trim() || null,
          tone: pptxOptions.tone?.trim() || null,
          language: pptxOptions.language?.trim() || null,
          slideCountHint: pptxOptions.slideCountHint?.trim() || null,
          draftPurpose: pptxOptions.draftPurpose?.trim() || null,
          draftStructure: pptxOptions.draftStructure?.trim() || null,
          draftDepth: pptxOptions.draftDepth?.trim() || null,
          draftRevisionMode: pptxOptions.draftRevisionMode?.trim() || null,
          draftReviewMode: pptxOptions.draftReviewMode?.trim() || null,
          extraInstructions: pptxOptions.extraInstructions?.trim() || null,
        },
      });
      ensurePptxJobActive(jobId);
      let next = draft.trim();
      if (!next) throw new Error('AI가 빈 슬라이드 초안을 반환했습니다.');
      const clamped = clampMarkdownSlideDraft(next);
      if (clamped.clamped) {
        next = clamped.markdown;
        pushPptxProgressStep(
          jobId,
          '✅ 슬라이드 장수 제한 적용',
          `${clamped.originalCount}장 → ${PPTX_MAX_SLIDES}장`,
          'slide-draft-limit',
        );
      }
      pushPptxProgressStep(jobId, '📝 문서에 반영 중...', undefined, 'slide-draft-apply');
      updateContent(withSlideDraftMarker(next, nextDraftVersion));
      setViewMode('slideshow');
      pushPptxProgressStep(jobId, '✅ 슬라이드 초안 반영 완료');
    } catch (err) {
      if (pptxCancelRequestedRef.current || isUserStoppedError(err)) {
        console.info('[slide_draft] stopped by user');
        return;
      }
      console.error('[slide_draft] failed:', err);
      alert(`슬라이드 초안 생성에 실패했습니다.\n${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearPptxProgress();
    }
  }, [beginPptxProgress, clearPptxProgress, content, ensurePptxJobActive, isDirty, pptxOptions, pushPptxProgressStep, updateContent]);

  // 고급: PPTX 내보내기 — AI가 최종 슬라이드 JSON까지 만든다.
  const handleExportPptx = useCallback(async () => {
    if (content.trim().length === 0) return;
    if (SLIDE_REVIEW_MARKER_RE.test(content)) {
      const ok = await confirmAction(
        '코멘트나 검토 필요 표시가 남아 있습니다. 그래도 파워포인트를 생성할까요?',
        { title: '코멘트 확인', kind: 'warning' },
      );
      if (!ok) return;
    }

    // 모든 AI 작업은 전역 회사/인증/모델 선택(Settings > 기본 설정)을 따른다.
    const sel = getAIModelSelection();
    const baseName = (fileName || 'Untitled').replace(/\.(md|markdown|mdx|txt)$/i, '');
    try {
      const [
        { save },
        { invoke },
        { markdownToSlides, preserveSourceImagesForPptx, slideDeckFromLlmJson },
        { buildPptx },
        { normalizeSlidesForPptx, validateSlideDeck, summarizeSlideIssues },
        { resolveSlideAssets },
        { saveSlideAssetBundle },
      ] =
        await Promise.all([
          import('@tauri-apps/plugin-dialog'),
          import('@tauri-apps/api/core'),
          import('./lib/markdownToSlides'),
          import('./lib/buildPptx'),
          import('./lib/slideValidation'),
          import('./services/slideAssets'),
          import('./services/slideAssetBundle'),
        ]);
      const path = await save({
        defaultPath: `${baseName}.pptx`,
        filters: [{ name: 'PowerPoint', extensions: ['pptx'] }],
        title: 'PPTX로 내보내기',
      });
      if (!path) return; // 사용자 취소

      const jobId = beginPptxProgress('파워포인트 생성 중…');
      const slideTheme = applySlideDesignOptions(getSlideTheme(pptxOptions.themeId), pptxOptions);

      const raw = await invoke<string>('generate_slides_llm', {
        markdown: content,
        company: sel.company,
        auth: sel.auth,
        model: sel.model,
        jobId,
        options: {
          designLayout: pptxOptions.designLayout?.trim() || null,
          visualDensity: pptxOptions.visualDensity?.trim() || null,
          imagePolicy: pptxOptions.imagePolicy?.trim() || null,
          imageSourceMode: pptxOptions.imageSourceMode?.trim() || null,
          fontPreference: pptxOptions.fontPreference?.trim() || null,
          fontFamily: pptxOptions.fontFamily?.trim() || null,
          marginPreference: pptxOptions.marginPreference?.trim() || null,
          extraInstructions: pptxOptions.extraInstructions?.trim() || null,
          designRules: markMindPptxDesignRulesText(pptxOptions.designRules),
          themeName: slideTheme.name,
          themeRules: slideTheme.rules,
        },
      });
      ensurePptxJobActive(jobId);
      pushPptxProgressStep(jobId, '🔍 AI 응답 검증 중...', undefined, 'pptx-validate-response');
      const aiDeck = slideDeckFromLlmJson(raw);
      let slides = aiDeck?.slides ?? null;
      console.log(
        `[export_pptx] AI(${sel.company}/${sel.auth}) 응답 ${raw.length}자 → 슬라이드 ${slides?.length ?? 0}장, master ${aiDeck?.masterSpec ? 'yes' : 'no'}`,
      );
      if (!slides || slides.length === 0) {
        // 조용한 폴백 금지 — 사용자에게 알리고 원문 로깅(메모리: silent fallback 함정)
        console.warn('[export_pptx] AI 응답 파싱 실패, 규칙 기반 안전망으로 폴백. 원문:', raw);
        alert('AI 응답을 해석하지 못해 기본 레이아웃으로 저장합니다.\n(개발자 콘솔에 원문이 로깅되었습니다)');
        slides = markdownToSlides(content);
      }
      if (slideImagePolicyMode(pptxOptions.imagePolicy) === 'sourceOnly') {
        slides = preserveSourceImagesForPptx(slides, content);
      }

      pushPptxProgressStep(jobId, '📊 슬라이드 레이아웃 검증 중...', undefined, 'pptx-layout-qa');
      slides = normalizeSlidesForPptx(slides);
      if (slides.length > PPTX_MAX_SLIDES) {
        const originalCount = slides.length;
        slides = slides.slice(0, PPTX_MAX_SLIDES);
        pushPptxProgressStep(
          jobId,
          '✅ 슬라이드 장수 제한 적용',
          `${originalCount}장 → ${PPTX_MAX_SLIDES}장`,
          'pptx-slide-limit',
        );
      }
      const report = validateSlideDeck(slides);
      const issueSummary = summarizeSlideIssues(report);
      if (issueSummary) console.warn('[export_pptx] slide QA warnings:\n' + issueSummary);
      const baseDir = filePath ? filePath.replace(/\/[^/]*$/, '') : undefined;
      const assetResult = await resolveSlideAssets(slides, pptxOptions, {
        theme: slideTheme,
        onProgress: (step, detail, stepId) => pushPptxProgressStep(jobId, step, detail, stepId),
        isCancelled: () => pptxCancelRequestedRef.current || pptxProgressJobIdRef.current !== jobId,
      });
      ensurePptxJobActive(jobId);
      slides = assetResult.slides;
      pushPptxProgressStep(jobId, '💾 PPTX 파일 생성 중...', undefined, 'pptx-build');
      const buf = await buildPptx(slides, { title: baseName, baseDir, theme: slideTheme, masterSpec: aiDeck?.masterSpec });
      ensurePptxJobActive(jobId);
      pushPptxProgressStep(jobId, '💾 PPTX 저장 중...', undefined, 'pptx-save');
      await invoke('save_pptx', { path, data: Array.from(new Uint8Array(buf)) });
      ensurePptxJobActive(jobId);
      if (assetResult.assets.length > 0) {
        pushPptxProgressStep(jobId, '💾 이미지 에셋 저장 중...', `${assetResult.assets.length}개`, 'pptx-assets-save');
        try {
          const savedAssets = await saveSlideAssetBundle(path, assetResult.assets);
          if (savedAssets) {
            pushPptxProgressStep(jobId, '✅ 이미지 에셋 저장 완료', `${savedAssets.saved}개`, 'pptx-assets-save');
          }
        } catch (assetErr) {
          console.warn('[export_pptx] 이미지 에셋 저장 실패:', assetErr);
          pushPptxProgressStep(jobId, '⚠️ 이미지 에셋 저장 실패', undefined, 'pptx-assets-save');
        }
      }
      pushPptxProgressStep(jobId, '✅ 파워포인트 생성 완료');
    } catch (err) {
      if (pptxCancelRequestedRef.current || isUserStoppedError(err)) {
        console.info('[export_pptx] stopped by user');
        return;
      }
      console.error('[export_pptx] failed:', err);
      alert(`PPTX 내보내기에 실패했습니다.\n${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearPptxProgress();
    }
  }, [beginPptxProgress, clearPptxProgress, content, ensurePptxJobActive, fileName, filePath, pptxOptions, pushPptxProgressStep]);

  // HTML 슬라이드 내보내기 — PPTX와 같은 Slide[]/이미지 파이프라인을 공유하고 최종 렌더러만 HTML로 교체한다.
  const handleExportHtmlSlides = useCallback(async () => {
    if (content.trim().length === 0) return;
    if (SLIDE_REVIEW_MARKER_RE.test(content)) {
      const ok = await confirmAction(
        '코멘트나 검토 필요 표시가 남아 있습니다. 그래도 HTML 생성을 진행할까요?',
        { title: '코멘트 확인', kind: 'warning' },
      );
      if (!ok) return;
    }

    const sel = getAIModelSelection();
    const baseName = (fileName || 'Untitled').replace(/\.(md|markdown|mdx|txt)$/i, '');
    try {
      const [
        { save },
        { mkdir, writeTextFile },
        { invoke },
        { buildFrontendSlidesDesignRules, getHtmlSlideRuntimeFilesForHtml },
        {
          applyHtmlNativeAssetRecords,
          ensureHtmlNativeDocument,
          htmlNativeDeckFromLlmHtml,
          normalizeHtmlNativeAssetIntents,
          replaceHtmlNativeAssetPlaceholders,
          sanitizeHtmlNativeSlides,
          slidesFromHtmlNativeAssetIntents,
          summarizeHtmlNativeValidation,
          unresolvedHtmlNativeAssetPlaceholders,
          validateHtmlNativeSlidesForTemplate,
        },
        { resolveSlideAssets },
        { saveSlideAssetBundle },
        { rebaseHtmlSourceImageReferences },
      ] = await Promise.all([
        import('@tauri-apps/plugin-dialog'),
        import('@tauri-apps/plugin-fs'),
        import('@tauri-apps/api/core'),
        import('./lib/htmlSlides/frontendSlidesDocs'),
        import('./lib/htmlSlides/nativeHtmlSlides'),
        import('./services/slideAssets'),
        import('./services/slideAssetBundle'),
        import('./lib/htmlSlides/sourceImageRebase'),
      ]);
      const path = await save({
        defaultPath: `${baseName}.html`,
        filters: [{ name: 'HTML', extensions: ['html'] }],
        title: 'HTML 생성',
      });
      if (!path) return;

      const jobId = beginPptxProgress('HTML 생성 중…');
      const sourceOnlyImages = slideImagePolicyMode(pptxOptions.imagePolicy) === 'sourceOnly';
      const htmlImageSourceMode = slideImageSourceMode(pptxOptions.imageSourceMode);
      const stockOnlyImages = htmlImageSourceMode === 'stockOnly';
      const effectiveHtmlImageSourceMode = stockOnlyImages
        ? 'use stock photos and logos only; do not generate images'
        : pptxOptions.imageSourceMode?.trim() || 'prefer generated images for concepts and ambient visuals, then use stock for factual subjects';
      const htmlExportOptions: SlideExportOptions = {
        ...pptxOptions,
        visualDensity: pptxOptions.visualDensity?.trim() || 'minimal-to-balanced text density with strong whitespace and visual hierarchy',
        imagePolicy: sourceOnlyImages
          ? (pptxOptions.imagePolicy?.trim() || 'use source images only; do not add new image intent')
          : 'actively add ambient, editorial, and supporting visual intent to most HTML slides, including spacious body slides, cover, section, quote, stat, conclusion, and core argument slides',
        imageSourceMode: effectiveHtmlImageSourceMode,
      };
      const htmlTheme = getHtmlSlideTheme(pptxOptions.htmlThemeId);
      const slideTheme = applySlideDesignOptions(getSlideTheme(pptxOptions.themeId), htmlExportOptions);
      const frontendSlidesDesignRules = await buildFrontendSlidesDesignRules(htmlTheme.id, 'html');
      const htmlDesignRules = [
        'Use beautiful-html-templates as the HTML generation contract.',
        'The selected template is already chosen. Skip style preview selection and adapt the selected template directly.',
        'Output one complete HTML document with <!DOCTYPE html>, <html>, <head>, template CSS/runtime, and all slides.',
        'Do not output partial section fragments, MarkMind Slide[] JSON, PptxGenJS options, or markdown.',
        'Preserve the selected beautiful-html-templates sizing model, whether viewport-fluid, deck-stage, or inline keyboard runtime.',
        'Local sibling runtime files are allowed for provided template files such as deck-stage.js. Remote JavaScript is allowed only when it already appears in the selected template.html. Unknown local JavaScript and invented remote JavaScript are not allowed.',
        'Treat the selected beautiful-html-templates AGENTS.md, design.md, template.json, and template.html as the implementation reference. Preserve the repository template system while replacing demo content with the user document.',
        `HTML template recipe: ${htmlTheme.name}. ${htmlTheme.description}`,
        frontendSlidesDesignRules,
        [
          'Every slide must use class="slide" so the frontend-slides export scripts can find slides.',
          'Plan image slots while designing each slide. Use {{markmind_asset:asset-id}} placeholders and the markmind-asset-intents JSON script for every stock/logo/generated visual.',
          'The markmind-asset-intents script may appear near the end of <body>; it is for MarkMind image resolution only and should not drive presentation runtime behavior.',
          'If the source has lists, criteria, comparisons, processes, tables, evidence, or numeric-looking claims, use the selected repository template\'s table/chart/process/matrix/diagram patterns rather than generic bullets.',
        ].join('\n'),
        sourceOnlyImages
          ? 'Image rule: reuse existing Markdown image paths for source images when they exist, but do not invent new image intents. MarkMind will copy and rebase local source image files next to the exported HTML.'
          : stockOnlyImages
            ? 'Image rule: add stock/logo image placeholders only. Do not request generated images, do not create prompt-only asset intents, and set each markmind asset intent sourcePreference to stock or logo with a concrete query/entity.'
          : 'Image rule: add image placeholders to roughly 70-90 percent of slides. Prefer body slides with empty visual regions, section openers, quote/stat slides, cover, conclusion, and core argument slides over generic bullet-only slides.',
        'Keep content concise: no long notes, no implementation explanation visible in the deck, and no repeated source prose.',
        'Run a self-check for overflow, contrast, placeholder coverage, layout diversity, runtime behavior, and template fidelity before returning HTML.',
      ].join('\n');
      const buildHtmlLlmOptions = (retryInstruction?: string, maxOutputTokens = 28000) => ({
        designLayout: htmlExportOptions.designLayout?.trim() || 'follow the selected beautiful-html-templates layout system',
        visualDensity: htmlExportOptions.visualDensity?.trim() || null,
        imagePolicy: htmlExportOptions.imagePolicy?.trim() || null,
        imageSourceMode: htmlExportOptions.imageSourceMode?.trim() || null,
        fontPreference: htmlExportOptions.fontPreference?.trim() || null,
        fontFamily: htmlExportOptions.fontFamily?.trim() || null,
        marginPreference: htmlExportOptions.marginPreference?.trim() || null,
        extraInstructions: [htmlExportOptions.extraInstructions?.trim(), retryInstruction].filter(Boolean).join('\n\n') || null,
        designRules: htmlDesignRules,
        maxOutputTokens,
        themeName: htmlTheme.name,
        themeRules: [
          htmlTheme.description,
          'Use the selected beautiful-html-templates files as the actual HTML/CSS/JS implementation pattern.',
        ],
      });

      let raw = '';
      try {
        raw = await invoke<string>('generate_html_slides_llm', {
          markdown: content,
          company: sel.company,
          auth: sel.auth,
          model: sel.model,
          jobId,
          options: buildHtmlLlmOptions(),
        });
        ensurePptxJobActive(jobId);
      } catch (nativeErr) {
        if (pptxCancelRequestedRef.current || isUserStoppedError(nativeErr)) throw nativeErr;
        if (!isRetryableHtmlNativeError(nativeErr)) throw nativeErr;
        console.warn('[export_html_slides] native HTML request failed, retrying compact mode:', nativeErr);
        pushPptxProgressStep(jobId, 'HTML-native 응답 실패', 'compact HTML로 재시도', 'html-native-retry');
        try {
          raw = await invoke<string>('generate_html_slides_llm', {
            markdown: content,
            company: sel.company,
            auth: sel.auth,
            model: sel.model,
            jobId,
            options: buildHtmlLlmOptions(
              [
                'The previous HTML-native response failed while the app was reading the response body.',
                'Return one complete HTML document.',
                'Target 6-10 slides unless the source explicitly requires fewer.',
                'Keep CSS concise while still following the selected beautiful-html-templates template. A local deck-stage.js reference is allowed when the template uses it.',
                'Preserve markmind asset placeholders/intents.',
              ].join(' '),
              28000,
            ),
          });
          ensurePptxJobActive(jobId);
        } catch (retryErr) {
          if (pptxCancelRequestedRef.current || isUserStoppedError(retryErr)) throw retryErr;
          if (!isRetryableHtmlNativeError(retryErr)) throw retryErr;
          console.warn('[export_html_slides] compact native HTML retry failed:', retryErr);
          pushPptxProgressStep(jobId, 'HTML-native 재시도 실패', 'fallback 없이 중단', 'html-native-retry');
          throw new Error(`HTML-native 생성 재시도 실패: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`);
        }
      }
      pushPptxProgressStep(jobId, 'HTML 응답 검증 중...', undefined, 'html-validate-response');
      let nativeDeck = raw ? htmlNativeDeckFromLlmHtml(raw) : null;
      let html = '';
      let htmlAssetRecords: Awaited<ReturnType<typeof resolveSlideAssets>>['assets'] = [];
      if (nativeDeck) {
        nativeDeck = {
          ...nativeDeck,
          html: ensureHtmlNativeDocument(sanitizeHtmlNativeSlides(nativeDeck.html), baseName),
        };
        let initialReport = validateHtmlNativeSlidesForTemplate(nativeDeck.html, htmlTheme.id);
        if (initialReport.errors.length > 0) {
          const summary = summarizeHtmlNativeValidation(initialReport);
          console.warn('[export_html_slides] native HTML QA requested repair:\n' + summary);
          pushPptxProgressStep(jobId, 'HTML-native 재작성 중...', '완성 HTML 문서로 보정', 'html-native-repair');
          try {
            const repairedRaw = await invoke<string>('repair_html_slides_llm', {
              markdown: content,
              html: nativeDeck.html,
              validationSummary: [
                summary,
                `Slide count: ${initialReport.slideCount}`,
                `Layout count: ${initialReport.layoutCount}`,
              ].join('\n'),
              company: sel.company,
              auth: sel.auth,
              model: sel.model,
              jobId,
              options: buildHtmlLlmOptions(
                'Repair or reconstruct the current response as one complete HTML document, not MarkMind Slide[] JSON and not partial slide sections. If the current HTML is truncated or lacks slide sections, rebuild from the source map. Preserve selected beautiful-html-templates fidelity, local runtime references, and markmind asset placeholders/intents.',
                36000,
              ),
            });
            ensurePptxJobActive(jobId);
            let repairedDeck = htmlNativeDeckFromLlmHtml(repairedRaw);
            if (repairedDeck) {
              repairedDeck = {
                ...repairedDeck,
                html: ensureHtmlNativeDocument(sanitizeHtmlNativeSlides(repairedDeck.html), baseName),
              };
              const repairedReport = validateHtmlNativeSlidesForTemplate(repairedDeck.html, htmlTheme.id);
              if (repairedReport.errors.length === 0) {
                nativeDeck = repairedDeck;
                initialReport = repairedReport;
                pushPptxProgressStep(
                  jobId,
                  'HTML-native 재작성 완료',
                  `${repairedReport.slideCount}장`,
                  'html-native-repair',
                );
              } else {
                console.warn('[export_html_slides] repaired HTML still invalid:\n' + summarizeHtmlNativeValidation(repairedReport));
              }
            }
          } catch (repairErr) {
            if (pptxCancelRequestedRef.current || isUserStoppedError(repairErr)) throw repairErr;
            if (!isRetryableHtmlNativeError(repairErr)) throw repairErr;
            console.warn('[export_html_slides] native HTML repair failed:', repairErr);
            pushPptxProgressStep(jobId, 'HTML-native 재작성 실패', 'fallback 없이 중단', 'html-native-repair');
            throw new Error(`HTML-native 재작성 실패: ${repairErr instanceof Error ? repairErr.message : String(repairErr)}`);
          }
        }

        if (initialReport.errors.length > 0) {
          const summary = summarizeHtmlNativeValidation(initialReport);
          console.warn('[export_html_slides] native HTML QA failed:\n' + summary);
          pushPptxProgressStep(jobId, 'HTML-native 검증 실패', 'fallback 없이 중단', 'html-native-qa');
          throw new Error(`HTML-native 검증 실패\n${summary}`);
        } else {
          if (initialReport.warnings.length > 0) {
            console.warn('[export_html_slides] native HTML QA warnings:\n' + summarizeHtmlNativeValidation(initialReport));
          }
          const nativeIntents = normalizeHtmlNativeAssetIntents(nativeDeck.assetIntents);
          const sourceConstrainedIntents = stockOnlyImages
            ? nativeIntents.map((intent) => ({
                ...intent,
                sourcePreference: intent.role === 'logo' ? ('logo' as const) : ('stock' as const),
                query: intent.query || intent.entity || intent.textSummary || intent.title,
                prompt: undefined,
              }))
            : nativeIntents;
          const assetIntents = sourceOnlyImages
            ? []
            : sourceConstrainedIntents.slice(0, HTML_NATIVE_MAX_IMAGE_ASSETS);
          const cappedAssetIntents = sourceOnlyImages
            ? sourceConstrainedIntents
            : sourceConstrainedIntents.slice(HTML_NATIVE_MAX_IMAGE_ASSETS);
          let htmlWithBudgetedPlaceholders = nativeDeck.html;
          if (cappedAssetIntents.length > 0) {
            htmlWithBudgetedPlaceholders = replaceHtmlNativeAssetPlaceholders(
              htmlWithBudgetedPlaceholders,
              cappedAssetIntents,
              HTML_NATIVE_EMPTY_IMAGE_DATA_URL,
            );
            pushPptxProgressStep(
              jobId,
              sourceOnlyImages ? 'HTML 이미지 슬롯 제거' : 'HTML 이미지 슬롯 제한 적용',
              `${nativeIntents.length}개 → ${assetIntents.length}개`,
              'html-native-asset-plan',
            );
          }
          pushPptxProgressStep(
            jobId,
            'HTML 이미지 슬롯 계획 완료',
            `${assetIntents.length}개`,
            'html-native-asset-plan',
          );
          const intentSlides = slidesFromHtmlNativeAssetIntents(assetIntents);
          const assetResult = await resolveSlideAssets(intentSlides, htmlExportOptions, {
            theme: slideTheme,
            onProgress: (step, detail, stepId) => pushPptxProgressStep(jobId, step, detail, stepId),
            isCancelled: () => pptxCancelRequestedRef.current || pptxProgressJobIdRef.current !== jobId,
            stockLimitOverride: assetIntents.length,
            generatedLimitOverride: stockOnlyImages ? 0 : assetIntents.length,
          });
          ensurePptxJobActive(jobId);
          const applied = applyHtmlNativeAssetRecords(htmlWithBudgetedPlaceholders, assetResult.assets);
          const unresolvedAssetIds = unresolvedHtmlNativeAssetPlaceholders(applied.html);
          if (unresolvedAssetIds.length > 0) {
            const previewIds = unresolvedAssetIds.slice(0, 8).join(', ');
            const suffix = unresolvedAssetIds.length > 8 ? ` 외 ${unresolvedAssetIds.length - 8}개` : '';
            console.warn('[export_html_slides] unresolved native HTML asset placeholders:', unresolvedAssetIds);
            pushPptxProgressStep(
              jobId,
              'HTML 이미지 에셋 검증 실패',
              `${unresolvedAssetIds.length}개 미해결`,
              'html-native-assets-qa',
            );
            throw new Error(`HTML 이미지 에셋을 준비하지 못했습니다: ${previewIds}${suffix}`);
          }
          html = ensureHtmlNativeDocument(sanitizeHtmlNativeSlides(applied.html), baseName);
          const runtimeFiles = getHtmlSlideRuntimeFilesForHtml(html, htmlTheme.id);
          const finalReport = validateHtmlNativeSlidesForTemplate(html, htmlTheme.id);
          if (finalReport.errors.length > 0) {
            const summary = summarizeHtmlNativeValidation(finalReport);
            console.warn('[export_html_slides] native HTML final QA failed:\n' + summary);
            pushPptxProgressStep(jobId, 'HTML-native 최종 검증 실패', 'fallback 없이 중단', 'html-native-final-qa');
            throw new Error(`HTML-native 최종 검증 실패\n${summary}`);
          } else {
            if (finalReport.warnings.length > 0) {
              console.warn('[export_html_slides] native HTML final QA warnings:\n' + summarizeHtmlNativeValidation(finalReport));
            }
            htmlAssetRecords = assetResult.assets.map((record) => ({
              ...record,
              inserted: applied.insertedIds.has(record.slideId),
            }));
            if (runtimeFiles.length > 0) {
              pushPptxProgressStep(jobId, 'HTML 런타임 파일 준비 완료', `${runtimeFiles.length}개`, 'html-runtime-plan');
            }
            pushPptxProgressStep(
              jobId,
              'HTML-native 레이아웃 검증 완료',
              `${finalReport.slideCount}장 · 레이아웃 ${finalReport.layoutCount || '확인 불가'}종`,
              'html-native-final-qa',
            );
          }
        }
      } else {
        console.warn('[export_html_slides] native HTML response parsing failed. Raw:', raw);
        pushPptxProgressStep(jobId, 'HTML-native 응답 해석 실패', 'fallback 없이 중단', 'html-native-parse');
        const snippet = raw.trim().slice(0, 700) || '(empty response)';
        throw new Error(`HTML-native 응답 해석 실패\n응답 앞부분:\n${snippet}`);
      }

      if (!html.trim()) throw new Error('HTML-native 생성 결과가 비어 있습니다.');

      pushPptxProgressStep(jobId, 'HTML 파일 생성 중...', undefined, 'html-build');
      ensurePptxJobActive(jobId);
      const rebased = await rebaseHtmlSourceImageReferences(html, {
        sourceDocPath: filePath,
        sourceMarkdown: content,
        htmlPath: path,
      });
      html = rebased.html;
      if (rebased.rewritten > 0) {
        pushPptxProgressStep(
          jobId,
          'HTML 원본 이미지 준비 완료',
          `${rebased.copied}개 복사 · ${rebased.rewritten}개 경로 보정`,
          'html-source-images',
        );
      }
      ensurePptxJobActive(jobId);
      pushPptxProgressStep(jobId, 'HTML 저장 중...', undefined, 'html-save');
      await writeTextFile(path, html);
      ensurePptxJobActive(jobId);
      const runtimeFiles = getHtmlSlideRuntimeFilesForHtml(html, htmlTheme.id);
      if (runtimeFiles.length > 0) {
        pushPptxProgressStep(jobId, 'HTML 런타임 파일 저장 중...', `${runtimeFiles.length}개`, 'html-runtime-save');
        for (const runtimeFile of runtimeFiles) {
          const targetPath = siblingPathForRuntime(path, runtimeFile.path);
          if (!targetPath) continue;
          const targetDir = parentDirFromPath(targetPath);
          if (targetDir && targetDir !== parentDirFromPath(path)) {
            await mkdir(targetDir, { recursive: true });
          }
          await writeTextFile(targetPath, runtimeFile.content);
        }
        ensurePptxJobActive(jobId);
      }
      if (htmlAssetRecords.length > 0) {
        pushPptxProgressStep(jobId, '이미지 에셋 저장 중...', `${htmlAssetRecords.length}개`, 'html-assets-save');
        try {
          const savedAssets = await saveSlideAssetBundle(path, htmlAssetRecords);
          if (savedAssets) {
            pushPptxProgressStep(jobId, '이미지 에셋 저장 완료', `${savedAssets.saved}개`, 'html-assets-save');
          }
        } catch (assetErr) {
          console.warn('[export_html_slides] 이미지 에셋 저장 실패:', assetErr);
          pushPptxProgressStep(jobId, '이미지 에셋 저장 실패', undefined, 'html-assets-save');
        }
      }
      pushPptxProgressStep(jobId, 'HTML 생성 완료');
    } catch (err) {
      if (pptxCancelRequestedRef.current || isUserStoppedError(err)) {
        console.info('[export_html_slides] stopped by user');
        return;
      }
      console.error('[export_html_slides] failed:', err);
      alert(`HTML 생성에 실패했습니다.\n${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearPptxProgress();
    }
  }, [beginPptxProgress, clearPptxProgress, content, ensurePptxJobActive, fileName, filePath, pptxOptions, pushPptxProgressStep]);

  // AI
  const ai = useAI();
  // AI 결과(InlineDiff)는 에디터 페인에서만 보이므로, 보드/맵 뷰가 active 면 editor 로 전환해 diff 노출(#64, #93).
  // solo mindmap/kanban → editor, split 의 active mindmap/kanban 패인 → editor.
  useEffect(() => {
    if (ai.response && !ai.isLoading && (activeView === 'mindmap' || activeView === 'kanban')) {
      if (viewMode === 'split') {
        if (activePane === 'left') setSplitLeft('editor');
        else setSplitRight('editor');
      } else {
        setViewMode('editor');
      }
    }
  }, [ai.response, ai.isLoading, activeView, viewMode, activePane]);
  const [selectedText, setSelectedText] = useState('');
  const [selectionCoords, setSelectionCoords] = useState<{ top: number; left: number } | null>(null);
  const aiSelectionRef = useRef<{ fullContent: string; selectedText: string } | null>(null);
  // "인용" — 선택 시 라인 라벨(Editor) 추적 + 프롬프트 마커→인용 치환용 맵(UI=라인, 전송=인용).
  const selectionLineLabelRef = useRef<string | undefined>(undefined);
  const quoteMapRef = useRef<Map<string, string>>(new Map());
  const quoteKeyRef = useRef(0);
  const [injectedQuote, setInjectedQuote] = useState<{ marker: string; key: number } | null>(null);
  // 인용된 텍스트(프롬프트에 마커가 살아있는 동안) — Editor/Preview 에 영구 하이라이트.
  const [quotedTexts, setQuotedTexts] = useState<string[]>([]);

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

  // 음성/이미지 변환은 AI Agent 패널의 stt/ocr 모드로 병합됨(#60).
  // converter 는 AudioTab/OcrTab(AIPanel 내부)에 전달.
  const converter = useConverter();

  const handleToggleAI = useCallback(() => {
    ai.togglePanel();
  }, [ai]);

  // AI 패널(stt/ocr 모드)로 drop된 파일을 자식 컴포넌트에 전달하기 위한 state
  // 음성(stt)은 한 번에 여러 파일을 받을 수 있어 배열(여러 번 set 의 race 없이 한 번에 전달).
  const [audioDropped, setAudioDropped] = useState<DroppedFile[] | null>(null);
  const [ocrDropped, setOcrDropped] = useState<DroppedFile | null>(null);
  // 이미지 생성 모드에서 OS 드롭으로 들어온 참조 이미지 경로(ImageGenPanel 이 소비).
  const [imageGenRefDropped, setImageGenRefDropped] = useState<string[] | null>(null);
  const [dragActive, setDragActive] = useState(false); // #14 파일 드롭 시각 피드백

  // 최신 AI 패널 state 를 ref 로 유지 — 드롭 라우팅이 stt/ocr 모드를 참조 (listener 등록/해제 빈도 ↓)
  const panelStateRef = useRef<{ aiVisible: boolean; aiMode: AIMode }>({ aiVisible: false, aiMode: 'grammar' });
  useEffect(() => {
    panelStateRef.current = { aiVisible: ai.panelVisible, aiMode: ai.mode };
  }, [ai.panelVisible, ai.mode]);

  // drop/paste 시 이미지를 활성 패인의 에디터로 라우팅하기 위해 activeView 를 ref 로(#56, split 임의조합 #64).
  // split 이면 active 패인의 뷰, 아니면 viewMode — preview 면 Tiptap, 그 외(editor 등)면 CodeMirror.
  const activeViewRef = useRef(activeView);
  useEffect(() => {
    activeViewRef.current = activeView;
  }, [activeView]);

  // 화자 정리(rename_speakers) 후 리로드 판정에 최신 열린 파일 경로를 stale 없이 참조.
  const filePathRef = useRef(filePath);
  useEffect(() => {
    filePathRef.current = filePath;
  }, [filePath]);

  // 문서(파일)가 바뀌면 멀티턴 대화 스레드 초기화 — 이전 문서 맥락 오염 방지.
  useEffect(() => {
    ai.resetThread();
  }, [filePath, ai.resetThread]);

  // 다른 창(AI 패널)에서 화자 정리가 적용되면, 현재 열린 파일이 그 대상일 때 리로드한다.
  // rename_speakers 는 디스크만 바꾸므로 이미 열린 창엔 'speaker-relabeled' 이벤트로 알린다.
  // (openFromRecent 는 useCallback([]) 로 안정적이라 리스너는 mount 시 1회만 등록된다.)
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | null = null;
    let disposed = false;
    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const fn = await listen<{ paths: string[] }>('speaker-relabeled', async (e) => {
        const cur = filePathRef.current;
        if (!cur || !(e.payload?.paths ?? []).includes(cur)) return;
        try {
          const { readTextFile } = await import('@tauri-apps/plugin-fs');
          const text = await readTextFile(cur);
          openFromRecent(cur, text, cur.split('/').pop() || 'Untitled.md');
        } catch (err) {
          console.error('[App] 화자 정리 후 리로드 실패:', err);
        }
      });
      if (disposed) { Promise.resolve(fn()).catch(() => { /* listener race */ }); return; }
      unlisten = fn;
    })();
    return () => {
      disposed = true;
      if (unlisten) Promise.resolve(unlisten()).catch(() => { /* listener race */ });
    };
  }, [openFromRecent]);

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
          const audioExts = ['mp3','wav','m4a','qta','aac','ogg','flac','wma','amr','opus','mp4','mov','webm','m4v'];
          const ocrExts = ['png','jpg','jpeg','webp','heic','heif','gif','pdf'];
          const extOf = (fp: string) => fp.split('.').pop()?.toLowerCase() ?? '';
          const nameOf = (fp: string) => fp.split(/[\\/]/).pop() ?? fp;

          // 드롭 좌표 → 마우스가 가리킨 문서 위치에 삽입(#56). macOS 의 Tauri drop position 은
          // 이미 logical(CSS) 좌표라 devicePixelRatio 로 나누면 안 된다(나누면 위쪽으로 쏠림).
          const dropPos = (p as { position?: { x: number; y: number } }).position;
          const cx = dropPos ? dropPos.x : null;
          const cy = dropPos ? dropPos.y : null;

          // 드롭한 외부 이미지(절대경로)를 활성 에디터의 드롭 지점에 `![](절대경로)` 삽입(#56).
          // Rich Text(preview) 모드면 Tiptap, 그 외(editor/split)면 CodeMirror 로 라우팅.
          // 표시는 #55(asset://), 실제 assets/ 복사·상대경로 치환은 저장 시 flush 가 처리.
          const insertImageAbs = (absPath: string) => {
            if (activeViewRef.current === 'preview') {
              if (cx != null && cy != null) previewRef.current?.insertImageAtCoords(absPath, cx, cy);
              else previewRef.current?.insertImageMarkdown(absPath);
            } else {
              if (cx != null && cy != null) editorRef.current?.insertAtCoords(`\n![](${absPath})\n`, cx, cy);
              else editorRef.current?.insertAtCursor(`\n![](${absPath})\n`);
            }
          };

          // ── 위치 우선 라우팅: 드롭 지점이 AI 패널 영역(.ai-panel) 위면 패널, 아니면 본문. ──
          // 좌표(#56)로 elementFromPoint hit-test. macOS Tauri drop position 은 logical(CSS)
          // 좌표라 그대로 사용(÷dpr 금지). 좌표가 없으면 패널 가시성으로 fallback.
          // (dragDropEnabled=true 라 webview HTML5 onDrop 은 억제돼 OS 드롭만 들어온다.)
          const ps = panelStateRef.current;
          const overPanel =
            cx != null && cy != null
              ? !!document.elementFromPoint(cx, cy)?.closest('.ai-panel')
              : ps.aiVisible;
          if (ps.aiVisible && overPanel) {
            // 패널 영역에 드롭 → 현재 모드가 파일을 받는다(못 받는 텍스트 모드면 무시 — 본문엔 안 넣음).
            if (ps.aiMode === 'image-gen') {
              // 이미지 생성: 드롭한 이미지를 패널의 '참조 이미지'로(비이미지 무시).
              const imgs = paths.filter((fp) => imageExts.includes(extOf(fp)));
              if (imgs.length > 0) setImageGenRefDropped(imgs);
            } else if (ps.aiMode === 'stt') {
              // 음성 인식: 드롭한 오디오 전부를 파일 리스트에 추가(여러 파일 순차 변환).
              const audios = paths.filter((fp) => audioExts.includes(extOf(fp)));
              if (audios.length > 0) setAudioDropped(audios.map((fp) => ({ path: fp, name: nameOf(fp) })));
            } else if (ps.aiMode === 'ocr') {
              // OCR: 드롭한 OCR 파일 첫 개를 패널로(OcrTab 은 단일 파일).
              const ocrFp = paths.find((fp) => ocrExts.includes(extOf(fp)));
              if (ocrFp) setOcrDropped({ path: ocrFp, name: nameOf(ocrFp) });
            }
            return; // 패널 영역 드롭은 항상 패널에서 종결(본문으로 새지 않음).
          }

          // 여러 파일 동시 드롭: 마크다운은 새 창, 이미지는 전부 삽입(#56), 나머지 무시.
          if (paths.length > 1) {
            for (const fp of paths) {
              const e = extOf(fp);
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
          const ext = extOf(path);

          // 이미지 → 활성 에디터에 삽입(#56, 기존 자동 OCR 대체).
          //   미저장 문서여도 OK — 저장 시 flush 가 assets/ 로 복사·치환.
          if (imageExts.includes(ext)) {
            insertImageAbs(path);
            return;
          }

          // 마크다운/텍스트 → 현재 창에서 열기 (unsaved 시 확인). #14:
          // 기존엔 무동작이었음(RunEvent::Opened 는 Finder 더블클릭용이라 드롭엔 안 불림).
          if (mdExts.includes(ext)) {
            await handleOpenInCurrentEditorRef.current?.(path);
          }
        });
        // 등록 완료 전에 cleanup 됐으면(StrictMode/리렌더) 즉시 해제 — 리스너 누수/중복 방지
        if (disposed) { Promise.resolve(fn()).catch(() => { /* listener race */ }); return; }
        unlisten = fn;
      } catch (err) {
        console.warn('[App] drop listener 등록 실패:', err);
      }
    })();
    return () => {
      disposed = true;
      if (unlisten) Promise.resolve(unlisten()).catch(() => { /* listener race */ });
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

  // 마인드맵 노드의 "이 섹션으로 이동" — 에디터 라인으로 스크롤.
  // editor 패인이 없으면(다른 뷰/조합) editor 로 전환 후 마운트를 기다렸다가 스크롤(#64).
  const hasEditorPane = viewMode === 'editor' || (viewMode === 'split' && (splitLeft === 'editor' || splitRight === 'editor'));
  const handleJumpToSource = useCallback((line: number) => {
    if (hasEditorPane) {
      editorRef.current?.scrollToLine(line);
    } else {
      pendingScrollLineRef.current = line;
      setViewMode('editor');
    }
  }, [hasEditorPane]);

  useEffect(() => {
    if (hasEditorPane && pendingScrollLineRef.current != null) {
      const line = pendingScrollLineRef.current;
      pendingScrollLineRef.current = null;
      const t = setTimeout(() => editorRef.current?.scrollToLine(line), 120);
      return () => clearTimeout(t);
    }
  }, [hasEditorPane]);

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
        const sel = getAIModelSelection();
        const result = await converter.runNotes({
          transcript: runContent,
          template: ai.notesTemplate,
          source: fileName || 'document.md',
          company: sel.company,
          auth: sel.auth,
          model: sel.model,
        });
        if (result) ai.setNotesResult(result);
      } catch (err) {
        // 실제 사용 중 인증 실패면 설정 검증 상태 갱신(정상→확인 필요). API 키 인증일 때만.
        const failSel = getAIModelSelection();
        if (failSel.auth === 'api_key' && isAuthError(err)) {
          setValidationStatus(failSel.company, 'invalid');
        }
        ai.setError(err instanceof Error ? err.message : '회의록 생성 실패');
      } finally {
        ai.setIsLoading(false);
      }
    } else {
      // "인용" 마커([라인 N-M]/[선택])를 실제 인용으로 펼쳐 전송(UI=라인, 전송=인용).
      let expanded = runPrompt;
      if (expanded && quoteMapRef.current.size > 0) {
        quoteMapRef.current.forEach((quoteText, marker) => {
          if (expanded!.includes(marker)) {
            const quoted = quoteText.split('\n').map((l) => `> ${l}`).join('\n');
            expanded = expanded!.split(marker).join(`\n\n${quoted}\n`);
          }
        });
      }
      await ai.runAI(runContent, expanded);
    }
  }, [ai, converter, fileName]);

  // 문서 개선(improve) 결과는 chunk diff 대신 before/after Split 으로 검토(전체 변형이라 diff 가 노이즈).
  const improveResult = !!ai.response && !ai.isLoading && ai.mode === 'improve';
  const handleImproveApply = useCallback(() => {
    if (!ai.response) return;
    updateContent(ai.response.modifiedText);
    ai.commitTurn('전체 적용');
    ai.setResponse(null);
  }, [ai, updateContent]);

  const handleSelectionChange = useCallback((text: string, coords: { top: number; left: number } | null, lineLabel?: string) => {
    // FloatingAIBar(선택 시 AI 액션 팝업) 용 — selection 텍스트/좌표/라인 라벨 추적.
    setSelectedText(text);
    setSelectionCoords(coords);
    // Editor 는 lineLabel 직접 전달. Rich Text 는 줄 정보가 없어, 마크다운 content 에서 선택
    // 텍스트 위치를 찾아 줄 번호를 계산한다(서식 선택도 부분 매칭으로 근사, 못 찾으면 '선택').
    let label = lineLabel;
    if (!label && text) {
      const md = latestContentRef.current;
      // 줄바꿈 유연 매칭(quoteRange) — Rich Text 의 '\n' 과 마크다운 '\n\n' 차이를 흡수(여러 단락도).
      const r = quoteRange(md, text);
      if (r) {
        const startLine = md.slice(0, r.from).split('\n').length;
        const endLine = md.slice(0, r.to).split('\n').length;
        label = startLine === endLine ? `Line ${startLine}` : `Line ${startLine}-${endLine}`;
      }
    }
    selectionLineLabelRef.current = label;
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

  // AI 이미지 생성 결과를 현재 문서에 삽입(ImageGenPanel "문서에 삽입" 버튼).
  // base64 data URL → temp 파일 → 활성 에디터(viewMode 분기)에 `![](temp경로)`.
  // 저장(⌘S) 시 flushImagesOnSave 가 assets/ 로 복사·상대경로 치환(#56 인프라 재사용).
  const handleInsertGeneratedImage = useCallback(async (dataUrl: string) => {
    try {
      const { writeTempImage, extFromMime } = await import('./lib/imageAttach');
      const mime = dataUrl.match(/^data:([^;]+);base64,/)?.[1] ?? 'image/png';
      const b64 = dataUrl.split(',')[1] ?? '';
      const raw = atob(b64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const path = await writeTempImage(bytes, extFromMime(mime));
      if (activeViewRef.current === 'preview') previewRef.current?.insertImageMarkdown(path);
      else editorRef.current?.insertAtCursor(`\n![](${path})\n`);
    } catch (err) {
      console.error('[App] 생성 이미지 삽입 실패:', err);
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

  // Outline panel: jump to heading in editor or preview depending on active pane (#64)
  const handleOutlineClick = useCallback((id: string, line: number) => {
    if (activeView !== 'preview') {
      // editor 패인이 active(또는 solo): heading 라인으로 CodeMirror 스크롤
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
  }, [activeView]);

  const handleFloatingAction = useCallback((mode: AIMode, text: string) => {
    // Open AI panel, set mode, and run with selected text
    ai.setMode(mode);
    if (!ai.panelVisible) {
      // editor 패인이 없을 때만 solo editor 로 전환(split 의 active editor 면 그대로 유지, #64).
      if (!hasEditorPane) {
        setViewMode('editor');
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
  }, [ai, hasEditorPane, content]);

  // "인용" — 선택을 프롬프트 창에 [라인 N-M]/[선택] 마커로 넣고(UI), 실제 전송 시 인용으로 펼침.
  const handleQuote = useCallback((text: string) => {
    const label = selectionLineLabelRef.current ?? 'Selection';
    const marker = `[${label}]`;
    quoteMapRef.current.set(marker, text);
    quoteKeyRef.current += 1;
    setInjectedQuote({ marker, key: quoteKeyRef.current });
    ai.setMode('improve');
    if (!ai.panelVisible) ai.setPanelVisible(true);
    setSelectedText('');
    setSelectionCoords(null);
  }, [ai]);

  // 프롬프트(개선 입력창) 변경 → 현재 살아있는 인용 마커의 텍스트만 하이라이트로 동기화.
  // 마커를 지우거나 실행 후 setPrompt('') 되면 자동으로 빈 배열 → 하이라이트 사라짐.
  const handlePromptChange = useCallback((prompt: string) => {
    const texts: string[] = [];
    quoteMapRef.current.forEach((text, marker) => {
      if (prompt.includes(marker)) texts.push(text);
    });
    setQuotedTexts(texts);
  }, []);

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

      if (cancelled) Promise.resolve(u()).catch(() => { /* listener race */ });
      else unlisten = u;
    })();

    return () => {
      cancelled = true;
      if (unlisten) Promise.resolve(unlisten()).catch(() => { /* listener race */ });
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
    // 뷰 전환 시 검색 닫기 + 양 엔진 상태 해제
    setSearchVisible(false);
    setSearchQuery('');
    setSearchReplace('');
    setSearchShowReplace(false);
    setSearchMatchCount(0);
    setSearchCurrentIndex(-1);
    editorRef.current?.searchClear();
    window.dispatchEvent(new Event('markmind:rich-search-clear'));
  }, [viewMode, splitLeft, splitRight]);

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

  // Search toggle
  // ─── 통일 검색 (Markdown/CodeMirror + Rich Text/Tiptap 공용 SearchBar) ───
  // 엔진 라우팅: 편집/split → editorRef 프로그램 검색(동기 {count,index}), 프리뷰 →
  // Tiptap window 이벤트(카운트는 markmind:rich-search-count 로 비동기 회신).
  const applySearchInfo = useCallback((info?: { count: number; index: number } | null) => {
    if (!info) return;
    setSearchMatchCount(info.count);
    setSearchCurrentIndex(info.count > 0 ? info.index : -1);
  }, []);

  // split 의 오른쪽 프리뷰(정적 react-markdown HTML)는 Tiptap 이 아니라 검색 명령이 안 닿는다.
  // DOM 에 <mark> 를 꽂으면 react-markdown 재조정과 충돌하므로, DOM 무변경인 CSS Custom
  // Highlight API 로 매치 range 만 등록한다(미지원 webview 면 graceful 패스).
  const PREVIEW_HL = 'mm-preview-search';
  const clearPreviewHighlight = useCallback(() => {
    (CSS as unknown as { highlights?: Map<string, unknown> }).highlights?.delete(PREVIEW_HL);
  }, []);
  const highlightPreviewDom = useCallback((query: string) => {
    const reg = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    const HighlightCtor = (window as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
    if (!reg || !HighlightCtor) return; // 미지원 → 패스
    const root = document.querySelector('.preview-wrapper .markdown-body');
    if (!root || !query) { reg.delete(PREVIEW_HL); return; }
    const ranges: Range[] = [];
    const needle = query.toLowerCase();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const hay = (node.textContent ?? '').toLowerCase();
      let idx = hay.indexOf(needle);
      while (idx !== -1) {
        const r = document.createRange();
        r.setStart(node, idx);
        r.setEnd(node, idx + query.length);
        ranges.push(r);
        idx = hay.indexOf(needle, idx + needle.length);
      }
    }
    if (ranges.length) reg.set(PREVIEW_HL, new HighlightCtor(...ranges));
    else reg.delete(PREVIEW_HL);
  }, []);

  // 검색 대상 엔진 = active 패인의 뷰. preview(Tiptap) 면 rich-search 이벤트, 그 외(editor) 면 CodeMirror.
  const runSearch = useCallback((query: string, replace: string) => {
    if (activeView === 'preview') {
      window.dispatchEvent(new CustomEvent('markmind:rich-search', { detail: { query } }));
    } else {
      applySearchInfo(editorRef.current?.searchSetQuery(query, replace));
      // split 의 미러(정적 프리뷰) 하이라이트는 아래 effect 가 CSS Highlight API 로 처리.
    }
  }, [activeView, applySearchInfo]);

  const navigateMatch = useCallback((delta: number) => {
    if (activeView === 'preview') {
      window.dispatchEvent(new Event(delta > 0 ? 'markmind:rich-search-next' : 'markmind:rich-search-prev'));
    } else {
      applySearchInfo(delta > 0 ? editorRef.current?.searchNext() : editorRef.current?.searchPrev());
    }
  }, [activeView, applySearchInfo]);

  const replaceMatch = useCallback((all: boolean) => {
    if (activeView === 'preview') {
      const ev = all ? 'markmind:rich-search-replace-all' : 'markmind:rich-search-replace';
      window.dispatchEvent(new CustomEvent(ev, { detail: { replace: searchReplace } }));
    } else {
      applySearchInfo(all
        ? editorRef.current?.searchReplaceAll(searchReplace)
        : editorRef.current?.searchReplaceCurrent(searchReplace));
      // split: 소스 변경 → content 갱신 → 아래 effect 가 프리뷰 하이라이트 재계산.
    }
  }, [activeView, applySearchInfo, searchReplace]);

  const closeSearch = useCallback(() => {
    // 양 엔진 모두 해제(미마운트 쪽은 no-op) — split 의 오른쪽 하이라이트까지 확실히 정리.
    editorRef.current?.searchClear();
    window.dispatchEvent(new Event('markmind:rich-search-clear'));
    clearPreviewHighlight();
    setSearchVisible(false);
    setSearchQuery('');
    setSearchReplace('');
    setSearchShowReplace(false);
    setSearchMatchCount(0);
    setSearchCurrentIndex(-1);
  }, [clearPreviewHighlight]);

  const toggleSearch = useCallback(() => {
    if (searchVisible) {
      closeSearch();
    } else {
      setSearchVisible(true);
      setTimeout(() => searchInputRef.current?.focus(), 80);
    }
  }, [searchVisible, closeSearch]);

  // 검색어 변경 → 활성 엔진에 적용(바가 열려있을 때만). replace 는 결과에 무관해 deps 제외.
  useEffect(() => {
    if (!searchVisible) return;
    runSearch(searchQuery, searchReplace);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, searchVisible, activeView]);

  // split 의 미러(정적 프리뷰) 하이라이트 — active 가 preview 가 아니고 한쪽이 preview 미러일 때만.
  // active preview 는 Tiptap(rich-search)이 처리하므로 CSS Highlight 제외(#64).
  useEffect(() => {
    const hasMirrorPreview = viewMode === 'split' && activeView !== 'preview' && (splitLeft === 'preview' || splitRight === 'preview');
    if (hasMirrorPreview && searchVisible && searchQuery) {
      const t = setTimeout(() => highlightPreviewDom(searchQuery), 40);
      return () => clearTimeout(t);
    }
    clearPreviewHighlight();
  }, [viewMode, activeView, splitLeft, splitRight, searchVisible, searchQuery, content, highlightPreviewDom, clearPreviewHighlight]);

  // Rich Text search 결과 count + 현재 index 회신 listen — active 가 preview(Tiptap)일 때만.
  useEffect(() => {
    if (activeView !== 'preview') return;
    const onCount = (e: Event) => {
      const detail = (e as CustomEvent<{ count: number; index: number }>).detail;
      setSearchMatchCount(detail.count ?? 0);
      setSearchCurrentIndex(detail.count > 0 ? (detail.index ?? 0) : -1);
    };
    window.addEventListener('markmind:rich-search-count', onCount);
    return () => window.removeEventListener('markmind:rich-search-count', onCount);
  }, [activeView]);

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
            // 검색은 텍스트 뷰(editor/preview)가 active 일 때만 — mindmap/flowchart/gantt/kanban 는 무의미(#64).
            if (activeView === 'editor' || activeView === 'preview') {
              e.preventDefault();
              toggleSearch();
            }
            break;
          case '1':
            e.preventDefault();
            setViewMode('editor');
            break;
          case '2':
            e.preventDefault();
            setViewMode('preview');
            break;
          case '3':
            e.preventDefault();
            setViewMode('mindmap');
            break;
          case '4':
            e.preventDefault();
            setViewMode('flowchart');
            break;
          case '5':
            e.preventDefault();
            setViewMode('gantt');
            break;
          case '6':
            e.preventDefault();
            setViewMode('kanban');
            break;
          case '7':
            e.preventDefault();
            // Reserved for a future view mode.
            break;
          case '8':
            e.preventDefault();
            setViewMode('split');
            break;
          case '9':
            e.preventDefault();
            setViewMode('slideshow');
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
          case 'z': {
            // 유니버설 undo/redo (#74) — 일반 폼 입력(설정/검색 input·textarea)에선 native 로
            // 두고, 그 외(에디터·프리뷰·마인드맵·플로우차트·간트)는 전역 content 스택을 쓴다.
            const ae = document.activeElement as HTMLElement | null;
            if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) break;
            e.preventDefault();
            const r = e.shiftKey ? redo() : undo();
            if (!r) break;
            // content 외부 교체로 controlled 에디터가 재동기화하며 커서가 점프/포커스가 풀린다.
            if (activeView === 'editor') {
              // CodeMirror: undo content 를 doc 에 직접 적용(+변경 지점 커서). react-codemirror
              // 의 value sync 가 커서를 0 으로 리셋하기 전에 doc 를 맞춰 그 sync 를 skip 시킨다.
              editorRef.current?.applyContentWithCursor(r.content, r.cursorOffset);
            } else if (ae && typeof ae.focus === 'function') {
              // preview(Tiptap 내부에서 커서를 클램프 보존)·비주얼 뷰: 포커스만 복원.
              requestAnimationFrame(() => {
                if (document.body.contains(ae) && document.activeElement !== ae) {
                  ae.focus({ preventScroll: true });
                }
              });
            }
            break;
          }
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    saveFile, saveFileAs, handleOpenFile, newFile, toggleSearch,
    handleFontSizeChange, resetFontSize, recentPanelVisible,
    searchVisible, activeView, handleToggleAI, settingsVisible,
    undo, redo,
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

  // 튜토리얼을 임시 .md 로 써서 새 창에서 일반 문서처럼 연다(모달 대신 — MarkMind 도그푸딩).
  // 튜토리얼 창은 단일 인스턴스 — 이미 열려있으면 focus(매번 새 창 방지).
  const tutorialLabelRef = useRef<string | null>(null);
  const openTutorial = useCallback(async () => {
    try {
      const { getAllWebviewWindows } = await import('@tauri-apps/api/webviewWindow');
      const { invoke } = await import('@tauri-apps/api/core');
      // 이전에 연 튜토리얼 창이 아직 살아있으면 새로 만들지 않고 앞으로 가져온다.
      if (tutorialLabelRef.current) {
        const win = (await getAllWebviewWindows()).find((w) => w.label === tutorialLabelRef.current);
        if (win) { await win.setFocus(); return; }
      }
      // content 를 메모리로 직접 넘겨 새 창에서 연다(temp 파일·읽기 권한 우회 — MCP 문서 창과 동일 경로).
      tutorialLabelRef.current = await invoke<string>('open_content_window', {
        content: TUTORIAL_CONTENT,
        fileName: 'MarkMind 튜토리얼.md',
      });
    } catch (err) {
      console.error('[App] 튜토리얼 열기 실패:', err);
    }
  }, []);

  // 네이티브 macOS 메뉴바에 File/View 미러링(Tauri 한정) — 툴바 dropdown 은 숨김.
  // (조기 return 보다 위에 둬 hooks 호출 순서 보장.)
  useNativeMenu({
    enabled: isTauri(),
    viewMode,
    recentFiles,
    onNewFile: newFile,
    onOpenFile: handleOpenFile,
    onSaveFile: saveFile,
    onSaveFileAs: saveFileAs,
    onExportPdf: handleExportPdf,
    onShowSettings: () => setSettingsVisible(true),
    onShowTutorial: openTutorial,
    onOpenFromDrive: () => setDriveBrowserMode('open'),
    onSaveToDrive: () => setDriveBrowserMode('save'),
    onOpenRecent: handleOpenRecentByPath,
    onViewModeChange: setViewMode,
    onUndo: undo,
    onRedo: redo,
  });

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

  // ===== Split View(이슈 #64) 패인 렌더 =====
  // 이 패인의 뷰가 지금 편집 가능한가 — active && 편집가능뷰. solo(단일 뷰)는 항상 active.
  const paneEditable = (view: PaneView, side: 'left' | 'right' | 'solo'): boolean => {
    if (!EDITABLE_VIEWS.has(view)) return false;
    return side === 'solo' || activePane === side;
  };

  // editor 패인 콘텐츠 — 편집 가능 + AI diff 중이면 InlineDiffView, 아니면 Editor(미러는 read-only).
  const renderEditorPane = (editable: boolean) => {
    if (editable && ai.response && !ai.isLoading) {
      return (
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
                // improve 전체문서 적용 → 멀티턴 턴 커밋(선택영역 편집은 단일 턴 유지).
                if (ai.mode === 'improve') {
                  const n = ai.response.chunks.filter((c) => c.type !== 'unchanged').length;
                  if (n > 0) ai.commitTurn(`${n}곳 변경 적용`);
                }
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
                // improve 부분 적용 → 수락된 변경만 턴 커밋.
                if (ai.mode === 'improve' && ai.response) {
                  const n = ai.response.chunks.filter((c) => c.type !== 'unchanged' && c.accepted).length;
                  if (n > 0) ai.commitTurn(`${n}곳 변경 적용`);
                }
              }
            }
            ai.setResponse(null);
          }}
        />
      );
    }
    // ref 는 editable 무관하게 editor 뷰 패인에 연결 — jump/검색/삽입이 active 여부와 상관없이 동작.
    // (같은 뷰가 양쪽이면 마지막 mount 가 ref 를 차지하나 content 가 동일해 무해.)
    return (
      <Editor
        ref={editorRef}
        content={content}
        onChange={editable ? updateContent : () => {}}
        theme={theme}
        editable={editable}
        onSelectionChange={editable ? handleSelectionChange : undefined}
        onImagePaste={editable ? handleImagePaste : undefined}
        quotedTexts={quotedTexts}
      />
    );
  };

  // 패인 1개 렌더 — 7개 뷰 통합. mcpBanner 는 각 뷰 상단(preview 는 banner prop).
  // 미러(editable=false)는 read-only: editor=editable.of(false), preview=onChange 미전달,
  // mindmap/kanban=readOnly, flowchart/gantt 는 본래 read-only.
  const renderPaneView = (view: PaneView, side: 'left' | 'right' | 'solo') => {
    const editable = paneEditable(view, side);
    switch (view) {
      case 'editor':
        return <>{mcpBanner}{renderEditorPane(editable)}</>;
      case 'preview':
        return (
          <Preview
            ref={previewRef}
            content={content}
            fontSize={fontSize}
            onChange={editable ? updateContent : undefined}
            banner={mcpBanner}
            filePath={filePath}
            onSelectionChange={editable ? handleSelectionChange : undefined}
            quotedTexts={quotedTexts}
          />
        );
      case 'mindmap':
        return (
          <>
            {mcpBanner}
            <MindmapView
              content={content}
              onChange={updateContent}
              fileName={fileName}
              onJumpToSource={handleJumpToSource}
              frameworkOpen={frameworkOpen}
              onCloseFramework={() => setFrameworkOpen(false)}
              readOnly={!editable}
            />
          </>
        );
      case 'flowchart':
        return <>{mcpBanner}<FlowchartView content={content} fileName={fileName} onChange={updateContent} flowchartPanelOpen={flowchartPanelOpen} onCloseFlowchartPanel={() => setFlowchartPanelOpen(false)} /></>;
      case 'gantt':
        return <>{mcpBanner}<GanttView content={content} fileName={fileName} onJumpToSource={handleJumpToSource} onChange={updateContent} ganttPanelOpen={ganttPanelOpen} onCloseGanttPanel={() => setGanttPanelOpen(false)} /></>;
      case 'kanban':
        return <>{mcpBanner}<KanbanView content={content} fileName={fileName} onChange={editable ? updateContent : undefined} readOnly={!editable} kanbanPanelOpen={kanbanPanelOpen} onCloseKanbanPanel={() => setKanbanPanelOpen(false)} /></>;
    }
  };

  return (
    <div
      className="app"
      data-font-family={fontFamily}
      style={{
        // content 영역만 적용 — UI chrome (popover/AIPanel/Toolbar) 영향 X
        '--md-line-height': String(lineHeight),
        '--md-side-margin': readingWidthCss,
        '--md-font-size': `${fontSize}px`,
        ...(bgColor ? { '--user-bg': bgColor, '--preview-bg': bgColor } : {}),
      } as React.CSSProperties}
      data-custom-bg={bgColor ? 'true' : undefined}
    >
      {/* 음성/OCR/이미지 생성 패널은 OS 드롭을 직접 받으므로 그땐 오버레이를 숨긴다(패널로 위임). */}
      {dragActive && !(ai.panelVisible && (ai.mode === 'stt' || ai.mode === 'ocr' || ai.mode === 'image-gen')) && (
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
      >
        {/* 파일명을 타이틀바(신호등 줄) 중앙에 표시 — 클릭 시 이름변경.
            no-drag + stopPropagation 으로 클릭은 편집, 빈 영역은 창 드래그. */}
        <div className="titlebar-filename" onMouseDown={(e) => e.stopPropagation()}>
          <EditableFileName fileName={fileName} isDirty={isDirty} onRename={renameFile} />
        </div>
      </div>
      {!isFullscreen && (
      <Toolbar
        viewMode={viewMode}
        outlineVisible={outlineVisible}
        onViewModeChange={setViewMode}
        onNewFile={newFile}
        onOpenFile={handleOpenFile}
        onSaveFile={saveFile}
        onSaveFileAs={saveFileAs}
        onExportPdf={handleExportPdf}
        onShowTutorial={openTutorial}
        onShowSettings={() => setSettingsVisible(true)}
        onOpenFromDrive={() => setDriveBrowserMode('open')}
        onSaveToDrive={() => setDriveBrowserMode('save')}
        onToggleOutline={() => setOutlineVisible((v) => !v)}
        onToggleRecentFiles={() => setRecentPanelVisible((v) => !v)}
        recentFiles={recentFiles}
        onOpenRecent={handleOpenRecentByPath}
        onToggleSearch={toggleSearch}
        onToggleAI={handleToggleAI}
        onOpenFramework={() => setFrameworkOpen(true)}
        onGenerateFlowchart={() => setFlowchartPanelOpen(true)}
        onGenerateGantt={() => setGanttPanelOpen(true)}
        onGenerateKanban={() => setKanbanPanelOpen(true)}
        showRecent={isTauri()}
        aiPanelVisible={ai.panelVisible}
        nativeMenu={isTauri()}
      />
      )}

      {/* 통일 검색+바꾸기 바 (Markdown/Rich Text 공용) */}
      {searchVisible && (
        <SearchBar
          query={searchQuery}
          replaceValue={searchReplace}
          count={searchMatchCount}
          index={searchCurrentIndex}
          showReplace={searchShowReplace}
          onQueryChange={setSearchQuery}
          onReplaceChange={setSearchReplace}
          onNext={() => navigateMatch(1)}
          onPrev={() => navigateMatch(-1)}
          onReplaceOne={() => replaceMatch(false)}
          onReplaceAll={() => replaceMatch(true)}
          onToggleReplace={() => setSearchShowReplace((v) => !v)}
          onClose={toggleSearch}
          inputRef={searchInputRef}
        />
      )}

      <div className="main-content" ref={containerRef}>
        <OutlinePanel content={content} visible={outlineVisible} onHeadingClick={handleOutlineClick} />

        <div className="split-pane">
          {improveResult && ai.response ? (
            <BeforeAfterView
              before={ai.response.originalText}
              after={ai.response.modifiedText}
              fontSize={fontSize}
              onApply={handleImproveApply}
              onCancel={() => ai.setResponse(null)}
            />
          ) : viewMode === 'split' ? (
            <>
              {/* 좌 패인 — 클릭(mousedown capture)하면 active(편집 source). */}
              <div
                className={`pane pane-left${activePane === 'left' ? ' is-active' : ''}`}
                style={{ width: `${splitRatio * 100}%` }}
                onMouseDownCapture={() => setActivePane('left')}
              >
                <PaneHeader
                  view={splitLeft}
                  isActive={activePane === 'left'}
                  onSelect={(v) => { setSplitLeft(v); setActivePane('left'); }}
                />
                {renderPaneView(splitLeft, 'left')}
              </div>

              <div className="split-handle-area">
                <div
                  className={`split-handle${isDragging.current ? ' dragging' : ''}`}
                  onMouseDown={handleMouseDown}
                />
                {/* 좌우 뷰 교체 — active 패인도 함께 따라감. */}
                <button
                  className="pane-swap-btn"
                  onClick={() => {
                    setSplitLeft(splitRight);
                    setSplitRight(splitLeft);
                    setActivePane((p) => (p === 'left' ? 'right' : 'left'));
                  }}
                  title="좌우 뷰 교체"
                >
                  <ArrowLeftRight size={12} />
                </button>
                <div
                  className={`split-handle${isDragging.current ? ' dragging' : ''}`}
                  onMouseDown={handleMouseDown}
                />
              </div>

              {/* 우 패인 */}
              <div
                className={`pane pane-right${activePane === 'right' ? ' is-active' : ''}`}
                style={{ width: `${(1 - splitRatio) * 100}%` }}
                onMouseDownCapture={() => setActivePane('right')}
              >
                <PaneHeader
                  view={splitRight}
                  isActive={activePane === 'right'}
                  onSelect={(v) => { setSplitRight(v); setActivePane('right'); }}
                />
                {renderPaneView(splitRight, 'right')}
              </div>
            </>
          ) : viewMode === 'slideshow' ? null : (
            <div className="pane" style={{ width: '100%' }}>
              {renderPaneView(viewMode, 'solo')}
            </div>
          )}
        </div>

        {/* Floating AI Bar — Editor(CodeMirror) + Rich Text(Tiptap) 선택 시. 둘 다 좌표는 viewport 기준. */}
        {(activeView === 'editor' || activeView === 'preview') && (
          <FloatingAIBar
            selectedText={selectedText}
            coords={selectionCoords}
            onAction={handleFloatingAction}
            onQuote={handleQuote}
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
          onModeChange={ai.setMode}
          onLanguageChange={ai.setLanguage}
          notesTemplate={ai.notesTemplate}
          notesResult={ai.notesResult}
          loadTemplates={converter.listTemplates}
          openEditorWindow={handleOpenInCurrentEditor}
          onNotesTemplateChange={ai.setNotesTemplate}
          onRun={handleAIRun}
          injectedQuote={injectedQuote}
          onPromptChange={handlePromptChange}
          onStop={ai.stopAI}
          onShowSettings={() => setSettingsVisible(true)}
          converter={converter}
          audioDropped={audioDropped}
          ocrDropped={ocrDropped}
          onConsumeAudioDropped={() => setAudioDropped(null)}
          onConsumeOcrDropped={() => setOcrDropped(null)}
          onGenerateSlideDraft={handleGenerateSlideDraft}
          onExportPptx={handleExportPptx}
          onExportHtml={handleExportHtmlSlides}
          pptxAvailable={pptxAiReady}
          pptxBusy={pptxBusy}
          pptxThemes={BUILTIN_SLIDE_THEMES}
          pptxOptions={pptxOptions}
          onPptxOptionsChange={setPptxOptions}
          onInsertGeneratedImage={handleInsertGeneratedImage}
          imageGenRefDropped={imageGenRefDropped}
          onConsumeImageGenRefDropped={() => setImageGenRefDropped(null)}
          conversationHistory={ai.conversationHistory}
          onNewThread={ai.resetThread}
        />

      </div>

      <StatusBar content={content} filePath={filePath} />

      {pptxBusy && (
        <div className="pptx-busy-overlay" role="status" aria-live="polite">
          <div className="pptx-busy-card">
            <div className="pptx-busy-head">
              <Loader2 size={20} className="spinning" />
              <span>{pptxBusy}</span>
              <button
                type="button"
                className="pptx-stop-button"
                onClick={handleStopPptxJob}
                disabled={pptxCanceling}
                title="정지"
                aria-label="정지"
              >
                <Square size={14} />
                <span>{pptxCanceling ? '정지 중' : '정지'}</span>
              </button>
            </div>
            <ProgressPanel
              state={pptxProgress}
              newestFirst={false}
              showStepProgress={false}
              modelDetailMode="running"
            />
          </div>
        </div>
      )}

      {pdfExporting && (
        <div className="pptx-busy-overlay" role="status" aria-live="polite">
          <div className="pptx-busy-card">
            <Loader2 size={20} className="spinning" />
            <span>PDF 생성 중…</span>
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

      {/* 슬라이드쇼 — 전체화면 발표 모드(document.body portal). Esc 로 직전 뷰 복귀. */}
      {viewMode === 'slideshow' && (
        <SlideshowView
          content={content}
          filePath={filePath}
          settings={slideshowSettings}
          fontFamily={fontFamily}
          bgColor={bgColor}
          onClose={() => setViewMode(lastNonSlideshowView.current)}
        />
      )}

      {/* 통합 Settings 모달 — STT/OCR/AI 에이전트 API 키 */}
      <SettingsModal
        visible={settingsVisible}
        onClose={() => setSettingsVisible(false)}
        viewer={{
          fontSize,
          onFontSizeChange: handleFontSizeChange,
          onFontSizeReset: resetFontSize,
          lineHeight,
          onLineHeightChange: setLineHeight,
          bgColor,
          onBgColorChange: setBgColor,
          fontFamily,
          onFontFamilyChange: setFontFamily,
          readingWidth,
          onReadingWidthChange: setReadingWidth,
          slideshow: slideshowSettings,
          onSlideshowChange: handleSlideshowChange,
        }}
      />

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
