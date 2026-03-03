import { useState, useCallback, useEffect } from 'react';
import { isTauri } from '../services/platform';

interface RecentFile {
    path: string;
    name: string;
    lastOpened: number; // timestamp
}

const STORAGE_KEY = 'md-editor-recent-files';
const MAX_RECENT = 10;

function loadRecent(): RecentFile[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function saveRecent(files: RecentFile[]) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(files));
}

// No-op stubs for web environment
const noop = () => { };

export function useRecentFiles() {
    // Web environment — return no-op stubs
    if (!isTauri()) {
        return {
            recentFiles: [] as RecentFile[],
            addRecentFile: noop as (path: string) => void,
            removeRecentFile: noop as (path: string) => void,
            clearRecentFiles: noop,
        };
    }

    return useTauriRecentFiles();
}

/** Tauri-only recent files implementation */
function useTauriRecentFiles() {
    const [recentFiles, setRecentFiles] = useState<RecentFile[]>(loadRecent);

    // Validate files on mount — remove missing ones
    useEffect(() => {
        let cancelled = false;
        const validate = async () => {
            const files = loadRecent();
            if (files.length === 0) return;

            const { exists } = await import('@tauri-apps/plugin-fs');

            const validated: RecentFile[] = [];
            for (const file of files) {
                try {
                    const fileExists = await exists(file.path);
                    if (fileExists) {
                        validated.push(file);
                    }
                } catch {
                    // File not accessible, skip
                }
            }

            if (!cancelled && validated.length !== files.length) {
                saveRecent(validated);
                setRecentFiles(validated);
            }
        };
        validate();
        return () => { cancelled = true; };
    }, []);

    const addRecentFile = useCallback((path: string) => {
        const name = path.split('/').pop() || 'Untitled.md';
        setRecentFiles((prev) => {
            const filtered = prev.filter((f) => f.path !== path);
            const updated = [
                { path, name, lastOpened: Date.now() },
                ...filtered,
            ].slice(0, MAX_RECENT);
            saveRecent(updated);
            return updated;
        });
    }, []);

    const removeRecentFile = useCallback((path: string) => {
        setRecentFiles((prev) => {
            const updated = prev.filter((f) => f.path !== path);
            saveRecent(updated);
            return updated;
        });
    }, []);

    const clearRecentFiles = useCallback(() => {
        setRecentFiles([]);
        saveRecent([]);
    }, []);

    return {
        recentFiles,
        addRecentFile,
        removeRecentFile,
        clearRecentFiles,
    };
}
