/**
 * LAN 서버 모드 파일 브라우저 — 아이폰 브라우저 등에서 공유 폴더의 마크다운
 * 목록을 보고 탭해서 연다. 데스크탑 앱(Tauri)에서는 사용하지 않는다(네이티브
 * 파일 다이얼로그 사용). 선택 시 onSelect(상대경로)로 위임.
 */

import { useEffect, useState } from 'react';
import { FileText, X, RefreshCw } from 'lucide-react';
import { lanListFiles, type LanFile } from '../services/webFileSystem';

interface LanFileBrowserProps {
    visible: boolean;
    onClose: () => void;
    onSelect: (relPath: string) => void;
}

function formatTime(ms: number): string {
    if (!ms) return '';
    try {
        return new Date(ms).toLocaleString();
    } catch {
        return '';
    }
}

export function LanFileBrowser({ visible, onClose, onSelect }: LanFileBrowserProps) {
    const [files, setFiles] = useState<LanFile[]>([]);
    const [root, setRoot] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await lanListFiles();
            setRoot(res.root);
            setFiles(res.files);
        } catch (err) {
            setError(String(err));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (visible) load();
    }, [visible]);

    if (!visible) return null;

    return (
        <>
            <div className="settings-modal-backdrop" onClick={onClose} aria-hidden />
            <div className="settings-modal" role="dialog" aria-modal="true">
                <div className="settings-modal-header">
                    <span className="settings-modal-title">파일 열기</span>
                    <div style={{ display: 'flex', gap: 4 }}>
                        <button
                            className="modal-icon-btn"
                            onClick={load}
                            title="새로고침"
                            aria-label="새로고침"
                        >
                            <RefreshCw size={16} />
                        </button>
                        <button
                            className="modal-close"
                            onClick={onClose}
                            title="닫기"
                            aria-label="닫기"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>
                {root && (
                    <p className="settings-modal-note" style={{ wordBreak: 'break-all' }}>
                        {root}
                    </p>
                )}
                <div className="settings-modal-body">
                    {loading && <p className="convert-key-note">불러오는 중…</p>}
                    {error && <p className="drive-error">{error}</p>}
                    {!loading && !error && files.length === 0 && (
                        <p className="convert-key-note">이 폴더에 마크다운 파일이 없습니다.</p>
                    )}
                    {!loading && !error && files.length > 0 && (
                        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                            {files.map((f) => (
                                <li key={f.path}>
                                    <button
                                        onClick={() => onSelect(f.path)}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 10,
                                            width: '100%',
                                            padding: '12px 10px',
                                            border: 'none',
                                            borderBottom: '1px solid var(--border-color, #e5e5e5)',
                                            background: 'transparent',
                                            textAlign: 'left',
                                            cursor: 'pointer',
                                            font: 'inherit',
                                        }}
                                    >
                                        <FileText size={18} style={{ flexShrink: 0, opacity: 0.7 }} />
                                        <span style={{ flex: 1, minWidth: 0 }}>
                                            <span style={{ display: 'block', fontWeight: 600 }}>
                                                {f.name}
                                            </span>
                                            <span
                                                style={{
                                                    display: 'block',
                                                    fontSize: 12,
                                                    opacity: 0.6,
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                }}
                                            >
                                                {f.path.includes('/')
                                                    ? f.path.slice(0, f.path.lastIndexOf('/'))
                                                    : ''}
                                                {f.modified ? ` · ${formatTime(f.modified)}` : ''}
                                            </span>
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </>
    );
}
