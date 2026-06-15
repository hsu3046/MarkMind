/** AI 모드 선택
 *  - grammar/translate/improve/structurize: 현재 문서를 변형 → InlineDiff
 *  - structurize: 산문을 #/##/### + 불릿 계층 아웃라인으로 재구성(마인드맵용)
 *  - meeting-notes: 현재 문서를 transcript 로 보고 회의록 .md 새 파일 생성 → ResultCard
 */
export type AIMode = 'grammar' | 'translate' | 'improve' | 'structurize' | 'meeting-notes';

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

/** 라인 내부 단어 단위 세그먼트 (word-level inline diff) */
export interface DiffSeg {
    text: string;
    type: 'unchanged' | 'removed' | 'added';
}

/** Diff 변경 블록 */
export interface DiffChunk {
    id: number;
    type: 'unchanged' | 'removed' | 'added';
    content: string;
    accepted?: boolean;  // undefined = 미결정, true = 수락, false = 거부
    /** 변경된 문단 쌍(removed↔added)일 때 단어 단위 세그먼트. 있으면 렌더가
        바뀐 단어만 강조(없으면 content 전체를 type 색으로). */
    parts?: DiffSeg[];
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
    flash: 'gemini-3.5-flash',                // 기본 — 상세 지시 / 속도 우선
    pro: 'gemini-3.1-pro-preview',            // 퀄리티 우선
} as const;

/** 모드별 사용 모델 (프롬프트 유무에 따라 업그레이드) */
export function getModelForMode(mode: AIMode, hasPrompt: boolean, improveQuality?: ImproveQuality): string {
    if (mode === 'improve') {
        return improveQuality === 'speed' ? AI_MODELS.flash : AI_MODELS.pro;
    }
    if (mode === 'structurize') return AI_MODELS.flash; // 구조 재구성 — 속도/품질 균형
    if (hasPrompt) return AI_MODELS.flash;
    return AI_MODELS.lite;
}
