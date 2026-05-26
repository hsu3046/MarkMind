import { useState, useRef, useEffect } from 'react';
import {
    Columns2, Sun, Moon, BookOpen,
    FilePlus, FolderOpen, Save, Download,
    ZoomIn, ZoomOut, List, Maximize, Clock,
    Search, ChevronRight, Sparkles, Check, X,
    Mic, ScanText, Settings, Menu as MenuIcon,
    FileCode, FileText,
} from 'lucide-react';
import * as gdriveService from '../services/gdriveService';
import type { RecentFile } from '../hooks/useRecentFiles';

export type ViewMode = 'split' | 'editor' | 'preview';

function EditableFileName({ fileName, isDirty, onRename }: { fileName: string; isDirty: boolean; onRename: (name: string) => void }) {
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
    fileName: string;
    isDirty: boolean;
    viewMode: ViewMode;
    theme: 'light' | 'dark';
    fontSize: number;
    outlineVisible: boolean;
    showRecent: boolean;
    aiPanelVisible: boolean;
    onViewModeChange: (mode: ViewMode) => void;
    onThemeToggle: () => void;
    onNewFile: () => void;
    onOpenFile: () => void;
    onSaveFile: () => void;
    onSaveFileAs: () => void;
    onShowTutorial: () => void;
    onFontSizeChange: (delta: number) => void;
    onFontSizeReset: () => void;
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
    onToggleAudio: () => void;
    onToggleOcr: () => void;
    audioPanelVisible: boolean;
    ocrPanelVisible: boolean;
    onRename: (newName: string) => void;
}

export function Toolbar({
    fileName,
    isDirty,
    viewMode,
    theme,
    fontSize,
    outlineVisible,
    onViewModeChange,
    onThemeToggle,
    onNewFile,
    onOpenFile,
    onSaveFile,
    onSaveFileAs,
    onShowTutorial,
    onFontSizeChange,
    onFontSizeReset,
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
    onToggleAudio,
    onToggleOcr,
    audioPanelVisible,
    ocrPanelVisible,
    onRename,
    showRecent,
    aiPanelVisible,
}: ToolbarProps) {
    const [fileMenuOpen, setFileMenuOpen] = useState(false);
    const [driveAvailable, setDriveAvailable] = useState(false);
    const [driveConnected, setDriveConnected] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

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

    const handleMenuItem = (action: () => void) => {
        action();
        setFileMenuOpen(false);
    };

    return (
        <div className="toolbar">
            {/* Left: File dropdown + Tutorial + Recent */}
            <div className="toolbar-group">
                {/* File dropdown */}
                <div className="toolbar-dropdown" ref={menuRef}>
                    <button
                        className={`toolbar-text-btn${fileMenuOpen ? ' active' : ''}`}
                        onClick={() => setFileMenuOpen((v) => !v)}
                    >
                        <MenuIcon size={14} strokeWidth={1.5} />
                        <span>Menu</span>
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
                                                {recentFiles.slice(0, 10).map((f) => (
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

                {/* Search + Outline (순서 교체) */}
                <button className="toolbar-btn" onClick={onToggleSearch} title="Search (⌘F)">
                    <Search size={15} strokeWidth={1.5} />
                </button>
                <button className={`toolbar-btn${outlineVisible ? ' active' : ''}`} onClick={onToggleOutline} title="Outline">
                    <List size={16} strokeWidth={1.5} />
                </button>

                <div className="toolbar-divider" />

                {/* View modes — Markdown / Rich Text / Split */}
                <button
                    className={`toolbar-btn${viewMode === 'editor' ? ' active' : ''}`}
                    onClick={() => onViewModeChange('editor')}
                    title="Markdown (⌘1)"
                >
                    <FileCode size={16} strokeWidth={1.5} />
                </button>
                <button
                    className={`toolbar-btn${viewMode === 'preview' ? ' active' : ''}`}
                    onClick={() => onViewModeChange('preview')}
                    title="Rich Text (⌘3)"
                >
                    <FileText size={16} strokeWidth={1.5} />
                </button>
                <button
                    className={`toolbar-btn${viewMode === 'split' ? ' active' : ''}`}
                    onClick={() => onViewModeChange('split')}
                    title="Split View (⌘2)"
                >
                    <Columns2 size={16} strokeWidth={1.5} />
                </button>

                <div className="toolbar-divider" />

                {/* Font size controls (압축 그룹 — 간격 좁힘) */}
                <div className="toolbar-fontsize-group">
                    <button className="toolbar-btn" onClick={() => onFontSizeChange(-1)} title="Zoom Out (⌘-)" disabled={viewMode === 'editor'}>
                        <ZoomOut size={15} strokeWidth={1.5} />
                    </button>
                    <button className="toolbar-btn toolbar-font-reset" onClick={onFontSizeReset} title="Reset (⌘0)" disabled={viewMode === 'editor'}>
                        <span className="toolbar-font-size">{fontSize}</span>
                    </button>
                    <button className="toolbar-btn" onClick={() => onFontSizeChange(1)} title="Zoom In (⌘+)" disabled={viewMode === 'editor'}>
                        <ZoomIn size={15} strokeWidth={1.5} />
                    </button>
                </div>

                <div className="toolbar-divider" />

                {/* Theme + Reading mode (순서 교체) */}
                <button className="toolbar-btn" onClick={onThemeToggle} title="Toggle Theme">
                    {theme === 'dark' ? <Sun size={16} strokeWidth={1.5} /> : <Moon size={16} strokeWidth={1.5} />}
                </button>
                <button className="toolbar-btn" onClick={onToggleReadingMode} title="Reading Mode">
                    <Maximize size={16} strokeWidth={1.5} />
                </button>
            </div>

            {/* Center: File name (editable) */}
            <EditableFileName
                fileName={fileName}
                isDirty={isDirty}
                onRename={onRename}
            />

            {/* Right: AI/Convert panels + Login */}
            <div className="toolbar-group">
                <button className={`toolbar-text-btn ai-agent${audioPanelVisible ? ' active' : ''}`} onClick={onToggleAudio} title="음성 → 텍스트 변환 (STT)">
                    <Mic size={14} strokeWidth={1.5} />
                    <span>음성 인식</span>
                </button>
                <button className={`toolbar-text-btn ai-agent${ocrPanelVisible ? ' active' : ''}`} onClick={onToggleOcr} title="이미지 → 텍스트 변환 (OCR)">
                    <ScanText size={14} strokeWidth={1.5} />
                    <span>이미지 인식</span>
                </button>
                <button className={`toolbar-text-btn ai-agent${aiPanelVisible ? ' active' : ''}`} onClick={onToggleAI} title="AI 에이전트 (⌘I)">
                    <Sparkles size={14} strokeWidth={1.5} />
                    <span>AI 에이전트</span>
                </button>
            </div>
        </div>
    );
}
