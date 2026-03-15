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
import { useFileSystem } from './hooks/useFileSystem';
import { useTheme } from './hooks/useTheme';
import { useRecentFiles } from './hooks/useRecentFiles';
import { useScrollSync } from './hooks/useScrollSync';
import { useAI } from './hooks/useAI';
import { isTauri } from './services/platform';
import { TUTORIAL_CONTENT } from './constants/tutorial';
import { Link, Unlink } from 'lucide-react';
import './App.css';

const FONT_SIZE_MIN = 12;
const FONT_SIZE_MAX = 28;
const FONT_SIZE_DEFAULT = 14;

function App() {
  const { theme, toggleTheme } = useTheme();
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
    renameFile,
  } = useFileSystem();

  const { recentFiles, addRecentFile, removeRecentFile, clearRecentFiles } =
    useRecentFiles();

  const [viewMode, setViewMode] = useState<ViewMode>('editor');
  const [splitRatio, setSplitRatio] = useState(0.5);
  const { syncEnabled, toggleSync, reattach } = useScrollSync(false);
  const [fontSize, setFontSize] = useState(() => {
    const saved = localStorage.getItem('md-editor-font-size');
    return saved ? parseInt(saved, 10) : FONT_SIZE_DEFAULT;
  });
  const [outlineVisible, setOutlineVisible] = useState(false);
  const [readingMode, setReadingMode] = useState(false);
  const [tutorialVisible, setTutorialVisible] = useState(false);
  const [recentPanelVisible, setRecentPanelVisible] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const isDragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<EditorHandle>(null);

  // AI
  const ai = useAI();
  const [selectedText, setSelectedText] = useState('');
  const [selectionCoords, setSelectionCoords] = useState<{ top: number; left: number } | null>(null);
  // Track original content & selected text when AI runs on a selection
  const aiSelectionRef = useRef<{ fullContent: string; selectedText: string } | null>(null);

  const handleToggleAI = useCallback(() => {
    // Auto-switch to editor mode when opening AI panel
    if (!ai.panelVisible && viewMode !== 'editor') {
      setViewMode('editor');
      setReadingMode(false);
    }
    ai.togglePanel();
  }, [ai, viewMode]);

  const handleSelectionChange = useCallback((text: string, coords: { top: number; left: number } | null) => {
    setSelectedText(text);
    setSelectionCoords(coords);
  }, []);

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

  // Load file from URL query parameter (for multi-window)
  useEffect(() => {
    if (!isTauri()) return;
    const params = new URLSearchParams(window.location.search);
    const fileParam = params.get('file');
    if (fileParam) {
      (async () => {
        try {
          const { readTextFile } = await import('@tauri-apps/plugin-fs');
          const content = await readTextFile(fileParam);
          const name = fileParam.split('/').pop() || 'Untitled.md';
          openFromRecent(fileParam, content, name);
        } catch (err) {
          console.error('Failed to load file from query:', err);
        }
      })();
    }
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
    // In editor or split mode, trigger CodeMirror's built-in search
    if (viewMode !== 'preview') {
      editorRef.current?.openSearch();
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

  // Preview search highlight
  const highlightMatches = useCallback((query: string) => {
    clearHighlights();
    if (!query.trim()) return;

    const previewEl = document.querySelector('.preview-wrapper .markdown-body');
    if (!previewEl) return;

    const walker = document.createTreeWalker(previewEl, NodeFilter.SHOW_TEXT);
    const matches: { node: Text; index: number }[] = [];
    const lowerQuery = query.toLowerCase();

    let node;
    while ((node = walker.nextNode())) {
      const text = (node as Text).textContent || '';
      let idx = text.toLowerCase().indexOf(lowerQuery);
      while (idx !== -1) {
        matches.push({ node: node as Text, index: idx });
        idx = text.toLowerCase().indexOf(lowerQuery, idx + 1);
      }
    }

    // Highlight in reverse order to preserve indices
    for (let i = matches.length - 1; i >= 0; i--) {
      const { node: textNode, index } = matches[i];
      const range = document.createRange();
      range.setStart(textNode, index);
      range.setEnd(textNode, index + query.length);

      const mark = document.createElement('mark');
      mark.className = 'search-highlight';
      range.surroundContents(mark);
    }

    // Scroll to first match
    const first = previewEl.querySelector('.search-highlight');
    if (first) {
      first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, []);

  const clearHighlights = useCallback(() => {
    const marks = document.querySelectorAll('.search-highlight');
    marks.forEach((mark) => {
      const parent = mark.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
        parent.normalize();
      }
    });
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

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
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
    searchVisible, viewMode, handleToggleAI,
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
        onFontSizeChange={handleFontSizeChange}
        onFontSizeReset={resetFontSize}
        onToggleOutline={() => setOutlineVisible((v) => !v)}
        onToggleReadingMode={toggleReadingMode}
        onToggleRecentFiles={() => setRecentPanelVisible((v) => !v)}
        onToggleSearch={toggleSearch}
        onToggleAI={handleToggleAI}
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
              if (e.key === 'Escape') toggleSearch();
            }}
          />
          <span className="search-count">
            {searchQuery ? document.querySelectorAll('.search-highlight').length + ' found' : ''}
          </span>
        </div>
      )}

      <div className="main-content" ref={containerRef}>
        <OutlinePanel content={content} visible={outlineVisible} />

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
          improveQuality={ai.improveQuality}
          onModeChange={ai.setMode}
          onLanguageChange={ai.setLanguage}
          onImproveQualityChange={ai.setImproveQuality}
          onRun={ai.runAI}
          onSaveApiKey={ai.saveApiKey}
          onClearApiKey={ai.clearApiKey}
          currentApiKey={ai.currentApiKey}
        />

      </div>

      <StatusBar content={content} filePath={filePath} fontSize={fontSize} />

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
              <span className="tutorial-overlay-title">📖 Tutorial</span>
              <button className="tutorial-overlay-close" onClick={() => setTutorialVisible(false)}>✕</button>
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
    </div>
  );
}

export default App;
