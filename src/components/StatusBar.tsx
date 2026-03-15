interface StatusBarProps {
    content: string;
    filePath: string | null;
    fontSize?: number;
}

export function StatusBar({ content, filePath, fontSize }: StatusBarProps) {
    const lines = content.split('\n').length;
    const words = content.trim() ? content.trim().split(/\s+/).length : 0;
    const chars = content.length;

    return (
        <div className="statusbar">
            <div className="statusbar-group">
                <span className="statusbar-item">{lines} lines</span>
                <span className="statusbar-item">{words} words</span>
                <span className="statusbar-item">{chars} chars</span>
                {fontSize && (
                    <span className="statusbar-item">{fontSize}px</span>
                )}
            </div>
            <div className="statusbar-group">
                <span className="statusbar-item">
                    {filePath || 'Not saved'}
                </span>
                <span className="statusbar-item statusbar-version">v{__APP_VERSION__}</span>
            </div>
        </div>
    );
}
