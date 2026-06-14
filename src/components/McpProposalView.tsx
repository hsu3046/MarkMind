import { DiffChunk } from '../types/ai';
import { Check, X } from 'lucide-react';

/**
 * MCP propose_edit 전용 diff 미리보기.
 * Claude 가 제안한 전체 내용 변경을 현재 내용과의 diff 로 보여주고,
 * 사용자가 전체 수락/거절만 한다(chunk 단위 인터랙션 없음 — AI 흐름의
 * InlineDiffView 와 달리 ai 훅 상태와 분리되어 독립 동작).
 */
interface McpProposalViewProps {
    chunks: DiffChunk[];
    description?: string;
    onAccept: () => void;
    onReject: () => void;
}

export function McpProposalView({ chunks, description, onAccept, onReject }: McpProposalViewProps) {
    const groups = groupChunks(chunks);

    return (
        <div className="diff-view">
            <div className="diff-actions">
                <span className="diff-remaining" style={{ marginRight: 'auto' }}>
                    Claude 수정 제안{description ? `: ${description}` : ''}
                </span>
                <button className="diff-btn diff-accept-all" onClick={onAccept} title="수정안 수락">
                    <Check size={13} /> 수락
                </button>
                <button className="diff-btn diff-reject-all" onClick={onReject} title="수정안 거절">
                    <X size={13} /> 거절
                </button>
            </div>

            <div className="diff-content">
                {groups.map((group, i) => {
                    if (group.type === 'unchanged') {
                        return (
                            <div key={i} className="diff-line diff-unchanged">
                                {group.chunks[0].content || ' '}
                            </div>
                        );
                    }
                    return (
                        <div key={i} className="diff-block">
                            <div className="diff-block-lines">
                                {group.chunks.map((chunk) => (
                                    <div key={chunk.id} className={`diff-line diff-${chunk.type}`}>
                                        <span className="diff-marker">
                                            {chunk.type === 'removed' ? '−' : '+'}
                                        </span>
                                        <span className="diff-text">{chunk.content || ' '}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ─── DiffView 와 동일한 그룹핑(연속 변경 라인 묶기) ───
interface ChunkGroup {
    type: 'unchanged' | 'change';
    chunks: DiffChunk[];
}

function groupChunks(chunks: DiffChunk[]): ChunkGroup[] {
    const groups: ChunkGroup[] = [];
    let currentChange: DiffChunk[] = [];

    const flushChange = () => {
        if (currentChange.length > 0) {
            groups.push({ type: 'change', chunks: [...currentChange] });
            currentChange = [];
        }
    };

    for (const chunk of chunks) {
        if (chunk.type === 'unchanged') {
            flushChange();
            groups.push({ type: 'unchanged', chunks: [chunk] });
        } else {
            currentChange.push(chunk);
        }
    }
    flushChange();

    return groups;
}
