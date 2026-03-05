/** AI 모드 선택 */
export type AIMode = 'grammar' | 'translate' | 'improve';

/** 번역 대상 언어 */
export type TranslateLanguage = 'ko' | 'en' | 'ja';

/** AI 요청 */
export interface AIRequest {
    mode: AIMode;
    content: string;
    prompt?: string;
    language?: TranslateLanguage;
    improveQuality?: ImproveQuality;
}

/** Diff 변경 블록 */
export interface DiffChunk {
    id: number;
    type: 'unchanged' | 'removed' | 'added';
    content: string;
    accepted?: boolean;  // undefined = 미결정, true = 수락, false = 거부
}

/** AI 응답 */
export interface AIResponse {
    originalText: string;
    modifiedText: string;
    chunks: DiffChunk[];
}

/** AI 상태 */
export interface AIState {
    mode: AIMode;
    language: TranslateLanguage;
    isLoading: boolean;
    error: string | null;
    response: AIResponse | null;
    apiKeySet: boolean;
}

/** 문서 개선 품질 설정 */
export type ImproveQuality = 'speed' | 'quality';

/** 모드별 모델 매핑 */
export const AI_MODELS = {
    lite: 'gemini-3.1-flash-lite-preview',   // 문법, 번역
    flash: 'gemini-3-flash-preview',          // 상세 지시 / 속도 우선
    pro: 'gemini-3.1-pro-preview',            // 퀄리티 우선
} as const;

/** 모드별 사용 모델 (프롬프트 유무에 따라 업그레이드) */
export function getModelForMode(mode: AIMode, hasPrompt: boolean, improveQuality?: ImproveQuality): string {
    if (mode === 'improve') {
        return improveQuality === 'speed' ? AI_MODELS.flash : AI_MODELS.pro;
    }
    if (hasPrompt) return AI_MODELS.flash;
    return AI_MODELS.lite;
}
