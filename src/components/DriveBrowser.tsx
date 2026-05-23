/**
 * Google Drive 파일 브라우저 모달.
 * - "Open from Drive": Drive 파일 목록 → 선택 → 다운로드 → 새 윈도우/현재 에디터에서 열기
 * - "Save to Drive":  현재 에디터 본문 → 파일명 입력 → 새 Drive 파일 업로드
 *
 * 모드는 props.mode 로 분기.
 * iOS Safari Dialog 버그 회피를 위해 단순 portal 모달.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Cloud, FileText, RefreshCw, Upload, Download } from 'lucide-react';
import * as gdrive from '../services/gdriveService';
import type { DriveFile } from '../services/gdriveService';
import { confirmAction } from '../services/dialogService';

type Mode = 'open' | 'save';

interface DriveBrowserProps {
    visible: boolean;
    mode: Mode;
    onClose: () => void;
    /** Open 모드: 선택한 파일의 본문 + 메타 전달 */
    onOpen?: (file: DriveFile, content: string) => void;
    /** Save 모드: 업로드할 본문 + 기본 파일명 */
    saveContent?: string;
    defaultSaveName?: string;
    /** Save 완료 시 호출 (생성된 Drive 파일 메타 전달) */
    onSaved?: (file: DriveFile) => void;
}

export function DriveBrowser({
    visible,
    mode,
    onClose,
    onOpen,
    saveContent,
    defaultSaveName,
    onSaved,
}: DriveBrowserProps) {
    const [files, setFiles] = useState<DriveFile[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [saveName, setSaveName] = useState('');

    useEffect(() => {
        if (!visible) return;
        if (mode === 'save') {
            const name = defaultSaveName?.trim() || 'Untitled.md';
            setSaveName(name.endsWith('.md') ? name : `${name}.md`);
        }
        loadFiles();
    }, [visible, mode]);

    // body scroll lock + ESC
    useEffect(() => {
        if (!visible) return;
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        window.addEventListener('keydown', onKey);
        return () => {
            document.body.style.overflow = prev;
            window.removeEventListener('keydown', onKey);
        };
    }, [visible, onClose]);

    const loadFiles = async () => {
        setLoading(true);
        setError(null);
        try {
            // 모두 가져오기 — Rust 측에서 pageToken 자동 follow + 10000 안전 한도
            const list = await gdrive.listFiles();
            setFiles(list);
        } catch (err) {
            setError(String(err));
        } finally {
            setLoading(false);
        }
    };

    const handleOpen = async (file: DriveFile) => {
        if (!onOpen) return;
        setBusy(true);
        setError(null);
        try {
            const content = await gdrive.downloadFile(file.id, file.mimeType);
            onOpen(file, content);
            onClose();
        } catch (err) {
            setError(String(err));
        } finally {
            setBusy(false);
        }
    };

    const handleSave = async () => {
        if (mode !== 'save' || saveContent == null) return;
        const name = saveName.trim();
        if (!name) {
            setError('파일명을 입력해주세요.');
            return;
        }
        const finalName = name.endsWith('.md') ? name : `${name}.md`;
        setBusy(true);
        setError(null);
        try {
            // 같은 이름 파일이 여러 개면 (다른 폴더 등) 어느 것을 덮어쓸지
            // 안전하게 특정할 수 없음 → 새 파일로만 저장 (data-loss 방지).
            // 1개일 때만 사용자에게 덮어쓰기 옵션 제공.
            const matching = files.filter((f) => f.name === finalName);
            let file: DriveFile;
            if (matching.length === 1) {
                const existing = matching[0];
                const ok = await confirmAction(
                    `Drive 에 같은 이름의 파일 "${finalName}" 이 이미 있습니다.\n` +
                    `덮어쓰시겠습니까? (취소 시 같은 이름으로 새 파일이 생성됩니다)`,
                );
                file = ok
                    ? await gdrive.updateFile(existing.id, saveContent)
                    : await gdrive.uploadFile(finalName, saveContent);
            } else if (matching.length > 1) {
                const proceed = await confirmAction(
                    `Drive 에 "${finalName}" 이름의 파일이 ${matching.length}개 있습니다 (서로 다른 폴더 등).\n` +
                    `어느 파일을 덮어쓸지 안전하게 특정할 수 없어 새 파일로 저장됩니다. 진행할까요?`,
                );
                if (!proceed) {
                    setBusy(false);
                    return;
                }
                file = await gdrive.uploadFile(finalName, saveContent);
            } else {
                file = await gdrive.uploadFile(finalName, saveContent);
            }
            onSaved?.(file);
            onClose();
        } catch (err) {
            setError(String(err));
        } finally {
            setBusy(false);
        }
    };

    if (!visible) return null;

    return createPortal(
        <div className="drive-browser-root" role="dialog" aria-modal="true">
            <div className="drive-browser-backdrop" onClick={onClose} aria-hidden />
            <div className="drive-browser-modal">
                <div className="drive-browser-header">
                    <div className="drive-browser-title">
                        <Cloud size={16} />
                        <span>{mode === 'open' ? 'Open from Google Drive' : 'Save to Google Drive'}</span>
                    </div>
                    <button
                        className="drive-browser-close"
                        onClick={onClose}
                        aria-label="닫기"
                        title="닫기 (Esc)"
                    >
                        <X size={18} />
                    </button>
                </div>

                {mode === 'save' && (
                    <div className="drive-browser-saverow">
                        <input
                            type="text"
                            value={saveName}
                            onChange={(e) => setSaveName(e.target.value)}
                            placeholder="파일명.md"
                            disabled={busy}
                        />
                        <button
                            className="primary"
                            onClick={handleSave}
                            disabled={busy || !saveName.trim()}
                        >
                            <Upload size={14} />
                            <span>{busy ? '업로드 중...' : 'Drive 에 저장'}</span>
                        </button>
                    </div>
                )}

                <div className="drive-browser-toolbar">
                    <span className="drive-browser-count">
                        {loading ? '불러오는 중...' : `${files.length} 개 파일`}
                    </span>
                    <button onClick={loadFiles} disabled={loading} title="새로고침">
                        <RefreshCw size={14} className={loading ? 'spinning' : ''} />
                    </button>
                </div>

                {error && <div className="drive-browser-error">{error}</div>}

                <div className="drive-browser-list">
                    {files.length === 0 && !loading && !error ? (
                        <div className="drive-browser-empty">
                            {mode === 'open'
                                ? '아직 Drive 에 저장된 마크다운 파일이 없습니다.'
                                : '기존 파일이 없습니다. 새 파일로 저장됩니다.'}
                        </div>
                    ) : (
                        files.map((file) => (
                            <button
                                key={file.id}
                                className="drive-browser-item"
                                onClick={() => mode === 'open' && handleOpen(file)}
                                disabled={busy || mode === 'save'}
                                title={mode === 'open' ? '열기' : file.name}
                            >
                                <FileText size={14} className="drive-file-icon" />
                                <div className="drive-file-info">
                                    <span className="drive-file-name">{file.name}</span>
                                    <span className="drive-file-meta">
                                        {file.modifiedTime && formatDate(file.modifiedTime)}
                                        {file.size && ` · ${formatSize(file.size)}`}
                                    </span>
                                </div>
                                {mode === 'open' && <Download size={14} className="drive-file-arrow" />}
                            </button>
                        ))
                    )}
                </div>
            </div>
        </div>,
        document.body,
    );
}

function formatDate(iso: string): string {
    try {
        const d = new Date(iso);
        const now = new Date();
        const diff = (now.getTime() - d.getTime()) / 1000;
        if (diff < 60) return '방금 전';
        if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
        if (diff < 2592000) return `${Math.floor(diff / 86400)}일 전`;
        return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
        return iso;
    }
}

function formatSize(bytes: string): string {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return '';
    if (n < 1024) return `${n}B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
    return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}
