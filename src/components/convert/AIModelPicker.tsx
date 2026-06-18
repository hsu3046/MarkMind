/**
 * 전역 AI 모델 선택 — 회사 → 인증 → 모델 단계형.
 * 카탈로그(aiModelConfig)를 그대로 읽어 렌더하므로 회사가 늘면 자동 확장된다.
 * 인증 단계는 회사가 2가지 이상 인증을 지원할 때만 노출(Gemini 는 API 고정 → 숨김).
 */

import { useEffect, useState } from 'react';
import {
    AI_CATALOG,
    AICompany,
    AIAuthMode,
    AIModelSelection,
    getAIModelSelection,
    setAIModelSelection,
    selectCompany,
    selectAuth,
    normalizeSelection,
} from '../../services/aiModelConfig';
import { detectSubscriptionLogins, SubscriptionStatus } from '../../services/subscriptionService';

export function AIModelPicker() {
    const [sel, setSel] = useState<AIModelSelection>(getAIModelSelection());
    const [sub, setSub] = useState<SubscriptionStatus>({ claude: false, codex: false });

    useEffect(() => {
        detectSubscriptionLogins().then(setSub);
    }, []);

    const apply = (next: Partial<AIModelSelection>) => {
        const n = normalizeSelection({ ...sel, ...next });
        setSel(n);
        setAIModelSelection(n);
    };

    const def = AI_CATALOG[sel.company];
    const models = def.models[sel.auth] ?? [];

    // 구독 인증 가용성 — 해당 회사의 CLI 로그인이 감지돼야 활성.
    const subAvailable = (company: AICompany): boolean =>
        company === 'claude' ? sub.claude : company === 'openai' ? sub.codex : false;
    const authEnabled = (auth: AIAuthMode): boolean =>
        auth === 'api_key' ? true : subAvailable(sel.company);

    const authLabel = (auth: AIAuthMode): string => (auth === 'api_key' ? 'API 키' : '구독');

    return (
        <section className="convert-settings-section">
            <label>AI 모델</label>

            {/* 회사 */}
            <div className="ai-model-row">
                <span className="ai-model-key">회사</span>
                <div className="ai-seg">
                    {(Object.keys(AI_CATALOG) as AICompany[]).map((key) => (
                        <button
                            key={key}
                            type="button"
                            className={`ai-seg-btn${sel.company === key ? ' active' : ''}`}
                            onClick={() => apply(selectCompany(key))}
                        >
                            {AI_CATALOG[key].label}
                        </button>
                    ))}
                </div>
            </div>

            {/* 인증 — 둘 이상 지원하는 회사에서만 노출 */}
            {def.auths.length > 1 && (
                <div className="ai-model-row">
                    <span className="ai-model-key">인증</span>
                    <div className="ai-seg">
                        {def.auths.map((auth) => (
                            <button
                                key={auth}
                                type="button"
                                className={`ai-seg-btn${sel.auth === auth ? ' active' : ''}`}
                                disabled={!authEnabled(auth)}
                                onClick={() => apply(selectAuth(sel.company, auth))}
                            >
                                {authLabel(auth)}
                                {auth === 'subscription' && !subAvailable(sel.company) ? ' (미연결)' : ''}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* 모델 */}
            <div className="ai-model-row">
                <span className="ai-model-key">모델</span>
                <select value={sel.model} onChange={(e) => apply({ model: e.target.value })}>
                    {models.map((m) => (
                        <option key={m.id} value={m.id}>
                            {m.label}
                        </option>
                    ))}
                </select>
            </div>

            <p className="convert-key-note">
                모든 AI 작업(문법·번역·개선·구조화·회의록)에 이 모델이 사용됩니다.
            </p>
        </section>
    );
}
