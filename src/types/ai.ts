/** AI 모드 선택
 *  - grammar/translate/improve/structurize: 현재 문서를 변형 → InlineDiff
 *  - structurize(라벨 "마인드맵 정리"): 산문을 #/##/### + 불릿 계층 아웃라인으로 재구성(마인드맵용)
 *  - meeting-notes: 현재 문서를 transcript 로 보고 회의록 .md 새 파일 생성 → ResultCard
 *  - stt/ocr: 입력(음성/이미지)을 텍스트로 변환 — converter 가 자체 키로 처리(AI 에이전트 키 무관)
 *  - pptx(라벨 "슬라이드 만들기"): 현재 문서를 AI 레이아웃으로 .pptx 내보내기
 *  - image-gen(라벨 "이미지 생성"): 프롬프트(+참조 이미지)로 이미지 생성 → 미리보기 → 문서 삽입/파일 저장.
 *    Gemini/OpenAI 자체 키 사용(diff 흐름 아님, ImageGenPanel 로컬 상태).
 */
export type AIMode =
    | 'grammar'
    | 'translate'
    | 'improve'
    | 'structurize'
    | 'meeting-notes'
    | 'stt'
    | 'ocr'
    | 'pptx'
    | 'image-gen';

/** 번역 대상 언어 */
export type TranslateLanguage = 'ko' | 'en' | 'ja';

/** 멀티턴 대화의 한 메시지(provider 중립). improve 모드의 대화 히스토리 fold-in 용. */
export interface AITurn {
    role: 'user' | 'assistant';
    content: string;
}

/** AI 요청 */
export interface AIRequest {
    mode: AIMode;
    content: string;
    prompt?: string;
    language?: TranslateLanguage;
    improveQuality?: ImproveQuality;
    /** 멀티턴(improve 전용): 직전 턴들. user=이전 지시, assistant=적용 요약.
        callAI 가 프롬프트의 <conversation_history> 로 fold-in(문서 전문은 미포함 — 토큰 절약). */
    conversationHistory?: AITurn[];
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
