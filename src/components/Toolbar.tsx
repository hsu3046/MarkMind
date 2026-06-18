import { useState, useRef, useEffect } from 'react';
import {
    Columns2, BookOpen,
    FilePlus, FolderOpen, Save, Download, FileDown,
    CirclePlus, CircleMinus, BookMarked, Maximize, Clock,
    Search, ChevronRight, Sparkles, Check, X,
    Settings,
    FileCode, FileText, AlignVerticalSpaceAround,
    Network, Share2, ChartBarStacked, type LucideIcon,
} from 'lucide-react';
import * as gdriveService from '../services/gdriveService';
import type { RecentFile } from '../hooks/useRecentFiles';
import { BackgroundPicker } from './BackgroundPicker';

export type ViewMode = 'split' | 'editor' | 'preview' | 'mindmap' | 'flowchart' | 'gantt';

/** View 메뉴 항목 — 라벨/단축키/아이콘. 사용자가 보는 순서(편집→읽기→분할→…). */
const VIEW_MODES: { mode: ViewMode; label: string; shortcut: string; Icon: LucideIcon }[] = [
    { mode: 'editor', label: 'Markdown', shortcut: '⌘1', Icon: FileCode },
    { mode: 'preview', label: 'Rich Text', shortcut: '⌘3', Icon: FileText },
    { mode: 'split', label: 'Split View', shortcut: '⌘2', Icon: Columns2 },
    { mode: 'mindmap', label: 'Mindmap', shortcut: '⌘4', Icon: Share2 },
    { mode: 'flowchart', label: 'Flowchart', shortcut: '⌘5', Icon: Network },
    { mode: 'gantt', label: 'Gantt', shortcut: '⌘6', Icon: ChartBarStacked },
];

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
    fontSize: number;
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
    onFontSizeChange: (delta: number) => void;
    onFontSizeReset: () => void;
    lineHeight: 'compact' | 'normal' | 'relaxed';
    onCycleLineHeight: () => void;
    bgColor: string;
    onBgColorChange: (color: string) => void;
    onToggleOutline: () => void;
    onToggleReadingMode: () => void;
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
    fontSize,
    outlineVisible,
    onViewModeChange,
    onNewFile,
    onOpenFile,
    onSaveFile,
    onSaveFileAs,
    onExportPdf,
    onShowTutorial,
    onFontSizeChange,
    onFontSizeReset,
    lineHeight,
    onCycleLineHeight,
    bgColor,
    onBgColorChange,
    onToggleOutline,
    onToggleReadingMode,
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

    const handleMenuItem = (action: () => void) => {
        action();
        setFileMenuOpen(false);
    };

    const handleViewSelect = (mode: ViewMode) => {
        onViewModeChange(mode);
        setViewMenuOpen(false);
    };

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
                                        <span>Open from Drive…</span>
                                    </button>
                                    <button
                                        className="dropdown-item"
                                        onClick={() => handleMenuItem(onSaveToDrive)}
                                        disabled={!driveConnected}
                                        title={!driveConnected ? 'Settings 에서 Google Drive 연결 필요' : ''}
                                    >
                                        <img src="/googledrive.png" alt="" className="dropdown-icon-img" />
                                        <span>Save to Drive…</span>
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
                                                        <span className="dropdown-submenu-path">{f.path}</span>
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

                {/* View dropdown — 모든 뷰모드를 한 메뉴로 묶어 툴바 공간 확보 */}
                <div className="toolbar-dropdown" ref={viewMenuRef}>
                    <button
                        className={`toolbar-text-btn${viewMenuOpen ? ' active' : ''}`}
                        onClick={() => setViewMenuOpen((v) => !v)}
                    >
                        <span>View</span>
                    </button>
                    {viewMenuOpen && (
                        <div className="toolbar-dropdown-menu">
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

                <div className="toolbar-divider" />
                </>)}

                {/* Outline + Search */}
                <button className={`toolbar-btn${outlineVisible ? ' active' : ''}`} onClick={onToggleOutline} title="Outline">
                    <BookMarked size={16} strokeWidth={1.5} />
                </button>
                <button className="toolbar-btn" onClick={onToggleSearch} title="Search (⌘F)">
                    <Search size={15} strokeWidth={1.5} />
                </button>

                <div className="toolbar-divider" />

                {/* Font size controls (압축 그룹 — 간격 좁힘) */}
                <div className="toolbar-fontsize-group">
                    <button className="toolbar-btn" onClick={() => onFontSizeChange(-1)} title="Zoom Out (⌘-)" disabled={viewMode === 'editor'}>
                        <CircleMinus size={15} strokeWidth={1.5} />
                    </button>
                    <button className="toolbar-btn toolbar-font-reset" onClick={onFontSizeReset} title="Reset (⌘0)" disabled={viewMode === 'editor'}>
                        <span className="toolbar-font-size">{fontSize}</span>
                    </button>
                    <button className="toolbar-btn" onClick={() => onFontSizeChange(1)} title="Zoom In (⌘+)" disabled={viewMode === 'editor'}>
                        <CirclePlus size={15} strokeWidth={1.5} />
                    </button>
                </div>

                <div className="toolbar-divider" />

                {/* 행간 토글 + 배경색 picker (Theme 토글은 배경색에 자동 동기화되므로 제거) */}
                <button
                    className="toolbar-btn toolbar-lineheight-btn"
                    onClick={onCycleLineHeight}
                    title={`행간 ${lineHeight === 'compact' ? '1.5 (좁게)' : lineHeight === 'normal' ? '1.8 (보통)' : '2.2 (넓게)'} — 클릭으로 변경`}
                >
                    <AlignVerticalSpaceAround size={15} strokeWidth={1.5} />
                    <span className="toolbar-lineheight-value">
                        {lineHeight === 'compact' ? '1.5' : lineHeight === 'normal' ? '1.8' : '2.2'}
                    </span>
                </button>
                <BackgroundPicker value={bgColor} onChange={onBgColorChange} />

                <div className="toolbar-divider" />

                {/* Full (Reading mode) */}
                <button className="toolbar-btn" onClick={onToggleReadingMode} title="Full / Reading Mode">
                    <Maximize size={16} strokeWidth={1.5} />
                </button>
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
