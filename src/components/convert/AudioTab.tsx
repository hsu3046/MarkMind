/**
 * 음성 → 텍스트 변환 탭.
 * 입력: 오디오 파일 1개 또는 여러 개 (순차 처리 후 합치기)
 * 출력: 타임스탬프 / 클린 2개 .md (단일) 또는 결합본 1개 + 개별 결과들 (다중)
 */

import { useEffect, useState } from 'react';
import { Upload, Play, RotateCcw, Users, Plus, X, ArrowUp, ArrowDown } from 'lucide-react';
import { AudioJobResult } from '../../types/converter';
import { useConverter } from '../../hooks/useConverter';
import { ProgressPanel } from './ProgressPanel';
import { ResultCard } from './ResultCard';
import { SpeakerEditor } from './SpeakerEditor';
import { pickAudioFile, pickAudioFilesMulti, type PickedFile } from './pickFile';
import type { DroppedFile } from './types';

interface AudioTabProps {
    converter: ReturnType<typeof useConverter>;
    droppedFile?: DroppedFile | null;
    onConsumeDropped?: () => void;
    onOpenResult?: (path: string) => void;
}

interface MergedResult {
    /** 합본 timestamped (단일 파일이면 result.timestampedPath, 다중이면 merged) */
    timestampedPath: string;
    cleanPath: string;
    isMulti: boolean;
    /** 다중일 때 개별 결과 path 목록 (참조용) */
    individualPaths?: { timestamped: string; clean: string; name: string }[];
}

async function invokeRaw<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<T>(cmd, args);
}

export function AudioTab({ converter, droppedFile, onConsumeDropped, onOpenResult }: AudioTabProps) {
    // 파일명순 자동 정렬을 위한 sort 헬퍼
    const sortByName = (arr: PickedFile[]) =>
        [...arr].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    const [files, setFiles] = useState<PickedFile[]>([]);
    const [trimSilence, setTrimSilence] = useState(true);
    const [result, setResult] = useState<MergedResult | null>(null);
    const [resultName, setResultName] = useState<string>('');
    const [speakerEditorOpen, setSpeakerEditorOpen] = useState(false);
    const [resultRev, setResultRev] = useState(0);
    const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
    const [batchError, setBatchError] = useState<string | null>(null);

    useEffect(() => {
        if (!droppedFile) return;
        // OS drag&drop — 기존 파일 목록에 append (사용자가 여러 번 끌어 추가 가능)
        setFiles((prev) => sortByName([...prev, { path: droppedFile.path, name: droppedFile.name }]));
        setResult(null);
        setBatchError(null);
        converter.resetJob();
        onConsumeDropped?.();
    }, [droppedFile]);

    const handlePickSingle = async () => {
        const picked = await pickAudioFile();
        if (picked) {
            setFiles((prev) => sortByName([...prev, picked]));
            setResult(null);
            setBatchError(null);
            converter.resetJob();
        }
    };

    const handlePickMulti = async () => {
        const picked = await pickAudioFilesMulti();
        if (picked.length > 0) {
            setFiles((prev) => sortByName([...prev, ...picked]));
            setResult(null);
            setBatchError(null);
            converter.resetJob();
        }
    };

    const removeAt = (i: number) => setFiles((prev) => prev.filter((_, idx) => idx !== i));
    const moveUp = (i: number) => {
        if (i === 0) return;
        setFiles((prev) => {
            const next = [...prev];
            [next[i - 1], next[i]] = [next[i], next[i - 1]];
            return next;
        });
    };
    const moveDown = (i: number) => {
        setFiles((prev) => {
            if (i >= prev.length - 1) return prev;
            const next = [...prev];
            [next[i + 1], next[i]] = [next[i], next[i + 1]];
            return next;
        });
    };

    const handleReset = () => {
        setFiles([]);
        setResult(null);
        setResultName('');
        setBatchError(null);
        setBatchProgress(null);
        converter.resetJob();
    };

    const handleRun = async () => {
        if (files.length === 0) return;
        // 큰 파일 사전 경고 (각 파일별)
        try {
            const { stat } = await import('@tauri-apps/plugin-fs');
            const { ask } = await import('@tauri-apps/plugin-dialog');
            let totalMB = 0;
            for (const f of files) {
                const meta = await stat(f.path);
                totalMB += Number(meta.size) / (1024 * 1024);
            }
            if (totalMB > 1024) {
                await ask(
                    `총 ${totalMB.toFixed(0)}MB 입니다.\n` +
                    `1GB 초과는 메모리 부족 위험이 큽니다. 파일을 줄이거나 분할하세요.`,
                    { title: 'MarkMind — 파일 크기 경고', kind: 'warning' },
                );
                return;
            }
            if (totalMB > 500) {
                const ok = await ask(
                    `총 ${totalMB.toFixed(0)}MB 입니다. 처리 메모리 사용량이 큽니다.\n계속하시겠어요?`,
                    { title: 'MarkMind', kind: 'warning' },
                );
                if (!ok) return;
            }
        } catch {
            // stat 실패는 무시
        }

        setResult(null);
        setBatchError(null);
        setBatchProgress(null);

        // 단일 파일 — 기존 흐름
        if (files.length === 1) {
            const only = files[0];
            const r = await converter.runAudio({
                file_path: only.path,
                originalName: only.name,
                trimSilence,
            });
            if (r) {
                setResult({
                    timestampedPath: r.timestampedPath,
                    cleanPath: r.cleanPath,
                    isMulti: false,
                });
                setResultName(only.name);
            }
            return;
        }

        // 다중 파일 — 순차 처리 + merge
        const individualResults: { res: AudioJobResult; name: string }[] = [];
        for (let i = 0; i < files.length; i++) {
            setBatchProgress({ done: i, total: files.length });
            const f = files[i];
            const r = await converter.runAudio({
                file_path: f.path,
                originalName: f.name,
                trimSilence,
                // Tell the Rust pipeline which slot of the batch this is so
                // every progress emit reads "(i/N) …" — without this the
                // user can't distinguish "still on file 1" from "started 2"
                // during a long silence-cut.
                batchIndex: i + 1,
                batchTotal: files.length,
            });
            if (!r) {
                setBatchError(`${i + 1}/${files.length} "${f.name}" 처리 실패. 중단합니다.`);
                return;
            }
            individualResults.push({ res: r, name: f.name });
        }
        setBatchProgress({ done: files.length, total: files.length });

        // 합치기 — timestamped + clean 각각
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const outputDir: string = await invoke<string>('get_conversions_dir');
            const baseStamp = `녹취록_결합_${new Date().toISOString().slice(0, 10)}`;
            const tsPath = await invokeRaw<string>('merge_md_files', {
                paths: individualResults.map((r) => r.res.timestampedPath),
                labels: individualResults.map((r) => r.name),
                outputDir,
                outputBasename: `${baseStamp}_타임스탬프`,
            });
            const cleanPath = await invokeRaw<string>('merge_md_files', {
                paths: individualResults.map((r) => r.res.cleanPath),
                labels: individualResults.map((r) => r.name),
                outputDir,
                outputBasename: baseStamp,
            });
            setResult({
                timestampedPath: tsPath,
                cleanPath,
                isMulti: true,
                individualPaths: individualResults.map((r) => ({
                    timestamped: r.res.timestampedPath,
                    clean: r.res.cleanPath,
                    name: r.name,
                })),
            });
            setResultName(`${files.length}개 파일 결합`);
        } catch (err) {
            setBatchError(`합치기 실패: ${err}`);
        }
    };

    const isRunning = converter.jobState.phase === 'running';

    return (
        <div className="convert-tab-content">
            {files.length === 0 ? (
                <div className="convert-dropzone" onClick={handlePickSingle}>
                    <Upload size={28} />
                    <div className="convert-dropzone-title">오디오 파일 선택</div>
                    <div className="convert-dropzone-hint">
                        MP3 · WAV · M4A · AAC · OGG · FLAC · 최대 4시간
                    </div>
                    <button
                        className="convert-btn"
                        style={{ marginTop: 8 }}
                        onClick={(e) => {
                            e.stopPropagation();
                            handlePickMulti();
                        }}
                    >
                        <Plus size={14} /> 여러 파일 선택
                    </button>
                </div>
            ) : (
                <div className="audio-file-list">
                    {files.map((f, i) => (
                        <div key={`${f.path}-${i}`} className="audio-file-row">
                            <span className="audio-file-index">{i + 1}.</span>
                            <span className="audio-file-name" title={f.path}>{f.name}</span>
                            <button
                                className="audio-file-btn"
                                onClick={() => moveUp(i)}
                                disabled={i === 0 || isRunning}
                                title="위로"
                            >
                                <ArrowUp size={13} />
                            </button>
                            <button
                                className="audio-file-btn"
                                onClick={() => moveDown(i)}
                                disabled={i === files.length - 1 || isRunning}
                                title="아래로"
                            >
                                <ArrowDown size={13} />
                            </button>
                            <button
                                className="audio-file-btn danger"
                                onClick={() => removeAt(i)}
                                disabled={isRunning}
                                title="제거"
                            >
                                <X size={13} />
                            </button>
                        </div>
                    ))}
                    <div className="audio-file-add">
                        <button className="convert-btn" onClick={handlePickMulti} disabled={isRunning}>
                            <Plus size={14} /> 파일 추가
                        </button>
                        <span className="audio-file-summary">
                            {files.length}개 파일 · 정렬 순서로 변환
                        </span>
                    </div>
                </div>
            )}

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
                    disabled={files.length === 0 || isRunning}
                >
                    <Play size={14} /> 변환 시작{files.length > 1 ? ` (${files.length}개 순차)` : ''}
                </button>
                {(result || converter.jobState.phase === 'error' || batchError) && (
                    <button className="convert-btn" onClick={handleReset}>
                        <RotateCcw size={14} /> 새 파일
                    </button>
                )}
            </div>

            {batchProgress && (
                <div className="audio-batch-progress">
                    📦 다중 파일 진행: {batchProgress.done} / {batchProgress.total}
                </div>
            )}
            {batchError && <div className="audio-batch-error">{batchError}</div>}

            {result && (
                <>
                    <ResultCard
                        key={resultRev}
                        title={`변환 완료 — ${resultName}`}
                        paths={[
                            { label: '타임스탬프 포함', path: result.timestampedPath },
                            { label: '타임스탬프 제거', path: result.cleanPath },
                            ...(result.isMulti && result.individualPaths
                                ? result.individualPaths.flatMap((ip, i) => [
                                      { label: `개별 ${i + 1} (타임스탬프)`, path: ip.timestamped },
                                      { label: `개별 ${i + 1} (정리)`, path: ip.clean },
                                  ])
                                : []),
                        ]}
                        onOpen={onOpenResult ?? converter.openEditorWindow}
                    />
                    <div className="convert-actions" style={{ marginTop: 8 }}>
                        <button
                            className="convert-btn"
                            onClick={() => setSpeakerEditorOpen(true)}
                        >
                            <Users size={14} /> 화자 정리
                        </button>
                    </div>
                </>
            )}

            <SpeakerEditor
                visible={speakerEditorOpen}
                onClose={() => setSpeakerEditorOpen(false)}
                paths={result ? [result.timestampedPath, result.cleanPath] : []}
                onApplied={() => setResultRev((r) => r + 1)}
            />

            <ProgressPanel state={converter.jobState} />
        </div>
    );
}
