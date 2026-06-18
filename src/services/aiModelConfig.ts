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
export type AICompany = 'gemini' | 'claude' | 'openai' | 'grok';

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
        auths: ['api_key', 'subscription'], // 구독 = Antigravity CLI(agy) headless 호출
        models: {
            api_key: [
                { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (고급)' },
                { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash (균형)' },
                { id: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash Lite (가성비)' },
            ],
            // 구독: agy 모델명(`agy models` 실측)을 그대로 --model 에 전달.
            subscription: [
                { id: 'Gemini 3.1 Pro (High)', label: 'Gemini 3.1 Pro (고급)' },
                { id: 'Gemini 3.5 Flash (High)', label: 'Gemini 3.5 Flash (균형)' },
                { id: 'Gemini 3.5 Flash (Low)', label: 'Gemini 3.5 Flash (가성비)' },
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
    grok: {
        label: 'Grok',
        // 구독(Grok Build CLI OAuth)은 tier-gating(Heavy 한정 가능)이라 추후 추가 — 현재 API 키만.
        auths: ['api_key'],
        // 텍스트는 grok-4.3(플래그십·vision, OpenAI 호환). docs.x.ai 확인(2026-06).
        models: {
            api_key: [{ id: 'grok-4.3', label: 'Grok 4.3' }],
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

/**
 * 카탈로그 기반 선택 정규화(제네릭) — 회사/인증/모델이 카탈로그상 유효한지 검사 후 보정.
 * 텍스트(AI_CATALOG)·이미지(IMAGE_AI_CATALOG) 모두 이 한 함수로 처리(단일 로직).
 * 무효 시 카탈로그의 첫 회사 · 그 회사의 첫 인증 · 첫 모델로 폴백.
 */
export function normalizeWithCatalog<C extends string>(
    catalog: Record<C, AICompanyDef>,
    sel: Partial<{ company: C; auth: AIAuthMode; model: string }> | null,
): { company: C; auth: AIAuthMode; model: string } {
    const companies = Object.keys(catalog) as C[];
    const company: C = sel?.company && catalog[sel.company] ? sel.company : companies[0];
    const def = catalog[company];
    const auth: AIAuthMode = sel?.auth && def.auths.includes(sel.auth) ? sel.auth : def.auths[0];
    const models = def.models[auth] ?? [];
    const model = models.some((m) => m.id === sel?.model) ? (sel!.model as string) : (models[0]?.id ?? '');
    return { company, auth, model };
}

/** 선택이 카탈로그상 유효한지(회사·인증·모델 조합) 검사 후 보정. */
export function normalizeSelection(sel: Partial<AIModelSelection> | null): AIModelSelection {
    return normalizeWithCatalog(AI_CATALOG, sel);
}

/**
 * 저장된 선택을 "실제 사용 가능한" 회사·방식으로 보정. 가용성은 호출부가 `isUsable` 로 주입
 * (API 키 보유 / 구독 연동 — Settings 는 stored·subStatus, callAI 는 hasKey·구독감지).
 * - 현재 선택이 가용하면 **그대로(동일 참조)** 반환 → 호출부가 `===` 로 변경 여부 판단.
 * - 비가용이면: 현재 회사가 가용하면 방식만 교정(구독만 있으면 subscription 으로),
 *   아니면 첫 가용 회사로 전환(모델은 회사 유지 시 보존, 바뀌면 그 회사 첫 모델).
 * - 가용한 회사가 하나도 없으면(키·구독 전무) 원본 그대로(키 등록 안내 상태).
 * AIModelPicker(Settings UI)와 callAI(실제 호출)가 이 함수로 동일하게 보정한다.
 */
export function resolveUsableSelection<C extends string>(
    catalog: Record<C, AICompanyDef>,
    sel: { company: C; auth: AIAuthMode; model: string },
    isUsable: (company: C, auth: AIAuthMode) => boolean,
): { company: C; auth: AIAuthMode; model: string } {
    const companyOk = (c: C): boolean => catalog[c].auths.some((a) => isUsable(c, a));
    if (companyOk(sel.company) && isUsable(sel.company, sel.auth)) return sel;
    const company = companyOk(sel.company)
        ? sel.company
        : (Object.keys(catalog) as C[]).find(companyOk);
    if (!company) return sel;
    const auth = catalog[company].auths.find((a) => isUsable(company, a)) ?? catalog[company].auths[0];
    return normalizeWithCatalog(catalog, {
        company,
        auth,
        model: company === sel.company ? sel.model : undefined,
    });
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

// ─── 이미지 생성 전용 모델 (텍스트와 별개 — Settings "이미지 AI 모델") ──────────
//
// 이미지 생성이 가능한 공급사(Gemini / OpenAI):
//  - Gemini: 구독 OAuth 연동을 제공사가 차단(텍스트 포함) → API 키 전용(auths 1개 → 토글 숨김).
//  - OpenAI: API 키(/v1/images, gpt-image-2) + ChatGPT 구독(Codex Responses API 의
//    image_generation 툴, mainline gpt-5.5) 둘 다 지원 → 방식 토글 노출.
//    구독 호출은 codex usage limit 에 누적된다(이미지/텍스트 공통).
// 모델 ID 는 공식 문서·실측 기준(2026-06): Gemini 2종(generateContent),
// OpenAI api_key=gpt-image-2 / subscription=gpt-5.5(+image_generation 툴).
// UI 표시는 별칭(Gemini 이미지 = "Nano Banana" 브랜드, OpenAI 구독 = "GPT Image (구독)").

/** 이미지 생성 가능 공급사. */
export type ImageAICompany = 'gemini' | 'openai' | 'grok';

export const IMAGE_AI_CATALOG: Record<ImageAICompany, AICompanyDef> = {
    gemini: {
        label: 'Gemini',
        auths: ['api_key'],
        models: {
            api_key: [
                { id: 'gemini-3.1-flash-image', label: 'Nano Banana 2' },
                { id: 'gemini-3-pro-image', label: 'Nano Banana Pro' },
            ],
        },
    },
    openai: {
        label: 'ChatGPT',
        auths: ['api_key', 'subscription'],
        models: {
            // alias(자동 최신 스냅샷) — 차후 모델 갱신 자동 추적. dated 스냅샷도 유효.
            api_key: [{ id: 'gpt-image-2', label: 'GPT Image 2' }],
            // 구독: mainline 모델 + image_generation 툴(별도 이미지 모델 아님). gpt-5.5 가 내부
            // GPT Image 를 호출. 모델 선택지는 1개라 사실상 "ChatGPT 구독으로 생성"의 의미.
            subscription: [{ id: 'gpt-5.5', label: 'GPT Image (구독)' }],
        },
    },
    grok: {
        label: 'Grok',
        // grok-imagine-* (api.x.ai/v1/images/generations). 비율·해상도(1k/2k) 직접 지원.
        // 구독 이미지는 추후(tier-gating) — 현재 API 키만. docs.x.ai 확인(2026-06).
        auths: ['api_key'],
        models: {
            api_key: [
                { id: 'grok-imagine-image-quality', label: 'Grok Imagine (고품질)' },
                { id: 'grok-imagine-image', label: 'Grok Imagine (기본)' },
            ],
        },
    },
};

/** 전역 이미지 모델 선택 (회사 + 인증 + 모델 ID). */
export interface ImageAIModelSelection {
    company: ImageAICompany;
    auth: AIAuthMode;
    model: string;
}

const IMAGE_STORAGE_KEY = 'markmind-image-ai-model-selection';

/** 기본값 — Nano Banana 2 (Gemini 3.1 Flash Image, API). */
export const IMAGE_DEFAULT_SELECTION: ImageAIModelSelection = {
    company: 'gemini',
    auth: 'api_key',
    model: 'gemini-3.1-flash-image',
};

export function normalizeImageSelection(sel: Partial<ImageAIModelSelection> | null): ImageAIModelSelection {
    return normalizeWithCatalog(IMAGE_AI_CATALOG, sel);
}

export function getImageAIModelSelection(): ImageAIModelSelection {
    try {
        const raw = localStorage.getItem(IMAGE_STORAGE_KEY);
        return normalizeImageSelection(raw ? (JSON.parse(raw) as ImageAIModelSelection) : null);
    } catch {
        return IMAGE_DEFAULT_SELECTION;
    }
}

export function setImageAIModelSelection(sel: ImageAIModelSelection): void {
    localStorage.setItem(IMAGE_STORAGE_KEY, JSON.stringify(sel));
}
