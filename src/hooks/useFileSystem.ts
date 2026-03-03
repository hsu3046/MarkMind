import { useState, useCallback, useRef, useEffect } from 'react';
import { isTauri } from '../services/platform';
import { webOpenFile, webSaveFile, webConfirmUnsavedChanges } from '../services/webFileSystem';

interface FileState {
  content: string;
  filePath: string | null;
  fileName: string;
  isDirty: boolean;
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

export function useFileSystem() {
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

  useEffect(() => {
    contentRef.current = fileState.content;
    isDirtyRef.current = fileState.isDirty;
    filePathRef.current = fileState.filePath;
    fileNameRef.current = fileState.fileName;
  }, [fileState]);

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
          }
        } catch (err) {
          console.error('Failed to open file:', err);
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
      cleanupPromise.then((unlisten) => {
        if (unlisten) unlisten();
      });
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
        }
      }
    } catch (err) {
      console.error('Failed to open file:', err);
    }
  }, [confirmUnsavedChanges]);

  // ─── Save File ───
  const saveFile = useCallback(async () => {
    try {
      if (!isTauri()) {
        // Web mode
        const savedName = await webSaveFile(contentRef.current, fileNameRef.current, false);
        if (savedName) {
          setFileState((prev) => ({ ...prev, fileName: savedName, isDirty: false }));
        }
        return;
      }

      // Tauri mode
      let path = fileState.filePath;
      if (!path) {
        const save = await tauriSave();
        const selected = await save({
          filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
          defaultPath: fileState.fileName,
        });
        if (!selected) return;
        path = selected;
      }
      const writeTextFile = await tauriWriteTextFile();
      await writeTextFile(path, contentRef.current);
      const name = path.split('/').pop() || 'Untitled.md';
      setFileState((prev) => ({ ...prev, filePath: path, fileName: name, isDirty: false }));
    } catch (err) {
      console.error('Failed to save file:', err);
    }
  }, [fileState.filePath, fileState.fileName]);

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

      const writeTextFile = await tauriWriteTextFile();
      await writeTextFile(selected, contentRef.current);
      const name = selected.split('/').pop() || 'Untitled.md';
      setFileState((prev) => ({ ...prev, filePath: selected, fileName: name, isDirty: false }));
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
  }, [confirmUnsavedChanges]);



  // Open file directly from path and content (for recent files — Tauri only)
  const openFromRecent = useCallback((path: string, content: string, name: string) => {
    setFileState({ content, filePath: path, fileName: name, isDirty: false });
  }, []);

  return {
    ...fileState,
    updateContent,
    openFile,
    saveFile,
    saveFileAs,
    newFile,
    openFromRecent,
  };
}
