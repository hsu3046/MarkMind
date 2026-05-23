/**
 * 이미지 / PDF → 텍스트 변환 탭.
 * 옵션: 빠른 모드 (1-pass) vs 정밀 모드 (2-pass)
 */

import { useEffect, useState } from 'react';
import { Upload, Play, RotateCcw } from 'lucide-react';
import { OcrJobResult } from '../../types/converter';
import { useConverter } from '../../hooks/useConverter';
import { ProgressPanel } from './ProgressPanel';
import { ResultCard } from './ResultCard';
import { pickImageOrPdfFile } from './pickFile';
import type { DroppedFile } from './types';

interface OcrTabProps {
    converter: ReturnType<typeof useConverter>;
    droppedFile?: DroppedFile | null;
    onConsumeDropped?: () => void;
    onOpenResult?: (path: string) => void;
}

export function OcrTab({ converter, droppedFile, onConsumeDropped, onOpenResult }: OcrTabProps) {
    const [filePath, setFilePath] = useState<string | null>(null);
    const [fileName, setFileName] = useState<string>('');
    const [result, setResult] = useState<OcrJobResult | null>(null);

    useEffect(() => {
        if (!droppedFile) return;
        setFilePath(droppedFile.path);
        setFileName(droppedFile.name);
        setResult(null);
        converter.resetJob();
        onConsumeDropped?.();
    }, [droppedFile]);

    const handlePick = async () => {
        const picked = await pickImageOrPdfFile();
        if (picked) {
            setFilePath(picked.path);
            setFileName(picked.name);
            setResult(null);
            converter.resetJob();
        }
    };

    const handleRun = async () => {
        if (!filePath) return;
        try {
            const { stat } = await import('@tauri-apps/plugin-fs');
            const { ask } = await import('@tauri-apps/plugin-dialog');
            const meta = await stat(filePath);
            const sizeMB = Number(meta.size) / (1024 * 1024);
            if (sizeMB > 250) {
                await ask(
                    `파일이 ${sizeMB.toFixed(0)}MB 입니다.\n` +
                    `Gemini File API 한도(250MB) 를 초과합니다. PDF 라면 페이지를 분할해주세요.`,
                    { title: 'MarkMind — 파일 크기 초과', kind: 'warning' },
                );
                return;
            }
            if (sizeMB > 50) {
                const ok = await ask(
                    `파일이 ${sizeMB.toFixed(0)}MB 입니다.\n` +
                    `2-Pass OCR (정밀 모드) 는 토큰 비용이 클 수 있습니다. 계속하시겠어요?`,
                    { title: 'MarkMind', kind: 'info' },
                );
                if (!ok) return;
            }
        } catch {
            // stat/dialog 실패 무시
        }
        setResult(null);
        const r = await converter.runOcr({
            file_path: filePath,
            originalName: fileName,
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
                        <div className="convert-dropzone-title">이미지 또는 PDF 선택</div>
                        <div className="convert-dropzone-hint">
                            PNG · JPEG · WebP · PDF · 최대 250MB
                        </div>
                    </>
                )}
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
                    paths={[{ label: '마크다운', path: result.markdownPath }]}
                    cost={result.cost}
                    onOpen={onOpenResult ?? converter.openEditorWindow}
                />
            )}

            <ProgressPanel state={converter.jobState} />
        </div>
    );
}
