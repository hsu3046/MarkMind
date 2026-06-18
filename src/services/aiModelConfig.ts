/**
 * 전역 AI 모델 설정 — 회사(company) → 인증(auth) → 모델(model) 3단계.
 *
 * 모든 AI 작업(문법·번역·개선·구조화·회의록)이 이 설정 하나를 따른다.
 * 새 회사(Grok 등) 추가 = AI_CATALOG 에 항목 1개 + 호출 경로 1개. UI 는 카탈로그를
 * 그대로 읽어 렌더하므로 회사가 늘면 자동 확장된다.
 *
 * 모델 ID/목록은 이 파일 한 곳에서만 관리한다(조정 쉬움).
 */

/** LLM 공급사. 새 회사 추가 시 여기 + AI_CATALOG 에만 손대면 된다. */
export type AICompany = 'gemini' | 'claude' | 'openai';

/** 인증 방식 — API 키(공식) 또는 구독(로컬 CLI 토큰 재사용). */
export type AIAuthMode = 'api_key' | 'subscription';

export interface AIModelDef {
    /** 호출에 쓰는 실제 모델 ID. */
    id: string;
    /** UI 표시명. */
    label: string;
}

export interface AICompanyDef {
    /** UI 표시명 ("Claude" 등). */
    label: string;
    /** 이 회사가 지원하는 인증 방식(순서 = UI 표시 순서). */
    auths: AIAuthMode[];
    /** 인증별 모델 목록. */
    models: Partial<Record<AIAuthMode, AIModelDef[]>>;
}

/**
 * 모델 카탈로그. 모델 ID 는 조정 가능(초안):
 * - Gemini: types/ai.ts AI_MODELS 와 일치
 * - Claude: claude-opus-4-8 / claude-sonnet-4-6 / claude-haiku-4-5
 * - ChatGPT: API 는 gpt-5.4 계열, 구독은 ~/.codex/models_cache.json 의 id(gpt-5.5 등)
 */
export const AI_CATALOG: Record<AICompany, AICompanyDef> = {
    gemini: {
        label: 'Gemini',
        auths: ['api_key'], // 구독 연동 미지원(제공사 차단)
        models: {
            api_key: [
                { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (고급)' },
                { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash (균형)' },
                { id: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash Lite (가성비)' },
            ],
        },
    },
    claude: {
        label: 'Claude',
        auths: ['api_key', 'subscription'],
        // API·구독 모델 동일(Claude Code OAuth 로 opus/sonnet/haiku 모두 호출 가능).
        models: {
            api_key: [
                { id: 'claude-opus-4-8', label: 'Opus 4.8 (고급)' },
                { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6 (균형)' },
                { id: 'claude-haiku-4-5', label: 'Haiku 4.5 (가성비)' },
            ],
            subscription: [
                { id: 'claude-opus-4-8', label: 'Opus 4.8 (고급)' },
                { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6 (균형)' },
                { id: 'claude-haiku-4-5', label: 'Haiku 4.5 (가성비)' },
            ],
        },
    },
    openai: {
        label: 'ChatGPT',
        auths: ['api_key', 'subscription'],
        // API 와 구독의 사용 가능 모델이 다름(구독은 ~/.codex/models_cache.json 실측).
        models: {
            api_key: [
                { id: 'gpt-5.5', label: 'GPT-5.5 (고급)' },
                { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini (균형)' },
                { id: 'gpt-5.4-nano', label: 'GPT-5.4 Nano (가성비)' },
            ],
            subscription: [
                { id: 'gpt-5.5', label: 'GPT-5.5 (고급)' },
                { id: 'gpt-5.4', label: 'GPT-5.4 (균형)' },
                { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini (가성비)' },
            ],
        },
    },
};

/** 전역 선택 상태 (회사 + 인증 + 모델 ID). */
export interface AIModelSelection {
    company: AICompany;
    auth: AIAuthMode;
    model: string;
}

const STORAGE_KEY = 'markmind-ai-model-selection';

/** 기본값 — Gemini 3.1 Pro (API). */
export const DEFAULT_SELECTION: AIModelSelection = {
    company: 'gemini',
    auth: 'api_key',
    model: 'gemini-3.1-pro-preview',
};

/** 선택이 카탈로그상 유효한지(회사·인증·모델 조합) 검사 후 보정. */
export function normalizeSelection(sel: Partial<AIModelSelection> | null): AIModelSelection {
    const company: AICompany =
        sel?.company && sel.company in AI_CATALOG ? sel.company : DEFAULT_SELECTION.company;
    const def = AI_CATALOG[company];
    const auth: AIAuthMode = sel?.auth && def.auths.includes(sel.auth) ? sel.auth : def.auths[0];
    const models = def.models[auth] ?? [];
    const model = models.some((m) => m.id === sel?.model)
        ? (sel!.model as string)
        : (models[0]?.id ?? DEFAULT_SELECTION.model);
    return { company, auth, model };
}

export function getAIModelSelection(): AIModelSelection {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return normalizeSelection(raw ? (JSON.parse(raw) as AIModelSelection) : null);
    } catch {
        return DEFAULT_SELECTION;
    }
}

export function setAIModelSelection(sel: AIModelSelection): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sel));
}

/** 회사 변경 시 인증/모델을 그 회사의 첫 유효값으로 재설정해 반환. */
export function selectCompany(company: AICompany): AIModelSelection {
    return normalizeSelection({ company });
}

/** 인증 변경 시 모델을 그 인증의 첫 유효값으로 재설정해 반환. */
export function selectAuth(company: AICompany, auth: AIAuthMode): AIModelSelection {
    return normalizeSelection({ company, auth });
}
