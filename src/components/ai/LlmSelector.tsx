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
    /** Codex(ChatGPT) 구독 로그인 감지 여부 — 구독으로만 호출(API 키 경로 없음). */
    codexSubscription?: boolean;
}

export function LlmSelector({ selected, onChange, claudeSubscription, codexSubscription }: LlmSelectorProps) {
    const geminiAvailable = hasKey('gemini');
    const claudeKey = hasKey('claude');
    // 구독(Claude Code) 로그인이 있으면 API 키 없이도 Claude 사용 가능.
    const claudeAvailable = claudeKey || !!claudeSubscription;
    // ChatGPT 는 Codex 구독 로그인으로만 호출(API 키 경로 미구현).
    const codexAvailable = !!codexSubscription;
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
                <option value="openai" disabled={!codexAvailable}>
                    ChatGPT (구독){!codexAvailable ? ' (구독 필요)' : ''}
                </option>
            </select>
        </div>
    );
}
