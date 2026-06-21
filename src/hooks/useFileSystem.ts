import { useState, useCallback, useRef, useEffect } from 'react';
import { isTauri } from '../services/platform';
import { webOpenFile, webSaveFile, webConfirmUnsavedChanges, hasLanServer, lanWriteFile, type LanWriteError } from '../services/webFileSystem';

interface FileState {
  content: string;
  filePath: string | null;
  fileName: string;
  isDirty: boolean;
  /** LAN 서버로 연 파일의 base mtime(epoch ms) — 저장 시 충돌 감지(P2). */
  lanModified?: number;
}



// ─── Tauri API lazy imports ───
async function tauriOpen() {
  const { open } = await import('@tauri-apps/plugin-dialog');
  return open;
}
async function tauriSave() {
  const { save } = await import('@tauri-apps/plugin-dialog');
  return save;
}
async function tauriAsk() {
  const { ask } = await import('@tauri-apps/plugin-dialog');
  return ask;
}
async function tauriReadTextFile() {
  const { readTextFile } = await import('@tauri-apps/plugin-fs');
  return readTextFile;
}
async function tauriWriteTextFile() {
  const { writeTextFile } = await import('@tauri-apps/plugin-fs');
  return writeTextFile;
}

// 같은 path 가 짧은 시간(StrictMode 이중 listen·중복 open-file 이벤트)에 두 번 들어오면
// 새 창이 2개 열리므로(중복/빈 창) 1초 디바운스로 1회만 처리. 윈도우(webview)별 모듈
// 스코프라 창마다 독립.
const recentOpenByPath = new Map<string, number>();

/** 두 문자열의 공통 prefix 길이 — undo/redo 후 에디터 커서를 변경 지점으로 옮기는 데 사용(#74). */
function commonPrefixLength(a: string, b: string): number {
    const n = Math.min(a.length, b.length);
    let i = 0;
    while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
    return i;
}

export function useFileSystem(
  onFileOpened?: () => void,
  /** 저장 직전 본문 변환 (Tauri 저장 경로). 예: 임시 이미지 → assets 복사 + 경로 치환(#56).
   *  실패 시 throw 하면 원본으로 저장한다. path 는 확정된 저장 경로. */
  transformOnSave?: (content: string, path: string) => Promise<string>,
) {
  const [fileState, setFileState] = useState<FileState>({
    content: '',
    filePath: null,
    fileName: 'Untitled.md',
    isDirty: false,
  });
  const contentRef = useRef(fileState.content);
  const isDirtyRef = useRef(fileState.isDirty);
  const filePathRef = useRef(fileState.filePath);
  const fileNameRef = useRef(fileState.fileName);
  const lanModifiedRef = useRef(fileState.lanModified);
  const transformOnSaveRef = useRef(transformOnSave);

  // ─── Undo/Redo history (#74) — 유니버설(모든 뷰 공통) content 스냅샷 단일 스택.
  // 모든 편집의 단일 관문 updateContent 에서 push, 전역 ⌘Z/⌘⇧Z(App)가 undo/redo.
  // 타이핑은 600ms idle 경계로 한 묶음(coalescing). 파일 열기/새 파일은 clearHistory.
  const undoStackRef = useRef<string[]>([]);
  const redoStackRef = useRef<string[]>([]);
  const lastPushRef = useRef(0);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const clearHistory = useCallback(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    lastPushRef.current = 0;
    setCanUndo(false);
    setCanRedo(false);
  }, []);

  // undo/redo 는 복원된 content 와 변경 지점(cursorOffset)을 반환 — 호출부(App)가 에디터
  // 커서를 그 지점으로 옮겨 "커서 점프"를 막는다. 스택이 비면 null.
  const undo = useCallback((): { content: string; cursorOffset: number } | null => {
    if (undoStackRef.current.length === 0) return null;
    const current = contentRef.current;
    redoStackRef.current.push(current);
    const prev = undoStackRef.current.pop()!;
    contentRef.current = prev;
    lastPushRef.current = 0; // 되돌린 직후 편집은 새 묶음으로
    setFileState((p) => ({ ...p, content: prev, isDirty: true }));
    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(true);
    return { content: prev, cursorOffset: commonPrefixLength(current, prev) };
  }, []);

  const redo = useCallback((): { content: string; cursorOffset: number } | null => {
    if (redoStackRef.current.length === 0) return null;
    const current = contentRef.current;
    undoStackRef.current.push(current);
    const next = redoStackRef.current.pop()!;
    contentRef.current = next;
    lastPushRef.current = 0;
    setFileState((p) => ({ ...p, content: next, isDirty: true }));
    setCanUndo(true);
    setCanRedo(redoStackRef.current.length > 0);
    return { content: next, cursorOffset: commonPrefixLength(current, next) };
  }, []);

  useEffect(() => {
    contentRef.current = fileState.content;
    isDirtyRef.current = fileState.isDirty;
    filePathRef.current = fileState.filePath;
    fileNameRef.current = fileState.fileName;
    lanModifiedRef.current = fileState.lanModified;
  }, [fileState]);
  useEffect(() => {
    transformOnSaveRef.current = transformOnSave;
  }, [transformOnSave]);

  /** 저장 경로 확정 후 본문 변환 — 실패해도 원본 반환(저장은 진행). */
  const applyTransform = async (content: string, path: string): Promise<string> => {
    const fn = transformOnSaveRef.current;
    if (!fn) return content;
    try {
      return await fn(content, path);
    } catch (err) {
      console.error('[useFileSystem] transformOnSave 실패, 원본 저장:', err);
      return content;
    }
  };

  // ─── MCP 읽기 전용 서버에 현재 문서 스냅샷 동기화 ───
  // 각 윈도우가 자기 fileState 를 Rust 공유 상태에 push → Claude Code 등이
  // MCP tool 로 "열린 문서"를 읽음. 매 키 입력마다 전체 content 를 IPC 로
  // 보내면 큰 문서에서 비용이 크므로 600ms 디바운스. 읽기 전용이라 약간의
  // stale 은 허용. web 모드(비-Tauri)는 no-op.
  useEffect(() => {
    if (!isTauri()) return;
    const timer = setTimeout(() => {
      (async () => {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('mcp_sync_document', {
            content: fileState.content,
            filePath: fileState.filePath,
            fileName: fileState.fileName,
            isDirty: fileState.isDirty,
          });
        } catch {
          // MCP 서버 미기동/포트 충돌 등 — 본 편집 기능과 무관하므로 무시
        }
      })();
    }, 600);
    return () => clearTimeout(timer);
  }, [fileState]);

  // MCP 편집은 propose_edit(diff 승인) 한 경로로 일원화됨 — App 의 'mcp-propose-edit'
  // 리스너가 처리. 직접 적용 경로('mcp-apply-edit')는 제거(자동 적용/저장 방지).

  // Listen for file open events from Tauri backend (double-click, drag, etc.)
  // Only runs in Tauri environment
  useEffect(() => {
    if (!isTauri()) return;

    let cancelled = false;

    const setup = async () => {
      const readTextFile = await tauriReadTextFile();
      const { listen } = await import('@tauri-apps/api/event');
      const { invoke } = await import('@tauri-apps/api/core');

      const openByPath = async (path: string) => {
        // 디바운스 — StrictMode 이중 listen/중복 이벤트로 같은 path 가 연속 들어와도
        // 새 창은 1개만 열리도록 1초 내 같은 path 재진입을 막는다.
        const now = performance.now();
        const last = recentOpenByPath.get(path);
        if (last !== undefined && now - last < 1000) return;
        recentOpenByPath.set(path, now);
        try {
          // If a file is already open, open in a new window (same as ⌘O behavior)
          const hasExistingFile = filePathRef.current || contentRef.current.length > 0;
          if (hasExistingFile) {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('open_new_window', { filePath: path });
            return;
          }
          const content = await readTextFile(path);
          const name = path.split('/').pop() || 'Untitled.md';
          if (!cancelled) {
            setFileState({ content, filePath: path, fileName: name, isDirty: false });
            clearHistory(); // 새 문서 로드 — undo 가 이전 파일로 새지 않게
            onFileOpened?.();
          }
        } catch (err) {
          console.error('Failed to open file:', err);
          // 실패가 console 에만 남으면 사용자에겐 "빈 페이지" 로만 보임 — 다이얼로그로 표시
          try {
            const { message } = await import('@tauri-apps/plugin-dialog');
            await message(`파일을 열 수 없습니다.\n\n${path}\n\n${String(err)}`, {
              title: 'MarkMind',
              kind: 'error',
            });
          } catch {
            // dialog 자체 실패 시엔 console 로그만 유지
          }
        }
      };

      // Check for file passed during app launch
      const pendingPath = await invoke<string | null>('get_pending_file');
      if (pendingPath) openByPath(pendingPath);

      // Listen for files opened while app is already running
      const unlisten = await listen<string>('open-file', (event) => {
        openByPath(event.payload);
      });

      return unlisten;
    };

    const cleanupPromise = setup();

    return () => {
      cancelled = true;
      // unlisten async — 이미 해제된 listener 재해제 race 의 unhandled rejection 차단.
      cleanupPromise.then((unlisten) => {
        if (unlisten) Promise.resolve(unlisten()).catch(() => { /* listener race */ });
      }).catch(() => { /* setup 실패 */ });
    };
  }, []);

  // ─── Confirm unsaved changes ───
  const confirmUnsavedChanges = useCallback(async (): Promise<'save' | 'discard' | 'cancel'> => {
    if (!isDirtyRef.current) return 'discard';

    if (!isTauri()) {
      return webConfirmUnsavedChanges();
    }

    const ask = await tauriAsk();
    const shouldSave = await ask(
      'Current file has unsaved changes. Save before continuing?',
      { title: 'Unsaved Changes', kind: 'warning', okLabel: 'Save', cancelLabel: 'Discard' }
    );

    if (shouldSave) {
      try {
        let path = filePathRef.current;
        if (!path) {
          const save = await tauriSave();
          const selected = await save({
            filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
            defaultPath: fileNameRef.current,
          });
          if (!selected) return 'cancel';
          path = selected;
        }
        const writeTextFile = await tauriWriteTextFile();
        await writeTextFile(path, contentRef.current);
        return 'save';
      } catch {
        return 'cancel';
      }
    }

    return 'discard';
  }, []);

  const updateContent = useCallback((newContent: string) => {
    // Undo 스택 — 변경 직전 content 를 push. 연속 입력(타이핑)은 600ms idle 경계로 한
    // 묶음(coalescing): idle 후 첫 변경에서만 스냅샷 → 그 묶음을 한 번에 undo.
    const now = Date.now();
    if (now - lastPushRef.current > 600) {
      undoStackRef.current.push(contentRef.current);
      if (undoStackRef.current.length > 200) undoStackRef.current.shift();
      redoStackRef.current = [];
      setCanUndo(true);
      setCanRedo(false);
    }
    lastPushRef.current = now;
    // contentRef 동기 갱신 — editor-action(replace_selection/insert_text)이
    // updateContent 경유로 content 를 바꾼 직후 도착하는 str_replace 가 stale 한
    // 옛 content 로 계산하지 않도록(단일 content 소스 동기화). useEffect 갱신은 비동기.
    contentRef.current = newContent;
    setFileState((prev) => ({ ...prev, content: newContent, isDirty: true }));
  }, []);

  // ─── Open File ───
  const openFile = useCallback(async () => {
    try {
      if (!isTauri()) {
        // Web mode — always open in same window
        const result = await confirmUnsavedChanges();
        if (result === 'cancel') return;
        const file = await webOpenFile();
        if (file) {
          setFileState({
            content: file.content,
            filePath: null,
            fileName: file.name,
            isDirty: false,
          });
          clearHistory();
          onFileOpened?.();
        }
        return;
      }

      // Tauri mode — show file picker first
      const open = await tauriOpen();
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdx', 'txt'] }],
      });

      if (selected) {
        const path = typeof selected === 'string' ? selected : selected;
        const hasExistingFile = filePathRef.current || contentRef.current.length > 0;

        if (hasExistingFile) {
          // Already has content → open in new window
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('open_new_window', { filePath: path });
        } else {
          // Empty editor → open in current window
          const readTextFile = await tauriReadTextFile();
          const content = await readTextFile(path);
          const name = path.split('/').pop() || 'Untitled.md';
          setFileState({ content, filePath: path, fileName: name, isDirty: false });
          clearHistory();
          onFileOpened?.();
        }
      }
    } catch (err) {
      console.error('Failed to open file:', err);
    }
  }, [confirmUnsavedChanges]);

  // ─── Save File ───
  // 결과를 반환한다: 'saved'(디스크 저장됨) | 'cancelled'(다이얼로그 취소) | 'failed'(쓰기 실패).
  // MCP save_document tool 이 이 결과로 정직하게 ack 하도록(성공 오보 방지).
  // filePath/fileName 은 ref 로 읽어 closure stale(이름변경 경합)을 피하고 deps 를 [] 로.
  const saveFile = useCallback(async (): Promise<'saved' | 'cancelled' | 'failed'> => {
    try {
      if (!isTauri()) {
        // LAN 서버 모드 — filePath(서버 루트 기준 상대경로)가 있으면 원본을
        // in-place 로 덮어쓴다(다운로드 사본 아님). 아이폰 등에서 핵심 흐름.
        // base mtime 을 보내 외부 변경(맥에서 같은 파일 편집 등) 시 409 → 사용자
        // 확인 후에만 강제 덮어쓰기(P2 lost update 방지).
        if (hasLanServer() && filePathRef.current) {
          const path = filePathRef.current;
          try {
            const res = await lanWriteFile(path, contentRef.current, lanModifiedRef.current);
            setFileState((prev) => ({ ...prev, isDirty: false, lanModified: res.modified }));
            return 'saved';
          } catch (err) {
            if ((err as LanWriteError).conflict) {
              const ok = window.confirm(
                '이 파일이 다른 곳에서 변경되었습니다.\n현재 편집 내용으로 덮어쓸까요? (외부 변경분이 사라집니다)',
              );
              if (!ok) return 'cancelled';
              try {
                // 강제 저장 — base 생략으로 충돌 검사 우회
                const res2 = await lanWriteFile(path, contentRef.current);
                setFileState((prev) => ({ ...prev, isDirty: false, lanModified: res2.modified }));
                return 'saved';
              } catch (err2) {
                console.error('Failed to force-save to LAN server:', err2);
                return 'failed';
              }
            }
            console.error('Failed to save to LAN server:', err);
            return 'failed';
          }
        }
        // Web mode (브라우저 다운로드 fallback)
        const savedName = await webSaveFile(contentRef.current, fileNameRef.current, false);
        if (savedName) {
          setFileState((prev) => ({ ...prev, fileName: savedName, isDirty: false }));
          return 'saved';
        }
        return 'cancelled';
      }

      // Tauri mode
      let path = filePathRef.current;
      if (!path) {
        const save = await tauriSave();
        const selected = await save({
          filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
          defaultPath: fileNameRef.current,
        });
        if (!selected) return 'cancelled';
        path = selected;
      }
      const finalContent = await applyTransform(contentRef.current, path);
      const writeTextFile = await tauriWriteTextFile();
      await writeTextFile(path, finalContent);
      const name = path.split('/').pop() || 'Untitled.md';
      // finalContent 로 갱신 — 임시 이미지 경로가 ./assets/ 로 치환된 본문을 에디터에도 반영(#56)
      setFileState((prev) => ({ ...prev, content: finalContent, filePath: path, fileName: name, isDirty: false }));
      return 'saved';
    } catch (err) {
      console.error('Failed to save file:', err);
      return 'failed';
    }
  }, []);

  // ─── Save File As ───
  const saveFileAs = useCallback(async () => {
    try {
      if (!isTauri()) {
        // Web mode — always "save as"
        const savedName = await webSaveFile(contentRef.current, fileNameRef.current, true);
        if (savedName) {
          setFileState((prev) => ({ ...prev, fileName: savedName, isDirty: false }));
        }
        return;
      }

      // Tauri mode
      const save = await tauriSave();
      const selected = await save({
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
        defaultPath: fileState.fileName,
      });
      if (!selected) return;

      const finalContent = await applyTransform(contentRef.current, selected);
      const writeTextFile = await tauriWriteTextFile();
      await writeTextFile(selected, finalContent);
      const name = selected.split('/').pop() || 'Untitled.md';
      setFileState((prev) => ({ ...prev, content: finalContent, filePath: selected, fileName: name, isDirty: false }));
    } catch (err) {
      console.error('Failed to save file:', err);
    }
  }, [fileState.fileName]);

  // ─── New File ───
  const newFile = useCallback(async () => {
    if (isTauri()) {
      // Tauri: open a new window with empty file
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('open_new_window', { filePath: null });
      } catch (err) {
        console.error('Failed to open new window:', err);
      }
      return;
    }

    // Web: reset current state
    const result = await confirmUnsavedChanges();
    if (result === 'cancel') return;
    setFileState({ content: '', filePath: null, fileName: 'Untitled.md', isDirty: false });
    clearHistory();
  }, [confirmUnsavedChanges]);



  // Open file directly from path and content (recent files — Tauri; LAN browser).
  // lanModified 를 주면(LAN 모드) 저장 시 충돌 감지의 base 로 보관.
  const openFromRecent = useCallback(
    (path: string, content: string, name: string, lanModified?: number) => {
      setFileState({ content, filePath: path, fileName: name, isDirty: false, lanModified });
      clearHistory();
      onFileOpened?.();
    },
    [onFileOpened],
  );

  // 메모리(예: Google Drive 다운로드)에서 가져온 내용을 새 가상 파일로 로드.
  // filePath 는 null — 사용자가 Save 누르면 Save As 다이얼로그.
  const loadFromMemory = useCallback((contentText: string, name: string) => {
    const finalName = name.endsWith('.md') || name.endsWith('.markdown') ? name : `${name}.md`;
    setFileState({ content: contentText, filePath: null, fileName: finalName, isDirty: false });
    clearHistory();
    onFileOpened?.();
  }, [onFileOpened]);

  // Rename file (inline editing in toolbar)
  const renameFile = useCallback(async (newName: string) => {
    if (!newName.trim() || newName === fileNameRef.current) return;

    // Ensure .md extension
    const finalName = newName.endsWith('.md') || newName.endsWith('.mdx') || newName.endsWith('.txt') || newName.endsWith('.markdown')
      ? newName
      : newName + '.md';

    if (isTauri() && filePathRef.current) {
      try {
        const { rename } = await import('@tauri-apps/plugin-fs');
        const oldPath = filePathRef.current;
        const dir = oldPath.substring(0, oldPath.lastIndexOf('/'));
        const newPath = `${dir}/${finalName}`;
        await rename(oldPath, newPath);
        setFileState(prev => ({ ...prev, fileName: finalName, filePath: newPath }));
      } catch (err) {
        console.error('Failed to rename file:', err);
        // display name 만 바꾸면 filePath 는 옛 경로라 저장 시 이름이 복원돼 "수정→저장→원복"
        // 착시를 부른다(조용한 실패). 이름을 그대로 두고 실패를 사용자에게 알린다.
        try {
          const { message } = await import('@tauri-apps/plugin-dialog');
          await message(`파일 이름을 변경할 수 없습니다.\n\n${String(err)}`, { title: 'MarkMind', kind: 'error' });
        } catch {
          // dialog 자체 실패 시엔 console 로그만 유지
        }
      }
    } else {
      // Not saved yet or web mode: just update the display name
      setFileState(prev => ({ ...prev, fileName: finalName }));
    }
  }, []);

  return {
    ...fileState,
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
    canUndo,
    canRedo,
    clearHistory,
  };
}
