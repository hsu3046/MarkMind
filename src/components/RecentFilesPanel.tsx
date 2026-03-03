import { readTextFile } from '@tauri-apps/plugin-fs';
import { Clock, X, Trash2 } from 'lucide-react';

interface RecentFile {
    path: string;
    name: string;
    lastOpened: number;
}

interface RecentFilesPanelProps {
    files: RecentFile[];
    visible: boolean;
    onOpenRecent: (path: string, content: string, name: string) => void;
    onRemove: (path: string) => void;
    onClear: () => void;
    onClose: () => void;
}

export function RecentFilesPanel({
    files,
    visible,
    onOpenRecent,
    onRemove,
    onClear,
    onClose,
}: RecentFilesPanelProps) {
    if (!visible) return null;

    const handleOpen = async (file: RecentFile) => {
        try {
            const content = await readTextFile(file.path);
            onOpenRecent(file.path, content, file.name);
        } catch {
            // File no longer exists or can't be read
            onRemove(file.path);
        }
    };

    const formatTime = (ts: number) => {
        const diff = Date.now() - ts;
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'Just now';
        if (mins < 60) return `${mins}m ago`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        return `${days}d ago`;
    };

    const shortenPath = (path: string) => {
        return path.replace(/^\/Users\/[^/]+/, '~');
    };

    return (
        <div className="recent-panel-backdrop" onClick={onClose}>
            <div className="recent-panel" onClick={(e) => e.stopPropagation()}>
                <div className="recent-header">
                    <div className="recent-title">
                        <Clock size={14} strokeWidth={1.5} />
                        <span>Recent Files</span>
                    </div>
                    <div className="recent-header-actions">
                        {files.length > 0 && (
                            <button className="recent-clear-btn" onClick={onClear} title="Clear all">
                                <Trash2 size={12} strokeWidth={1.5} />
                            </button>
                        )}
                        <button className="recent-close-btn" onClick={onClose}>
                            <X size={14} strokeWidth={1.5} />
                        </button>
                    </div>
                </div>

                <div className="recent-list">
                    {files.length === 0 ? (
                        <div className="recent-empty">No recent files</div>
                    ) : (
                        files.map((file) => (
                            <button
                                key={file.path}
                                className="recent-item"
                                onClick={() => handleOpen(file)}
                                title={file.path}
                            >
                                <div className="recent-item-info">
                                    <span className="recent-item-name">{file.name}</span>
                                    <span className="recent-item-path">{shortenPath(file.path)}</span>
                                </div>
                                <span className="recent-item-time">{formatTime(file.lastOpened)}</span>
                            </button>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
