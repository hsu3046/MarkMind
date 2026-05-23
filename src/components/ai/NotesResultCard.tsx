/**
 * 회의록 모드 결과 카드 — AIPanel 에서 분리.
 */

import { FileText, ExternalLink } from 'lucide-react';
import type { NotesJobResult } from '../../types/converter';

interface NotesResultCardProps {
    result: NotesJobResult;
    onOpen: (path: string) => Promise<void> | void;
}

export function NotesResultCard({ result, onOpen }: NotesResultCardProps) {
    return (
        <div className="ai-notes-result">
            <div className="ai-notes-result-header">
                <FileText size={14} />
                <span>회의록 생성 완료</span>
            </div>
            <div className="ai-notes-result-template">템플릿: {result.templateName}</div>
            <div className="ai-notes-result-path" title={result.markdownPath}>
                {result.markdownPath}
            </div>
            <button className="ai-btn primary" onClick={() => onOpen(result.markdownPath)}>
                <ExternalLink size={13} /> 에디터에서 열기
            </button>
            <div className="ai-notes-result-cost">
                ${result.cost.totalCostUsd.toFixed(4)} ·{' '}
                {result.cost.totalInputTokens.toLocaleString()} in /{' '}
                {result.cost.totalOutputTokens.toLocaleString()} out
            </div>
        </div>
    );
}
