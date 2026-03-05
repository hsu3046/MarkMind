import { DiffChunk } from '../types/ai';
import { Check, X, CheckCheck, XCircle } from 'lucide-react';
import { ReactNode } from 'react';
import './InlineDiffView.css';

interface InlineDiffViewProps {
    chunks: DiffChunk[];
    onAcceptChunk: (id: number) => void;
    onRejectChunk: (id: number) => void;
    onAcceptAll: () => void;
    onRejectAll: () => void;
    undecidedCount: number;
    allDecided: boolean;
    onApplyResult: () => void;
}

export function InlineDiffView({
    chunks,
    onAcceptChunk,
    onRejectChunk,
    onAcceptAll,
    onRejectAll,
    undecidedCount,
    allDecided,
    onApplyResult,
}: InlineDiffViewProps) {
    const groups = groupChunks(chunks);

    return (
        <div className="inline-diff">
            {/* Top action bar */}
            <div className="inline-diff-toolbar">
                <div className="inline-diff-toolbar-left">
                    <span className="inline-diff-label">AI 변경사항 검토</span>
                    {undecidedCount > 0 && (
                        <span className="inline-diff-badge">{undecidedCount}개 남음</span>
                    )}
                </div>
                <div className="inline-diff-toolbar-right">
                    {!allDecided ? (
                        <>
                            <button className="inline-diff-btn accept" onClick={onAcceptAll}>
                                <CheckCheck size={14} /> 전체 적용
                            </button>
                            <button className="inline-diff-btn reject" onClick={onRejectAll}>
                                <XCircle size={14} /> 전체 취소
                            </button>
                        </>
                    ) : (
                        <button className="inline-diff-btn apply" onClick={onApplyResult}>
                            <CheckCheck size={14} /> 완료
                        </button>
                    )}
                </div>
            </div>

            {/* Diff content */}
            <div className="inline-diff-content">
                {groups.map((group, i) => {
                    if (group.type === 'unchanged') {
                        return (
                            <div key={i} className="idiff-line idiff-unchanged">
                                <span className="idiff-gutter">&nbsp;</span>
                                <span className="idiff-text">{group.chunks[0].content || '\u00A0'}</span>
                            </div>
                        );
                    }

                    // Change block
                    const blockDecided = group.chunks.every(c => c.accepted !== undefined);
                    const removed = group.chunks.filter(c => c.type === 'removed');
                    const added = group.chunks.filter(c => c.type === 'added');

                    // If removed and added have similar line counts, use word-level diff
                    const useWordDiff = removed.length > 0 && added.length > 0
                        && isSimilarContent(
                            removed.map(c => c.content).join('\n'),
                            added.map(c => c.content).join('\n')
                        );

                    return (
                        <div key={i} className={`idiff-block${blockDecided ? ' decided' : ''}`}>
                            {/* Block action buttons */}
                            {!blockDecided && (
                                <div className="idiff-block-actions">
                                    <button
                                        className="idiff-action-btn accept"
                                        onClick={() => group.chunks.forEach(c => onAcceptChunk(c.id))}
                                        title="이 변경 수락"
                                    >
                                        <Check size={12} /> 수락
                                    </button>
                                    <button
                                        className="idiff-action-btn reject"
                                        onClick={() => group.chunks.forEach(c => onRejectChunk(c.id))}
                                        title="이 변경 거부"
                                    >
                                        <X size={12} /> 거부
                                    </button>
                                </div>
                            )}

                            {/* Word-level diff (merged view) */}
                            {useWordDiff ? (
                                <div className="idiff-word-diff">
                                    {renderWordDiff(
                                        removed.map(c => c.content).join('\n'),
                                        added.map(c => c.content).join('\n')
                                    )}
                                </div>
                            ) : (
                                /* Full line diff (for translations etc.) */
                                group.chunks.map(chunk => (
                                    <div
                                        key={chunk.id}
                                        className={`idiff-line idiff-${chunk.type}${chunk.accepted === true ? ' accepted' : ''
                                            }${chunk.accepted === false ? ' rejected' : ''}`}
                                    >
                                        <span className="idiff-gutter">
                                            {chunk.type === 'removed' ? '−' : '+'}
                                        </span>
                                        <span className="idiff-text">{chunk.content || '\u00A0'}</span>
                                    </div>
                                ))
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ─── Word-level diff ─────────────────────────────

/** Check if two texts are similar enough for word-level diff (>50% shared words) */
function isSimilarContent(a: string, b: string): boolean {
    const wordsA = a.split(/\s+/);
    const wordsB = b.split(/\s+/);
    const setA = new Set(wordsA);
    let shared = 0;
    for (const w of wordsB) {
        if (setA.has(w)) shared++;
    }
    const total = Math.max(wordsA.length, wordsB.length);
    return total > 0 && (shared / total) > 0.4;
}

/** Render word-level diff as inline spans */
function renderWordDiff(oldText: string, newText: string): ReactNode {
    const oldWords = tokenize(oldText);
    const newWords = tokenize(newText);
    const lcs = computeWordLCS(oldWords, newWords);

    // Build raw token list with types
    type DiffToken = { type: 'same' | 'del' | 'ins'; text: string };
    const tokens: DiffToken[] = [];
    let oi = 0, ni = 0, li = 0;

    while (oi < oldWords.length || ni < newWords.length) {
        if (li < lcs.length && oi < oldWords.length && ni < newWords.length
            && oldWords[oi] === lcs[li] && newWords[ni] === lcs[li]) {
            tokens.push({ type: 'same', text: oldWords[oi] });
            oi++; ni++; li++;
        } else if (li < lcs.length && oi < oldWords.length && oldWords[oi] !== lcs[li]) {
            tokens.push({ type: 'del', text: oldWords[oi] });
            oi++;
        } else if (li < lcs.length && ni < newWords.length && newWords[ni] !== lcs[li]) {
            tokens.push({ type: 'ins', text: newWords[ni] });
            ni++;
        } else if (li >= lcs.length && oi < oldWords.length) {
            tokens.push({ type: 'del', text: oldWords[oi] });
            oi++;
        } else if (li >= lcs.length && ni < newWords.length) {
            tokens.push({ type: 'ins', text: newWords[ni] });
            ni++;
        } else {
            break;
        }
    }

    // Merge consecutive same-type tokens (absorb whitespace between same types)
    const merged: DiffToken[] = [];
    for (const token of tokens) {
        const isWhitespace = token.text.trim() === '';
        if (isWhitespace && merged.length > 0) {
            const prev = merged[merged.length - 1];
            // If this whitespace is between two tokens of same change type, absorb it
            // Look ahead to find next non-whitespace token
            const nextIdx = tokens.indexOf(token) + 1;
            let nextType: string | null = null;
            for (let k = nextIdx; k < tokens.length; k++) {
                if (tokens[k].text.trim() !== '') {
                    nextType = tokens[k].type;
                    break;
                }
            }
            if (prev.type !== 'same' && nextType === prev.type) {
                prev.text += token.text;
                continue;
            }
        }

        if (!isWhitespace && merged.length > 0 && merged[merged.length - 1].type === token.type) {
            merged[merged.length - 1].text += token.text;
        } else {
            merged.push({ ...token });
        }
    }

    // Render
    const spans: ReactNode[] = merged.map((t, i) => {
        const cls = t.type === 'del' ? 'wdiff-del' : t.type === 'ins' ? 'wdiff-ins' : 'wdiff-same';
        return <span key={i} className={cls}>{t.text}</span>;
    });

    return <span className="idiff-text">{spans}</span>;
}

/** Tokenize text into words with whitespace preserved */
function tokenize(text: string): string[] {
    // Split into words but keep whitespace as separate tokens
    return text.split(/(\s+)/).filter(t => t.length > 0);
}

/** Compute LCS for word arrays */
function computeWordLCS(a: string[], b: string[]): string[] {
    const m = a.length;
    const n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (a[i - 1] === b[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    const result: string[] = [];
    let i = m, j = n;
    while (i > 0 && j > 0) {
        if (a[i - 1] === b[j - 1]) {
            result.unshift(a[i - 1]);
            i--; j--;
        } else if (dp[i - 1][j] > dp[i][j - 1]) {
            i--;
        } else {
            j--;
        }
    }
    return result;
}

// ─── Grouping logic ──────────────────────────────

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
