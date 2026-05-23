/**
 * 음성 → 텍스트 변환 탭.
 * 입력: 오디오 파일 (MP3/WAV/M4A 등 ≤ 1GB / 4시간)
 * 출력: 타임스탬프 / 클린 2개 .md
 */

import { useEffect, useState } from 'react';
import { Upload, Play, RotateCcw } from 'lucide-react';
import { AudioJobResult } from '../../types/converter';
import { useConverter } from '../../hooks/useConverter';
import { ProgressPanel } from './ProgressPanel';
import { ResultCard } from './ResultCard';
import { pickAudioFile } from './pickFile';
import type { DroppedFile } from './types';

interface AudioTabProps {
    converter: ReturnType<typeof useConverter>;
    droppedFile?: DroppedFile | null;
    onConsumeDropped?: () => void;
    onOpenResult?: (path: string) => void;
}

export function AudioTab({ converter, droppedFile, onConsumeDropped, onOpenResult }: AudioTabProps) {
    const [filePath, setFilePath] = useState<string | null>(null);
    const [fileName, setFileName] = useState<string>('');
    const [trimSilence, setTrimSilence] = useState(true);
    const [result, setResult] = useState<AudioJobResult | null>(null);

    // OS-level drag&drop 으로 들어온 파일 자동 채택
    useEffect(() => {
        if (!droppedFile) return;
        setFilePath(droppedFile.path);
        setFileName(droppedFile.name);
        setResult(null);
        converter.resetJob();
        onConsumeDropped?.();
    }, [droppedFile]);

    const handlePick = async () => {
        const picked = await pickAudioFile();
        if (picked) {
            setFilePath(picked.path);
            setFileName(picked.name);
            setResult(null);
            converter.resetJob();
        }
    };

    const handleRun = async () => {
        if (!filePath) return;
        // 큰 파일 메모리 경고 — 단계별 임계 (200MB warn / 500MB strong / 1GB hard)
        try {
            const { stat } = await import('@tauri-apps/plugin-fs');
            const { ask } = await import('@tauri-apps/plugin-dialog');
            const meta = await stat(filePath);
            const sizeMB = Number(meta.size) / (1024 * 1024);
            if (sizeMB > 1024) {
                await ask(
                    `파일이 ${sizeMB.toFixed(0)}MB 입니다.\n` +
                    `1GB 초과 파일은 메모리 부족으로 실패할 가능성이 높습니다.\n` +
                    `먼저 파일을 분할하거나 짧게 잘라보세요.`,
                    { title: 'MarkMind — 파일 크기 경고', kind: 'warning' },
                );
                return;
            }
            if (sizeMB > 500) {
                const ok = await ask(
                    `파일이 ${sizeMB.toFixed(0)}MB 입니다.\n` +
                    `처리 중 메모리 사용량이 매우 높습니다 (~${(sizeMB * 3).toFixed(0)}MB 추정).\n` +
                    `다른 앱을 종료하거나 진행하시겠어요?`,
                    { title: 'MarkMind — 메모리 사용량 큼', kind: 'warning' },
                );
                if (!ok) return;
            } else if (sizeMB > 200) {
                const ok = await ask(
                    `파일이 ${sizeMB.toFixed(0)}MB 입니다.\n` +
                    `Gemini File API 업로드 + 청크 처리에 시간이 걸립니다 (~수분).\n` +
                    `계속하시겠어요?`,
                    { title: 'MarkMind', kind: 'info' },
                );
                if (!ok) return;
            }
        } catch {
            // stat/dialog 실패는 무시 (계속 진행)
        }
        setResult(null);
        const r = await converter.runAudio({
            file_path: filePath,
            originalName: fileName,
            trimSilence,
        });
        if (r) setResult(r);
    };

    const handleReset = () => {
        setFilePath(null);
        setFileName('');
        setResult(null);
        converter.resetJob();
    };

    return (
        <div className="convert-tab-content">
            <div
                className={`convert-dropzone${filePath ? ' has-file' : ''}`}
                onClick={handlePick}
            >
                <Upload size={28} />
                {filePath ? (
                    <>
                        <div className="convert-dropzone-file">{fileName}</div>
                        <div className="convert-dropzone-hint">다른 파일 선택...</div>
                    </>
                ) : (
                    <>
                        <div className="convert-dropzone-title">오디오 파일 선택</div>
                        <div className="convert-dropzone-hint">
                            MP3 · WAV · M4A · AAC · OGG · FLAC · 최대 4시간
                        </div>
                    </>
                )}
            </div>

            <div className="convert-options">
                <label className="convert-option">
                    <input
                        type="checkbox"
                        checked={trimSilence}
                        onChange={(e) => setTrimSilence(e.target.checked)}
                    />
                    <span>대화 없는 구간 자동 삭제</span>
                </label>
            </div>

            <div className="convert-actions">
                <button
                    className="convert-btn primary"
                    onClick={handleRun}
                    disabled={!filePath || converter.jobState.phase === 'running'}
                >
                    <Play size={14} /> 변환 시작
                </button>
                {(result || converter.jobState.phase === 'error') && (
                    <button className="convert-btn" onClick={handleReset}>
                        <RotateCcw size={14} /> 새 파일
                    </button>
                )}
            </div>

            {result && (
                <ResultCard
                    title={`변환 완료 — ${fileName}`}
                    paths={[
                        { label: '타임스탬프 포함', path: result.timestampedPath },
                        { label: '타임스탬프 제거', path: result.cleanPath },
                    ]}
                    cost={result.cost}
                    onOpen={onOpenResult ?? converter.openEditorWindow}
                />
            )}

            <ProgressPanel state={converter.jobState} />
        </div>
    );
}
