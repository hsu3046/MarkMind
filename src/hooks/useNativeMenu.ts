/**
 * Native macOS application menu (Tauri only).
 *
 * macOS shows the focused app's menu in the system menu bar. We mirror our
 * File/View actions there so the in-app toolbar can drop those dropdowns (frees
 * space). Built entirely with the Tauri v2 JS menu API — each item's `action`
 * calls the existing React handler directly (no Rust, no event bridge).
 *
 * - First submenu becomes the macOS app menu (Settings/Hide/Quit).
 * - View modes are CheckMenuItems reflecting the current mode; we update their
 *   checked state on `viewMode` change without rebuilding the whole menu.
 * - Accelerators are shown natively; macOS consumes the key equivalent before
 *   the webview, so the existing frontend keydown handler stays as the web /
 *   backup path without double-firing.
 * - On web (non-Tauri) this hook is a no-op; the toolbar keeps its dropdowns.
 */

import { useEffect, useRef } from 'react';
import type { CheckMenuItem } from '@tauri-apps/api/menu';
import type { ViewMode } from '../components/Toolbar';
import type { RecentFile } from './useRecentFiles';

export interface UseNativeMenuOptions {
    /** Only build the native menu when true (= running under Tauri). */
    enabled: boolean;
    viewMode: ViewMode;
    recentFiles: RecentFile[];
    onNewFile: () => void;
    onOpenFile: () => void;
    onSaveFile: () => void;
    onSaveFileAs: () => void;
    onExportPdf: () => void;
    onShowSettings: () => void;
    onShowTutorial: () => void;
    onOpenFromDrive: () => void;
    onSaveToDrive: () => void;
    onOpenRecent: (path: string) => void;
    onViewModeChange: (mode: ViewMode) => void;
}

/** View menu order = shortcut order (⌘1‥⌘6). */
const VIEW_ITEMS: { mode: ViewMode; label: string; accelerator: string }[] = [
    { mode: 'editor', label: 'Markdown', accelerator: 'CmdOrCtrl+1' },
    { mode: 'preview', label: 'Rich Text', accelerator: 'CmdOrCtrl+2' },
    { mode: 'split', label: 'Split View', accelerator: 'CmdOrCtrl+3' },
    { mode: 'mindmap', label: 'Mindmap', accelerator: 'CmdOrCtrl+4' },
    { mode: 'flowchart', label: 'Flowchart', accelerator: 'CmdOrCtrl+5' },
    { mode: 'gantt', label: 'Gantt', accelerator: 'CmdOrCtrl+6' },
];

export function useNativeMenu(opts: UseNativeMenuOptions) {
    // Latest handlers/state — menu `action` closures read through this ref so the
    // menu never goes stale and doesn't need rebuilding when handlers change.
    const ref = useRef(opts);
    ref.current = opts;
    // CheckMenuItem handles by mode, for cheap check-state updates.
    const checksRef = useRef<Record<string, CheckMenuItem>>({});

    // Build / rebuild the menu. Rebuilds only when the recent-files list changes
    // (the only data baked into items); handlers go through `ref`, viewMode is
    // handled by the separate effect below.
    useEffect(() => {
        if (!opts.enabled) return;
        let disposed = false;
        (async () => {
            const { Menu, Submenu, MenuItem, CheckMenuItem, PredefinedMenuItem } = await import('@tauri-apps/api/menu');
            const h = () => ref.current;
            const sep = () => PredefinedMenuItem.new({ item: 'Separator' });

            // App menu (first submenu → macOS application menu, titled by app name).
            const appMenu = await Submenu.new({
                text: 'MarkMind',
                items: [
                    await MenuItem.new({ id: 'settings', text: 'Settings…', accelerator: 'CmdOrCtrl+,', action: () => h().onShowSettings() }),
                    await sep(),
                    await PredefinedMenuItem.new({ item: 'Hide' }),
                    await PredefinedMenuItem.new({ item: 'Quit' }),
                ],
            });

            // Open Recent submenu (data-driven → triggers rebuild on change).
            const recent = ref.current.recentFiles.slice(0, 10);
            const recentItems = recent.length
                ? await Promise.all(recent.map((f) =>
                    MenuItem.new({ id: `recent:${f.path}`, text: f.name, action: () => h().onOpenRecent(f.path) })))
                : [await MenuItem.new({ id: 'recent-empty', text: '최근 파일 없음', enabled: false, action: () => {} })];
            const recentSubmenu = await Submenu.new({ text: 'Open Recent', items: recentItems });

            const fileMenu = await Submenu.new({
                text: 'File',
                items: [
                    await MenuItem.new({ id: 'new', text: 'New', accelerator: 'CmdOrCtrl+N', action: () => h().onNewFile() }),
                    await MenuItem.new({ id: 'open', text: 'Open…', accelerator: 'CmdOrCtrl+O', action: () => h().onOpenFile() }),
                    recentSubmenu,
                    await sep(),
                    await MenuItem.new({ id: 'save', text: 'Save', accelerator: 'CmdOrCtrl+S', action: () => h().onSaveFile() }),
                    await MenuItem.new({ id: 'saveas', text: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', action: () => h().onSaveFileAs() }),
                    await sep(),
                    await MenuItem.new({ id: 'export', text: 'Export as PDF…', accelerator: 'CmdOrCtrl+P', action: () => h().onExportPdf() }),
                    await sep(),
                    await MenuItem.new({ id: 'drive-open', text: 'Open from Google Drive…', action: () => h().onOpenFromDrive() }),
                    await MenuItem.new({ id: 'drive-save', text: 'Save to Google Drive…', action: () => h().onSaveToDrive() }),
                ],
            });

            const editMenu = await Submenu.new({
                text: 'Edit',
                items: [
                    await PredefinedMenuItem.new({ item: 'Undo' }),
                    await PredefinedMenuItem.new({ item: 'Redo' }),
                    await sep(),
                    await PredefinedMenuItem.new({ item: 'Cut' }),
                    await PredefinedMenuItem.new({ item: 'Copy' }),
                    await PredefinedMenuItem.new({ item: 'Paste' }),
                    await PredefinedMenuItem.new({ item: 'SelectAll' }),
                ],
            });

            // View menu — checkable, reflects the current mode.
            const checks: Record<string, CheckMenuItem> = {};
            const viewItems = [];
            for (const v of VIEW_ITEMS) {
                const item = await CheckMenuItem.new({
                    id: `view:${v.mode}`,
                    text: v.label,
                    accelerator: v.accelerator,
                    checked: ref.current.viewMode === v.mode,
                    action: () => h().onViewModeChange(v.mode),
                });
                checks[v.mode] = item;
                viewItems.push(item);
            }
            const viewMenu = await Submenu.new({ text: 'View', items: viewItems });

            const windowMenu = await Submenu.new({
                text: 'Window',
                items: [
                    await PredefinedMenuItem.new({ item: 'Minimize' }),
                    await PredefinedMenuItem.new({ item: 'Maximize' }),
                    await sep(),
                    await PredefinedMenuItem.new({ item: 'Fullscreen' }),
                ],
            });

            const helpMenu = await Submenu.new({
                text: 'Help',
                items: [await MenuItem.new({ id: 'tutorial', text: 'Tutorial', action: () => h().onShowTutorial() })],
            });

            const menu = await Menu.new({ items: [appMenu, fileMenu, editMenu, viewMenu, windowMenu, helpMenu] });
            if (disposed) return;
            checksRef.current = checks;
            await menu.setAsAppMenu();
        })().catch((e) => console.error('[useNativeMenu] build failed:', e));

        return () => { disposed = true; };
    }, [opts.enabled, opts.recentFiles]);

    // Reflect the active view mode without rebuilding the whole menu.
    useEffect(() => {
        if (!opts.enabled) return;
        const checks = checksRef.current;
        for (const v of VIEW_ITEMS) {
            checks[v.mode]?.setChecked(opts.viewMode === v.mode).catch(() => {});
        }
    }, [opts.enabled, opts.viewMode]);
}
