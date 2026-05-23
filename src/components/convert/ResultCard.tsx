/**
 * 변환 결과 카드 — 저장된 .md 파일 경로 + "에디터에서 열기" 버튼.
 */

import { CostSummary } from '../../types/converter';
import { FileText, ExternalLink } from 'lucide-react';

interface ResultCardProps {
    title: string;
    paths: { label: string; path: string }[];
    cost?: CostSummary;
    onOpen: (path: string) => void;
}

export function ResultCard({ title, paths, cost, onOpen }: ResultCardProps) {
    return (
        <div className="convert-result-card">
            <div className="convert-result-header">
                <FileText size={14} />
                <span>{title}</span>
            </div>
            <ul className="convert-result-files">
                {paths.map((p) => (
                    <li key={p.path}>
                        <div className="convert-file-info">
                            <div className="convert-file-label">{p.label}</div>
                            <div className="convert-file-path" title={p.path}>{p.path}</div>
                        </div>
                        <button
                            className="convert-open-btn"
                            onClick={() => onOpen(p.path)}
                            title="새 에디터 윈도우에서 열기"
                        >
                            <ExternalLink size={13} /> 에디터에서 열기
                        </button>
                    </li>
                ))}
            </ul>
            {cost && (
                <div className="convert-result-cost">
                    ${cost.totalCostUsd.toFixed(4)} · 입력 {cost.totalInputTokens.toLocaleString()}
                    토큰 · 출력 {cost.totalOutputTokens.toLocaleString()} 토큰
                </div>
            )}
        </div>
    );
}
