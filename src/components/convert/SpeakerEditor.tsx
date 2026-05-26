/**
 * 화자 라벨 일괄 변경 / 삭제 모달.
 * STT 결과 (timestamped + clean) 두 파일의 모든 `[HH:MM:SS] 화자A:` 라벨을 추출 →
 * 사용자가 각각 새 이름 입력하거나 삭제 표시 → 적용 시 두 파일 모두 동시 갱신.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Trash2, Check, Users } from 'lucide-react';

interface SpeakerEditorProps {
    visible: boolean;
    onClose: () => void;
    /** 일괄 처리 대상 .md 경로 (보통 timestamped + clean 두 개) */
    paths: string[];
    onApplied?: () => void;
}

interface Row {
    original: string;
    newName: string; // 사용자 입력 (빈 값이면 변경 없음)
    deleted: boolean;
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<T>(cmd, args);
}

export function SpeakerEditor({ visible, onClose, paths, onApplied }: SpeakerEditorProps) {
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [rows, setRows] = useState<Row[]>([]);

    useEffect(() => {
        if (!visible) return;
        setError(null);
        setLoading(true);
        (async () => {
            try {
                const speakers = await tauriInvoke<string[]>('extract_speakers', { paths });
                setRows(
                    speakers.map((s) => ({
                        original: s,
                        newName: '',
                        deleted: false,
                    })),
                );
            } catch (err) {
                setError(String(err));
            } finally {
                setLoading(false);
            }
        })();
    }, [visible, paths]);

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

    const updateRow = (i: number, patch: Partial<Row>) =>
        setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

    const handleApply = async () => {
        const mappings: [string, string][] = rows
            .filter((r) => r.deleted || (r.newName.trim() && r.newName.trim() !== r.original))
            .map((r) => [r.original, r.deleted ? '' : r.newName.trim()]);
        if (mappings.length === 0) {
            onClose();
            return;
        }
        setBusy(true);
        setError(null);
        try {
            await tauriInvoke<void>('rename_speakers', { paths, mappings });
            onApplied?.();
            onClose();
        } catch (err) {
            setError(String(err));
        } finally {
            setBusy(false);
        }
    };

    if (!visible) return null;

    return createPortal(
        <div className="speaker-editor-root" role="dialog" aria-modal="true">
            <div className="speaker-editor-backdrop" onClick={onClose} aria-hidden />
            <div className="speaker-editor-modal">
                <div className="speaker-editor-header">
                    <div className="speaker-editor-title">
                        <Users size={16} />
                        <span>화자 라벨 정리</span>
                    </div>
                    <button
                        className="speaker-editor-close"
                        onClick={onClose}
                        aria-label="닫기"
                        title="닫기 (Esc)"
                    >
                        <X size={18} />
                    </button>
                </div>

                <p className="speaker-editor-desc">
                    이름을 비워두면 변경 없음. 휴지통 누르면 해당 화자의 모든 발화가 삭제됩니다.
                </p>

                {loading && <div className="speaker-editor-empty">불러오는 중…</div>}

                {!loading && rows.length === 0 && (
                    <div className="speaker-editor-empty">감지된 화자 라벨이 없습니다.</div>
                )}

                {!loading && rows.length > 0 && (
                    <ul className="speaker-editor-list">
                        {rows.map((row, i) => (
                            <li
                                key={`${row.original}-${i}`}
                                className={`speaker-editor-row${row.deleted ? ' deleted' : ''}`}
                            >
                                <span className="speaker-original">{row.original}</span>
                                <span className="speaker-arrow">→</span>
                                <input
                                    type="text"
                                    placeholder={row.deleted ? '(삭제됨)' : row.original}
                                    value={row.newName}
                                    onChange={(e) => updateRow(i, { newName: e.target.value })}
                                    disabled={busy || row.deleted}
                                />
                                <button
                                    type="button"
                                    className={`speaker-delete-btn${row.deleted ? ' active' : ''}`}
                                    onClick={() => updateRow(i, { deleted: !row.deleted })}
                                    title={row.deleted ? '삭제 취소' : '이 화자 발화 모두 삭제'}
                                    disabled={busy}
                                >
                                    <Trash2 size={14} />
                                </button>
                            </li>
                        ))}
                    </ul>
                )}

                {error && <div className="speaker-editor-error">{error}</div>}

                <div className="speaker-editor-actions">
                    <button onClick={onClose} disabled={busy}>
                        취소
                    </button>
                    <button
                        className="primary"
                        onClick={handleApply}
                        disabled={busy || loading}
                    >
                        <Check size={14} /> <span>{busy ? '적용 중…' : '적용'}</span>
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
}
