/**
 * 공통 LLM 모델 selector — AIPanel 상단. 모든 AI 모드(문법/번역/개선/구조화/회의록)에서 활성.
 */

import type { Provider } from '../../services/secureStorage';
import { hasKey } from '../../services/secureStorage';

interface LlmSelectorProps {
    selected: Provider;
    onChange: (p: Provider) => void;
    /** Claude Code 구독 로그인 감지 여부 — API 키가 없어도 Claude 선택을 허용. */
    claudeSubscription?: boolean;
}

export function LlmSelector({ selected, onChange, claudeSubscription }: LlmSelectorProps) {
    const geminiAvailable = hasKey('gemini');
    const claudeKey = hasKey('claude');
    // 구독(Claude Code) 로그인이 있으면 API 키 없이도 Claude 사용 가능.
    const claudeAvailable = claudeKey || !!claudeSubscription;
    return (
        <div className="ai-llm-select" title="AI 작업에 사용할 LLM 선택">
            <select value={selected} onChange={(e) => onChange(e.target.value as Provider)}>
                <option value="gemini" disabled={!geminiAvailable}>
                    Gemini 3.1 Pro{!geminiAvailable && ' (키 필요)'}
                </option>
                <option value="claude" disabled={!claudeAvailable}>
                    Claude Sonnet 4.6
                    {!claudeAvailable ? ' (키/구독 필요)' : !claudeKey ? ' (구독)' : ''}
                </option>
                {/* OpenAI 호출 경로 미구현(Codex 구독 연동은 다음 Phase) — 선택 비활성. */}
                <option value="openai" disabled>
                    OpenAI (준비 중)
                </option>
            </select>
        </div>
    );
}
