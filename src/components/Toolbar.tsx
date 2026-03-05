import { useState, useRef, useEffect } from 'react';
import {
    Eye, PenLine, Columns2, Sun, Moon, BookOpen,
    FilePlus, FolderOpen, Save, Download,
    ZoomIn, ZoomOut, List, Maximize, Clock,
    Search, ChevronDown, Sparkles
} from 'lucide-react';

export type ViewMode = 'split' | 'editor' | 'preview';

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
    onToggleSearch: () => void;
    onToggleAI: () => void;
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
    onToggleSearch,
    onToggleAI,
    showRecent,
    aiPanelVisible,
}: ToolbarProps) {
    const [fileMenuOpen, setFileMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

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
                        <span>File</span>
                        <ChevronDown size={12} strokeWidth={1.5} />
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
                            <div className="dropdown-divider" />
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
                        </div>
                    )}
                </div>

                <div className="toolbar-divider" />

                <button className="toolbar-text-btn" onClick={onShowTutorial} title="Show Tutorial">
                    <BookOpen size={14} strokeWidth={1.5} />
                    <span>Tutorial</span>
                </button>
                <button className={`toolbar-text-btn${aiPanelVisible ? ' active' : ''}`} onClick={onToggleAI} title="AI Assistant (⌘I)">
                    <Sparkles size={14} strokeWidth={1.5} />
                    <span>AI Mode</span>
                </button>
                {showRecent && (
                    <button className="toolbar-text-btn" onClick={onToggleRecentFiles} title="Recent Files">
                        <Clock size={14} strokeWidth={1.5} />
                        <span>Recent</span>
                    </button>
                )}
                <button className="toolbar-text-btn" onClick={onToggleSearch} title="Search (⌘F)">
                    <Search size={14} strokeWidth={1.5} />
                    <span>Search</span>
                </button>
            </div>

            {/* Center: File name */}
            <div className={`toolbar-filename${isDirty ? ' unsaved' : ''}`}>
                {fileName}
            </div>

            {/* Right: Font size + View mode + utilities */}
            <div className="toolbar-group">
                {/* Font size controls */}
                <button className="toolbar-btn" onClick={() => onFontSizeChange(-1)} title="Zoom Out (⌘-)" disabled={viewMode === 'editor'}>
                    <ZoomOut size={15} strokeWidth={1.5} />
                </button>
                <button className="toolbar-btn toolbar-font-reset" onClick={onFontSizeReset} title="Reset (⌘0)" disabled={viewMode === 'editor'}>
                    <span className="toolbar-font-size">{fontSize}</span>
                </button>
                <button className="toolbar-btn" onClick={() => onFontSizeChange(1)} title="Zoom In (⌘+)" disabled={viewMode === 'editor'}>
                    <ZoomIn size={15} strokeWidth={1.5} />
                </button>

                <div className="toolbar-divider" />

                {/* Reading mode + Outline */}
                <button className="toolbar-btn" onClick={onToggleReadingMode} title="Reading Mode">
                    <Maximize size={16} strokeWidth={1.5} />
                </button>
                <button className={`toolbar-btn${outlineVisible ? ' active' : ''}`} onClick={onToggleOutline} title="Outline">
                    <List size={16} strokeWidth={1.5} />
                </button>

                <div className="toolbar-divider" />

                {/* View modes */}
                <button
                    className={`toolbar-btn${viewMode === 'preview' ? ' active' : ''}`}
                    onClick={() => onViewModeChange('preview')}
                    title="Preview (⌘3)"
                >
                    <Eye size={16} strokeWidth={1.5} />
                </button>
                <button
                    className={`toolbar-btn${viewMode === 'editor' ? ' active' : ''}`}
                    onClick={() => onViewModeChange('editor')}
                    title="Editor (⌘1)"
                >
                    <PenLine size={16} strokeWidth={1.5} />
                </button>
                <button
                    className={`toolbar-btn${viewMode === 'split' ? ' active' : ''}`}
                    onClick={() => onViewModeChange('split')}
                    title="Split View (⌘2)"
                >
                    <Columns2 size={16} strokeWidth={1.5} />
                </button>

                <div className="toolbar-divider" />

                <button className="toolbar-btn" onClick={onThemeToggle} title="Toggle Theme">
                    {theme === 'dark' ? <Sun size={16} strokeWidth={1.5} /> : <Moon size={16} strokeWidth={1.5} />}
                </button>
            </div>
        </div>
    );
}
