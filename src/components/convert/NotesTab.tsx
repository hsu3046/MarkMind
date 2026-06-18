/**
 * 텍스트 → 회의록 변환 탭.
 * 입력: textarea (또는 .txt/.md 파일 업로드)
 * 옵션: 템플릿 선택, 상세도, provider
 */

import { useEffect, useState } from 'react';
import { Upload, Play, RotateCcw } from 'lucide-react';
import { DetailLevel, NotesJobResult, TemplateInfo } from '../../types/converter';
import { useConverter } from '../../hooks/useConverter';
import { getAIModelSelection } from '../../services/aiModelConfig';
import { ProgressPanel } from './ProgressPanel';
import { ResultCard } from './ResultCard';
import { pickTextFile } from './pickFile';

import type { DroppedFile } from './types';

interface NotesTabProps {
    converter: ReturnType<typeof useConverter>;
    droppedFile?: DroppedFile | null;
    onConsumeDropped?: () => void;
    onOpenResult?: (path: string) => void;
}

const MIN_CHARS = 100;

export function NotesTab({ converter, droppedFile, onConsumeDropped, onOpenResult }: NotesTabProps) {
    const [transcript, setTranscript] = useState('');
    const [source, setSource] = useState('paste.md');
    const [template, setTemplate] = useState('general');
    const [detail, setDetail] = useState<DetailLevel>('standard');
    const [templates, setTemplates] = useState<TemplateInfo[]>([]);
    const [result, setResult] = useState<NotesJobResult | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const list = await converter.listTemplates();
                if (cancelled) return;
                setTemplates(list);
                if (list.length > 0 && !list.find((t) => t.id === template)) {
                    setTemplate(list[0].id);
                }
            } catch (err) {
                console.warn('[NotesTab] 템플릿 로드 실패:', err);
            }
        })();
        return () => {
            cancelled = true;
        };
        // template 은 의도적으로 deps 에서 제외 — 초기 1회 로드 + default 선택만.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [converter.listTemplates]);

    // OS-level drag&drop 으로 텍스트 파일 들어오면 자동 read
    useEffect(() => {
        if (!droppedFile) return;
        (async () => {
            try {
                const { readTextFile } = await import('@tauri-apps/plugin-fs');
                const content = await readTextFile(droppedFile.path);
                setTranscript(content);
                setSource(droppedFile.name);
                setResult(null);
                converter.resetJob();
            } catch (err) {
                console.error('[NotesTab] 드롭 파일 읽기 실패:', err);
            } finally {
                onConsumeDropped?.();
            }
        })();
    }, [droppedFile]);

    const handlePick = async () => {
        const picked = await pickTextFile();
        if (!picked) return;
        try {
            const { readTextFile } = await import('@tauri-apps/plugin-fs');
            const content = await readTextFile(picked.path);
            setTranscript(content);
            setSource(picked.name);
            setResult(null);
            converter.resetJob();
        } catch (err) {
            console.error('[NotesTab] 파일 읽기 실패:', err);
            alert('파일 읽기 실패: ' + err);
        }
    };

    const handleRun = async () => {
        if (transcript.trim().length < MIN_CHARS) return;
        setResult(null);
        const sel = getAIModelSelection();
        const r = await converter.runNotes({
            transcript,
            template,
            source,
            detail,
            company: sel.company,
            auth: sel.auth,
            model: sel.model,
        });
        if (r) setResult(r);
    };

    const handleReset = () => {
        setTranscript('');
        setSource('paste.md');
        setResult(null);
        converter.resetJob();
    };

    const canRun =
        transcript.trim().length >= MIN_CHARS &&
        template &&
        converter.jobState.phase !== 'running';

    return (
        <div className="convert-tab-content">
            <div className="convert-text-input">
                <div className="convert-text-toolbar">
                    <span className="convert-text-info">
                        {transcript.length} / {MIN_CHARS}+ 자
                    </span>
                    <button className="convert-btn-sm" onClick={handlePick}>
                        <Upload size={12} /> 파일에서 불러오기
                    </button>
                </div>
                <textarea
                    placeholder="녹취록 또는 회의 메모를 붙여넣으세요 (최소 100자)..."
                    value={transcript}
                    onChange={(e) => setTranscript(e.target.value)}
                    rows={10}
                />
            </div>

            <div className="convert-options-grid">
                <div className="convert-option-field">
                    <label>템플릿</label>
                    <select
                        value={template}
                        onChange={(e) => setTemplate(e.target.value)}
                    >
                        {templates.map((t) => (
                            <option key={t.id} value={t.id}>
                                {t.name} {t.source === 'user' ? '(내 템플릿)' : ''}
                            </option>
                        ))}
                    </select>
                </div>

                <div className="convert-option-field">
                    <label>상세도</label>
                    <select value={detail} onChange={(e) => setDetail(e.target.value as DetailLevel)}>
                        <option value="concise">간결 — 핵심만 5~7줄</option>
                        <option value="standard">표준 — 균형 있게</option>
                        <option value="detailed">상세 — 토픽별 단락 + 인용</option>
                        <option value="verbatim">축어록 — 원문 인용 多</option>
                    </select>
                </div>

                <div className="convert-option-field">
                    <label>모델</label>
                    <p className="convert-key-note" style={{ margin: 0 }}>
                        설정 &gt; 기본 설정의 AI 모델을 사용합니다.
                    </p>
                </div>
            </div>

            <div className="convert-actions">
                <button
                    className="convert-btn primary"
                    onClick={handleRun}
                    disabled={!canRun}
                >
                    <Play size={14} /> 회의록 생성
                </button>
                {(result || converter.jobState.phase === 'error') && (
                    <button className="convert-btn" onClick={handleReset}>
                        <RotateCcw size={14} /> 새 입력
                    </button>
                )}
            </div>

            {result && (
                <ResultCard
                    title={`변환 완료 — ${result.templateName}`}
                    paths={[{ label: '마크다운', path: result.markdownPath }]}
                    cost={result.cost}
                    onOpen={onOpenResult ?? converter.openEditorWindow}
                />
            )}

            <ProgressPanel state={converter.jobState} />
        </div>
    );
}
