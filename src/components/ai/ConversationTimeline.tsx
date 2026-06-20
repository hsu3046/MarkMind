/**
 * 문서 개선(improve) 멀티턴 대화 타임라인 — AIPanel 안에 표시.
 * conversationHistory(AITurn[]) 를 user 버블 + assistant 칩으로 누적 렌더.
 * 활성 턴의 full diff 는 Editor 영역(InlineDiffView)이 담당하고, 여기선 맥락만 보여준다.
 */

import { MessagesSquare, Plus, Check } from 'lucide-react';
import type { AITurn } from '../../types/ai';
import './ConversationTimeline.css';

interface ConversationTimelineProps {
    messages: AITurn[];
    /** [새 대화] — 스레드 초기화(문서는 유지). */
    onNewThread: () => void;
}

export function ConversationTimeline({ messages, onNewThread }: ConversationTimelineProps) {
    if (messages.length === 0) return null;
    const turnCount = messages.filter((m) => m.role === 'user').length;
    return (
        <div className="ai-timeline">
            <div className="ai-timeline-header">
                <span className="ai-timeline-title">
                    <MessagesSquare size={12} /> 대화 {turnCount}턴
                </span>
                <button className="ai-timeline-new" onClick={onNewThread} title="새 대화 시작 (문서는 유지)">
                    <Plus size={12} /> 새 대화
                </button>
            </div>
            <div className="ai-timeline-list">
                {messages.map((t, i) =>
                    t.role === 'user' ? (
                        <div key={i} className="ai-msg ai-msg-user">
                            {t.content}
                        </div>
                    ) : (
                        <div key={i} className="ai-msg ai-msg-assistant">
                            <Check size={11} className="ai-msg-check" /> {t.content}
                        </div>
                    ),
                )}
            </div>
        </div>
    );
}
