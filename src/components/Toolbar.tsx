import { useState, useRef, useEffect } from 'react';
import {
    Columns2, BookOpen,
    FilePlus, FolderOpen, Save, Download, FileDown,
    BookMarked, Clock, History,
    Search, ChevronRight, ChevronDown, Sparkles, Check, X,
    Settings,
    FileCode, FileText,
    Network, Share2, ChartBarStacked, type LucideIcon,
} from 'lucide-react';
import * as gdriveService from '../services/gdriveService';
import type { RecentFile } from '../hooks/useRecentFiles';

export type ViewMode = 'split' | 'editor' | 'preview' | 'mindmap' | 'flowchart' | 'gantt';

/** View 메뉴 항목 — 라벨/단축키/아이콘. 사용자가 보는 순서(편집→읽기→분할→…). */
const VIEW_MODES: { mode: ViewMode; label: string; shortcut: string; Icon: LucideIcon }[] = [
    { mode: 'editor', label: 'Markdown', shortcut: '⌘1', Icon: FileCode },
    { mode: 'preview', label: 'Rich Text', shortcut: '⌘2', Icon: FileText },
    { mode: 'split', label: 'Split View', shortcut: '⌘3', Icon: Columns2 },
    { mode: 'mindmap', label: 'Mindmap', shortcut: '⌘4', Icon: Share2 },
    { mode: 'flowchart', label: 'Flowchart', shortcut: '⌘5', Icon: Network },
    { mode: 'gantt', label: 'Gantt', shortcut: '⌘6', Icon: ChartBarStacked },
];

/** 최근 파일 날짜 표시 — 오늘이면 시각, 아니면 YYYY.MM.DD. */
function formatRecentDate(ts: number): string {
    const d = new Date(ts);
    const now = new Date();
    const p2 = (n: number) => String(n).padStart(2, '0');
    if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) {
        return `오늘 ${p2(d.getHours())}:${p2(d.getMinutes())}`;
    }
    return `${d.getFullYear()}.${p2(d.getMonth() + 1)}.${p2(d.getDate())}`;
}

export function EditableFileName({ fileName, isDirty, onRename }: { fileName: string; isDirty: boolean; onRename: (name: string) => void }) {
    const [editing, setEditing] = useState(false);
    const [editValue, setEditValue] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    const startEditing = () => {
        // Remove extension for editing
        const dotIndex = fileName.lastIndexOf('.');
        setEditValue(dotIndex > 0 ? fileName.substring(0, dotIndex) : fileName);
        setEditing(true);
    };

    useEffect(() => {
        if (editing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [editing]);

    const handleConfirm = () => {
        setEditing(false);
        const trimmed = editValue.trim();
        if (trimmed) {
            onRename(trimmed);
        }
    };

    const handleCancel = () => {
        setEditing(false);
    };

    if (editing) {
        return (
            <div className="toolbar-filename-edit">
                <input
                    ref={inputRef}
                    className={`toolbar-filename-input${isDirty ? ' unsaved' : ''}`}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') handleConfirm();
                        if (e.key === 'Escape') handleCancel();
                    }}
                    onBlur={(e) => {
                        // Don't blur-confirm if clicking the buttons
                        if (e.relatedTarget?.closest('.toolbar-filename-edit')) return;
                        handleConfirm();
                    }}
                />
                <button className="toolbar-filename-action confirm" onClick={handleConfirm} title="Confirm">
                    <Check size={14} strokeWidth={2} />
                </button>
                <button className="toolbar-filename-action cancel" onMouseDown={(e) => { e.preventDefault(); handleCancel(); }} title="Cancel">
                    <X size={14} strokeWidth={2} />
                </button>
            </div>
        );
    }

    return (
        <div
            className={`toolbar-filename${isDirty ? ' unsaved' : ''}`}
            onClick={startEditing}
            title="Click to rename"
        >
            {fileName}
        </div>
    );
}

interface ToolbarProps {
    viewMode: ViewMode;
    outlineVisible: boolean;
    showRecent: boolean;
    aiPanelVisible: boolean;
    /** Tauri: File/View 는 네이티브 메뉴바로 이동했으므로 툴바에서 숨긴다(웹은 표시). */
    nativeMenu?: boolean;
    onViewModeChange: (mode: ViewMode) => void;
    onNewFile: () => void;
    onOpenFile: () => void;
    onSaveFile: () => void;
    onSaveFileAs: () => void;
    onExportPdf: () => void;
    onShowTutorial: () => void;
    onToggleOutline: () => void;
    onToggleRecentFiles: () => void;
    recentFiles: RecentFile[];
    onOpenRecent: (path: string) => void;
    onShowSettings: () => void;
    onOpenFromDrive: () => void;
    onSaveToDrive: () => void;
    onToggleSearch: () => void;
    onToggleAI: () => void;
}

export function Toolbar({
    viewMode,
    outlineVisible,
    onViewModeChange,
    onNewFile,
    onOpenFile,
    onSaveFile,
    onSaveFileAs,
    onExportPdf,
    onShowTutorial,
    onToggleOutline,
    onToggleRecentFiles,
    recentFiles,
    onOpenRecent,
    onShowSettings,
    onOpenFromDrive,
    onSaveToDrive,
    onToggleSearch,
    onToggleAI,
    showRecent,
    aiPanelVisible,
    nativeMenu,
}: ToolbarProps) {
    const [fileMenuOpen, setFileMenuOpen] = useState(false);
    const [driveAvailable, setDriveAvailable] = useState(false);
    const [driveConnected, setDriveConnected] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const [viewMenuOpen, setViewMenuOpen] = useState(false);
    const viewMenuRef = useRef<HTMLDivElement>(null);
    const [recentMenuOpen, setRecentMenuOpen] = useState(false);
    const recentMenuRef = useRef<HTMLDivElement>(null);
    // 최근 파일별 마지막 편집(mtime) — 메뉴 열 때 fs.stat 으로 채움(실패 시 lastOpened 폴백).
    const [recentDates, setRecentDates] = useState<Record<string, number>>({});

    // Drive 가용성 (OAuth credentials 빌드 주입 + 연결 상태)
    useEffect(() => {
        if (!fileMenuOpen) return;
        let cancelled = false;
        (async () => {
            const configured = await gdriveService.isConfigured();
            if (cancelled) return;
            setDriveAvailable(configured);
            if (configured) {
                const email = await gdriveService.getStatus();
                if (!cancelled) setDriveConnected(!!email);
            }
        })();
        return () => { cancelled = true; };
    }, [fileMenuOpen]);

    // Close menu on outside click
    useEffect(() => {
        if (!fileMenuOpen) return;
        const handler = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setFileMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [fileMenuOpen]);

    // Close View menu on outside click
    useEffect(() => {
        if (!viewMenuOpen) return;
        const handler = (e: MouseEvent) => {
            if (viewMenuRef.current && !viewMenuRef.current.contains(e.target as Node)) {
                setViewMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [viewMenuOpen]);

    // Close Recent menu on outside click
    useEffect(() => {
        if (!recentMenuOpen) return;
        const handler = (e: MouseEvent) => {
            if (recentMenuRef.current && !recentMenuRef.current.contains(e.target as Node)) {
                setRecentMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [recentMenuOpen]);

    // 최근 파일 메뉴(File 서브메뉴 / History 드롭다운)가 열리면 각 파일 mtime 조회.
    useEffect(() => {
        if (!(fileMenuOpen || recentMenuOpen) || recentFiles.length === 0) return;
        let cancelled = false;
        (async () => {
            try {
                const { stat } = await import('@tauri-apps/plugin-fs');
                const entries = await Promise.all(recentFiles.map(async (f) => {
                    try {
                        const info = await stat(f.path);
                        return [f.path, info.mtime ? new Date(info.mtime).getTime() : f.lastOpened] as const;
                    } catch {
                        return [f.path, f.lastOpened] as const;
                    }
                }));
                if (!cancelled) setRecentDates(Object.fromEntries(entries));
            } catch {
                /* plugin 미가용 — 표시 시 lastOpened 폴백 */
            }
        })();
        return () => { cancelled = true; };
    }, [fileMenuOpen, recentMenuOpen, recentFiles]);

    const handleMenuItem = (action: () => void) => {
        action();
        setFileMenuOpen(false);
    };

    const handleViewSelect = (mode: ViewMode) => {
        onViewModeChange(mode);
        setViewMenuOpen(false);
    };

    // 현재 View — 가운데 인디케이터 트리거에 아이콘+이름 표시.
    const currentView = VIEW_MODES.find((v) => v.mode === viewMode);
    const CurrentViewIcon = currentView?.Icon;

    return (
        <div className="toolbar">
            {/* Left: File dropdown + Tutorial + Recent */}
            <div className="toolbar-group">
                {/* File·View 메뉴는 Tauri 에선 네이티브 메뉴바로 이동 → 숨김(웹은 유지) */}
                {!nativeMenu && (<>
                {/* File dropdown */}
                <div className="toolbar-dropdown" ref={menuRef}>
                    <button
                        className={`toolbar-text-btn${fileMenuOpen ? ' active' : ''}`}
                        onClick={() => setFileMenuOpen((v) => !v)}
                    >
                        <span>File</span>
                    </button>
                    {fileMenuOpen && (
                        <div className="toolbar-dropdown-menu">
                            <button className="dropdown-item" onClick={() => handleMenuItem(onNewFile)}>
                                <FilePlus size={14} strokeWidth={1.5} />
                                <span>New</span>
                                <span className="dropdown-shortcut">⌘N</span>
                            </button>
                            <button className="dropdown-item" onClick={() => handleMenuItem(onOpenFile)}>
                                <FolderOpen size={14} strokeWidth={1.5} />
                                <span>Open</span>
                                <span className="dropdown-shortcut">⌘O</span>
                            </button>
                            <button className="dropdown-item" onClick={() => handleMenuItem(onSaveFile)}>
                                <Save size={14} strokeWidth={1.5} />
                                <span>Save</span>
                                <span className="dropdown-shortcut">⌘S</span>
                            </button>
                            <button className="dropdown-item" onClick={() => handleMenuItem(onSaveFileAs)}>
                                <Download size={14} strokeWidth={1.5} />
                                <span>Save As…</span>
                                <span className="dropdown-shortcut">⌘⇧S</span>
                            </button>
                            <button className="dropdown-item" onClick={() => handleMenuItem(onExportPdf)}>
                                <FileDown size={14} strokeWidth={1.5} />
                                <span>Export as PDF…</span>
                                <span className="dropdown-shortcut">⌘P</span>
                            </button>
                            {driveAvailable && (
                                <>
                                    <div className="dropdown-divider" />
                                    <button
                                        className="dropdown-item"
                                        onClick={() => handleMenuItem(onOpenFromDrive)}
                                        disabled={!driveConnected}
                                        title={!driveConnected ? 'Settings 에서 Google Drive 연결 필요' : ''}
                                    >
                                        <img src="/googledrive.png" alt="" className="dropdown-icon-img" />
                                        <span>Open from Google Drive…</span>
                                    </button>
                                    <button
                                        className="dropdown-item"
                                        onClick={() => handleMenuItem(onSaveToDrive)}
                                        disabled={!driveConnected}
                                        title={!driveConnected ? 'Settings 에서 Google Drive 연결 필요' : ''}
                                    >
                                        <img src="/googledrive.png" alt="" className="dropdown-icon-img" />
                                        <span>Save to Google Drive…</span>
                                    </button>
                                </>
                            )}
                            {showRecent && (
                                <div className="dropdown-item dropdown-submenu-trigger">
                                    <Clock size={14} strokeWidth={1.5} />
                                    <span>Recent Files</span>
                                    <ChevronRight size={14} strokeWidth={1.5} className="dropdown-submenu-arrow" />
                                    <div className="dropdown-submenu">
                                        {recentFiles.length === 0 ? (
                                            <div className="dropdown-submenu-empty">최근 파일 없음</div>
                                        ) : (
                                            <>
                                                {recentFiles.slice(0, 5).map((f) => (
                                                    <button
                                                        key={f.path}
                                                        className="dropdown-item dropdown-submenu-item"
                                                        onClick={() => handleMenuItem(() => onOpenRecent(f.path))}
                                                        title={f.path}
                                                    >
                                                        <span className="dropdown-submenu-name">{f.name}</span>
                                                        <span className="dropdown-submenu-path">{formatRecentDate(recentDates[f.path] ?? f.lastOpened)}</span>
                                                    </button>
                                                ))}
                                                {recentFiles.length > 5 && (
                                                    <button
                                                        className="dropdown-item"
                                                        onClick={() => handleMenuItem(onToggleRecentFiles)}
                                                    >
                                                        <span>최근 파일 모두 보기…</span>
                                                    </button>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </div>
                            )}
                            <button className="dropdown-item" onClick={() => handleMenuItem(onShowTutorial)}>
                                <BookOpen size={14} strokeWidth={1.5} />
                                <span>Tutorial</span>
                            </button>
                            <button className="dropdown-item" onClick={() => handleMenuItem(onShowSettings)}>
                                <Settings size={14} strokeWidth={1.5} />
                                <span>Settings</span>
                            </button>
                        </div>
                    )}
                </div>

                <div className="toolbar-divider" />
                </>)}

                {/* 순서: Open Recent → Outline → Search → Settings */}
                {/* Open Recent — 드롭다운 메뉴(최근 파일 목록) */}
                {showRecent && (
                    <div className="toolbar-dropdown" ref={recentMenuRef}>
                        <button
                            className={`toolbar-btn${recentMenuOpen ? ' active' : ''}`}
                            onClick={() => setRecentMenuOpen((v) => !v)}
                            title="Open Recent"
                        >
                            <History size={16} strokeWidth={1.5} />
                        </button>
                        {recentMenuOpen && (
                            <div className="toolbar-dropdown-menu toolbar-recent-menu">
                                {recentFiles.length === 0 ? (
                                    <div className="dropdown-submenu-empty">최근 파일 없음</div>
                                ) : (
                                    <>
                                        {recentFiles.slice(0, 12).map((f) => (
                                            <button
                                                key={f.path}
                                                className="dropdown-item dropdown-recent-item"
                                                onClick={() => { setRecentMenuOpen(false); onOpenRecent(f.path); }}
                                                title={f.path}
                                            >
                                                <Clock size={14} strokeWidth={1.5} />
                                                <span className="dropdown-recent-text">
                                                    <span className="dropdown-submenu-name">{f.name}</span>
                                                    <span className="dropdown-submenu-path">{formatRecentDate(recentDates[f.path] ?? f.lastOpened)}</span>
                                                </span>
                                            </button>
                                        ))}
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                )}
                <button className={`toolbar-btn${outlineVisible ? ' active' : ''}`} onClick={onToggleOutline} title="Outline">
                    <BookMarked size={16} strokeWidth={1.5} />
                </button>
                <button className="toolbar-btn" onClick={onToggleSearch} title="Search (⌘F)">
                    <Search size={15} strokeWidth={1.5} />
                </button>

                {/* Settings — 설정 모달 열기 */}
                <button className="toolbar-btn" onClick={onShowSettings} title="Settings">
                    <Settings size={16} strokeWidth={1.5} />
                </button>
            </div>

            {/* 가운데: 현재 View 인디케이터 — 아이콘+이름 표시, 클릭하면 드롭다운으로 전환 */}
            <div className="toolbar-dropdown toolbar-view-indicator" ref={viewMenuRef}>
                <button
                    className={`toolbar-view-current${viewMenuOpen ? ' active' : ''}`}
                    onClick={() => setViewMenuOpen((v) => !v)}
                    title="현재 View — 클릭해 전환"
                >
                    {CurrentViewIcon && <CurrentViewIcon size={15} strokeWidth={1.6} />}
                    <span>{currentView?.label ?? 'View'}</span>
                    <ChevronDown size={13} strokeWidth={2} className="toolbar-view-caret" />
                </button>
                {viewMenuOpen && (
                    <div className="toolbar-dropdown-menu toolbar-view-menu">
                        {VIEW_MODES.map(({ mode, label, shortcut, Icon }) => (
                            <button
                                key={mode}
                                className={`dropdown-item${viewMode === mode ? ' active' : ''}`}
                                onClick={() => handleViewSelect(mode)}
                            >
                                <Icon size={14} strokeWidth={1.5} />
                                <span>{label}</span>
                                <span className="dropdown-shortcut">{shortcut}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Right: AI 에이전트 단일 진입점(#60 — 음성/이미지 인식·슬라이드 모두 패널 모드로 흡수) */}
            <div className="toolbar-group">
                <button className={`toolbar-text-btn ai-agent${aiPanelVisible ? ' active' : ''}`} onClick={onToggleAI} title="AI 에이전트 (⌘⇧I)">
                    <Sparkles size={14} strokeWidth={1.5} />
                    <span>AI 에이전트</span>
                </button>
            </div>
        </div>
    );
}
