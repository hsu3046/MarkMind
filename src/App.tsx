import { useState, useEffect, useCallback, useRef } from 'react';
import { AIMode } from './types/ai';
import { Editor, EditorHandle } from './components/Editor';
import { Preview } from './components/Preview';
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
import type { DriveFile } from './services/gdriveService';
import { confirmAction } from './services/dialogService';
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
import { Link, Unlink, Mic, ScanText, BookOpen, X as IconX } from 'lucide-react';
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

function App() {
  const { theme, toggleTheme } = useTheme();
  const auth = useAuth();
  const [isAuthCallback, setIsAuthCallback] = useState(
    () => window.location.pathname === getCallbackPath()
  );
  // Callback ref: switch to preview when a real file is opened
  // Using a ref avoids initialization order issues (viewMode state declared below)
  const onFileOpenedRef = useRef<(() => void) | undefined>(undefined);
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
  } = useFileSystem(() => onFileOpenedRef.current?.());

  const { recentFiles, addRecentFile, removeRecentFile, clearRecentFiles } =
    useRecentFiles();

  const [viewMode, setViewMode] = useState<ViewMode>('editor');
  const [splitRatio, setSplitRatio] = useState(0.5);

  // Wire up the file-opened callback now that viewMode/setViewMode exist
  onFileOpenedRef.current = () => {
    setViewMode('preview');
    setReadingMode(false);
  };
  const { syncEnabled, toggleSync, reattach } = useScrollSync(false);
  const [fontSize, setFontSize] = useState(() => {
    const saved = localStorage.getItem('md-editor-font-size');
    return saved ? parseInt(saved, 10) : FONT_SIZE_DEFAULT;
  });
  const [outlineVisible, setOutlineVisible] = useState(false);
  const [readingMode, setReadingMode] = useState(false);
  const [tutorialVisible, setTutorialVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [driveBrowserMode, setDriveBrowserMode] = useState<'open' | 'save' | null>(null);
  const [recentPanelVisible, setRecentPanelVisible] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatchCount, setSearchMatchCount] = useState(0);
  const [searchCurrentIndex, setSearchCurrentIndex] = useState(-1);
  const searchMatchesRef = useRef<HTMLElement[]>([]);
  const searchCurrentIndexRef = useRef(-1);
  const isDragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<EditorHandle>(null);

  // AI
  const ai = useAI();
  const [selectedText, setSelectedText] = useState('');
  const [selectionCoords, setSelectionCoords] = useState<{ top: number; left: number } | null>(null);
  const aiSelectionRef = useRef<{ fullContent: string; selectedText: string } | null>(null);

  // Convert (음성/이미지) 사이드바 — AI Agent 와 mutex
  // (회의록 작성은 AI Agent의 'meeting-notes' 모드로 병합됨)
  const converter = useConverter();
  const [audioPanelVisible, setAudioPanelVisible] = useState(false);
  const [ocrPanelVisible, setOcrPanelVisible] = useState(false);

  const closeAllConvertPanels = useCallback(() => {
    setAudioPanelVisible(false);
    setOcrPanelVisible(false);
  }, []);

  const ensureEditorView = useCallback(() => {
    if (viewMode !== 'editor') {
      setViewMode('editor');
      setReadingMode(false);
    }
  }, [viewMode]);

  const handleToggleAI = useCallback(() => {
    if (!ai.panelVisible) {
      ensureEditorView();
      closeAllConvertPanels();
    }
    ai.togglePanel();
  }, [ai, ensureEditorView, closeAllConvertPanels]);

  const handleToggleAudio = useCallback(() => {
    if (audioPanelVisible) {
      setAudioPanelVisible(false);
    } else {
      if (ai.panelVisible) ai.togglePanel();
      setOcrPanelVisible(false);
      ensureEditorView();
      setAudioPanelVisible(true);
    }
  }, [audioPanelVisible, ai, ensureEditorView]);

  const handleToggleOcr = useCallback(() => {
    if (ocrPanelVisible) {
      setOcrPanelVisible(false);
    } else {
      if (ai.panelVisible) ai.togglePanel();
      setAudioPanelVisible(false);
      ensureEditorView();
      setOcrPanelVisible(true);
    }
  }, [ocrPanelVisible, ai, ensureEditorView]);

  // 사이드바로 drop된 파일을 자식 컴포넌트에 전달하기 위한 state
  const [audioDropped, setAudioDropped] = useState<DroppedFile | null>(null);
  const [ocrDropped, setOcrDropped] = useState<DroppedFile | null>(null);

  // 최신 패널 state 를 ref 로 유지 — useEffect deps 최소화 (listener 등록/해제 빈도 ↓)
  const panelStateRef = useRef({ audioPanelVisible: false, ocrPanelVisible: false });
  useEffect(() => {
    panelStateRef.current = { audioPanelVisible, ocrPanelVisible };
  }, [audioPanelVisible, ocrPanelVisible]);

  // OS-level 파일 드롭 라우팅 (mount 시 1회만 등록)
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | null = null;
    (async () => {
      try {
        const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        const win = getCurrentWebviewWindow();
        unlisten = await win.listen<{ paths: string[] }>('tauri://drag-drop', async (event) => {
          const path = event.payload?.paths?.[0];
          if (!path) return;
          const ext = path.split('.').pop()?.toLowerCase() ?? '';
          const name = path.split(/[\\/]/).pop() ?? path;
          const audioExts = ['mp3','wav','m4a','qta','aac','ogg','flac','wma','amr','opus','mp4','mov','webm','m4v'];
          const ocrExts = ['png','jpg','jpeg','webp','heic','heif','gif','pdf'];
          const { audioPanelVisible: audOn, ocrPanelVisible: ocrOn } = panelStateRef.current;

          // 1) 활성 사이드바 우선 라우팅
          if (audOn && audioExts.includes(ext)) {
            setAudioDropped({ path, name });
            return;
          }
          if (ocrOn && ocrExts.includes(ext)) {
            setOcrDropped({ path, name });
            return;
          }

          // 2) 사이드바 비활성 + 이미지 → 에디터 인라인 OCR
          if (ocrExts.filter(e => e !== 'pdf').includes(ext)) {
            try {
              const text = await converter.runOcrInline(path);
              if (text && editorRef.current) {
                editorRef.current.insertAtCursor(`\n${text}\n`);
              } else if (!text) {
                alert('인라인 OCR 실패. Gemini API 키 확인.');
              }
            } catch (err) {
              console.error('[App] 인라인 OCR 실패:', err);
            }
          }
          // 3) 마크다운/텍스트는 기존 Tauri RunEvent::Opened 가 처리 (새 윈도우)
        });
      } catch (err) {
        console.warn('[App] drop listener 등록 실패:', err);
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
    // converter 만 deps — drop handler 내부는 ref 로 최신 state 접근
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [converter]);

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
              { title: 'MarkMind', kind: 'warning' },
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

  // AIPanel "실행" 클릭 → 모드에 따라 분기
  // - meeting-notes: converter.runNotes (새 .md 생성)
  // - 그 외: ai.runAI (현재 content 변형 → InlineDiff)
  const handleAIRun = useCallback(async (runContent: string, runPrompt?: string) => {
    if (ai.mode === 'meeting-notes') {
      ai.setNotesResult(null);
      ai.setError(null);
      ai.setIsLoading(true);
      try {
        // selectedModel 이 openai 면 회의록 백엔드 미지원 → Claude 폴백
        const provider = ai.selectedModel === 'openai' ? 'claude' : ai.selectedModel;
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
    setSelectedText(text);
    setSelectionCoords(coords);
  }, []);

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
        if (!path) return;
        const { readTextFile } = await import('@tauri-apps/plugin-fs');
        const content = await readTextFile(path);
        const name = path.split('/').pop() || 'Untitled.md';
        openFromRecent(path, content, name);
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
    const matches = searchMatchesRef.current;
    if (matches.length === 0) return;
    const next = (searchCurrentIndexRef.current + delta + matches.length) % matches.length;
    goToMatchIndex(next, matches);
  }, [goToMatchIndex]);

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
    if (searchQuery) {
      const timer = setTimeout(() => highlightMatches(searchQuery), 200);
      return () => clearTimeout(timer);
    } else {
      clearHighlights();
    }
  }, [searchQuery, content, highlightMatches, clearHighlights]);

  // Open recent
  const handleOpenRecent = useCallback(
    (path: string, content: string, name: string) => {
      openFromRecent(path, content, name);
      setRecentPanelVisible(false);
    },
    [openFromRecent],
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
        switch (e.key) {
          case 's':
            e.preventDefault();
            if (e.shiftKey) saveFileAs();
            else saveFile();
            break;
          case 'o':
            e.preventDefault();
            openFile();
            break;
          case 'n':
            e.preventDefault();
            newFile();
            break;
          case 'f':
            // Only intercept for preview mode
            if (viewMode === 'preview') {
              e.preventDefault();
              toggleSearch();
            }
            // In editor/split mode, let CodeMirror handle ⌘F
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
            e.preventDefault();
            handleToggleAI();
            break;
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    saveFile, saveFileAs, openFile, newFile, toggleSearch,
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
      <div className="app reading-mode" onClick={() => setReadingMode(false)}>
        <div className="reading-mode-content" onClick={(e) => e.stopPropagation()}>
          <Preview content={content} fontSize={fontSize + 2} />
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

  return (
    <div className="app">
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
        theme={theme}
        fontSize={fontSize}
        outlineVisible={outlineVisible}
        onViewModeChange={setViewMode}
        onThemeToggle={toggleTheme}
        onNewFile={newFile}
        onOpenFile={openFile}
        onSaveFile={saveFile}
        onSaveFileAs={saveFileAs}
        onShowTutorial={() => setTutorialVisible(true)}
        onShowSettings={() => setSettingsVisible(true)}
        onOpenFromDrive={() => setDriveBrowserMode('open')}
        onSaveToDrive={() => setDriveBrowserMode('save')}
        onFontSizeChange={handleFontSizeChange}
        onFontSizeReset={resetFontSize}
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
          {viewMode !== 'preview' && (
            <div
              className="pane pane-editor"
              style={{
                width: viewMode === 'split' ? `${splitRatio * 100}%` : '100%',
              }}
            >
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
                <Editor ref={editorRef} content={content} onChange={updateContent} theme={theme} onSelectionChange={handleSelectionChange} />
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
              <Preview content={content} fontSize={fontSize} />
            </div>
          )}
        </div>

        {/* Floating AI Bar */}
        {viewMode !== 'preview' && (
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
    </div>
  );
}

export default App;
