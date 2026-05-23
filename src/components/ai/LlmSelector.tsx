/**
 * 공통 LLM 모델 selector — AIPanel 상단. 회의록 모드에서만 활성.
 */

import { AIMode } from '../../types/ai';
import type { Provider } from '../../services/secureStorage';
import { hasKey } from '../../services/secureStorage';

interface LlmSelectorProps {
    mode: AIMode;
    selected: Provider;
    onChange: (p: Provider) => void;
}

export function LlmSelector({ mode, selected, onChange }: LlmSelectorProps) {
    const geminiAvailable = hasKey('gemini');
    const claudeAvailable = hasKey('claude');
    const openaiAvailable = hasKey('openai');
    const enabled = mode === 'meeting-notes';
    return (
        <div
            className="ai-llm-select"
            title={enabled ? '회의록 생성에 사용할 LLM 선택' : '문법/번역/문서 개선은 항상 Gemini 사용'}
        >
            <select
                value={selected}
                onChange={(e) => onChange(e.target.value as Provider)}
                disabled={!enabled}
            >
                <option value="gemini" disabled={!geminiAvailable}>
                    Gemini 3.1 Pro{!geminiAvailable && ' (키 필요)'}
                </option>
                <option value="claude" disabled={!claudeAvailable}>
                    Claude Sonnet 4.6{!claudeAvailable && ' (키 필요)'}
                </option>
                <option value="openai" disabled={!openaiAvailable}>
                    OpenAI{!openaiAvailable && ' (키 필요)'}
                </option>
            </select>
        </div>
    );
}
