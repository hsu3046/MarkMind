import { DiffChunk } from '../types/ai';
import { Check, X } from 'lucide-react';

interface DiffViewProps {
    chunks: DiffChunk[];
    onAcceptChunk: (id: number) => void;
    onRejectChunk: (id: number) => void;
    onAcceptAll: () => void;
    onRejectAll: () => void;
    undecidedCount: number;
}

export function DiffView({
    chunks,
    onAcceptChunk,
    onRejectChunk,
    onAcceptAll,
    onRejectAll,
    undecidedCount,
}: DiffViewProps) {
    // Group consecutive removed+added lines into change blocks
    const groups = groupChunks(chunks);

    return (
        <div className="diff-view">
            <div className="diff-actions">
                <button className="diff-btn diff-accept-all" onClick={onAcceptAll} title="전체 적용">
                    <Check size={13} /> 전체 적용
                </button>
                <button className="diff-btn diff-reject-all" onClick={onRejectAll} title="전체 취소">
                    <X size={13} /> 전체 취소
                </button>
                {undecidedCount > 0 && (
                    <span className="diff-remaining">{undecidedCount}개 남음</span>
                )}
            </div>

            <div className="diff-content">
                {groups.map((group, i) => {
                    if (group.type === 'unchanged') {
                        return (
                            <div key={i} className="diff-line diff-unchanged">
                                {group.chunks[0].content}
                            </div>
                        );
                    }

                    // Change block
                    const allDecided = group.chunks.every(c => c.accepted !== undefined);
                    return (
                        <div key={i} className={`diff-block${allDecided ? ' decided' : ''}`}>
                            <div className="diff-block-lines">
                                {group.chunks.map(chunk => (
                                    <div
                                        key={chunk.id}
                                        className={`diff-line diff-${chunk.type}${chunk.accepted === true ? ' accepted' : ''
                                            }${chunk.accepted === false ? ' rejected' : ''}`}
                                    >
                                        <span className="diff-marker">
                                            {chunk.type === 'removed' ? '−' : '+'}
                                        </span>
                                        <span className="diff-text">{chunk.content || '\u00A0'}</span>
                                    </div>
                                ))}
                            </div>
                            {!allDecided && (
                                <div className="diff-block-actions">
                                    <button
                                        className="diff-chunk-btn accept"
                                        onClick={() => group.chunks.forEach(c => onAcceptChunk(c.id))}
                                        title="이 변경 수락"
                                    >
                                        <Check size={12} />
                                    </button>
                                    <button
                                        className="diff-chunk-btn reject"
                                        onClick={() => group.chunks.forEach(c => onRejectChunk(c.id))}
                                        title="이 변경 거부"
                                    >
                                        <X size={12} />
                                    </button>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ─── Group consecutive change lines ──────────────────────

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
