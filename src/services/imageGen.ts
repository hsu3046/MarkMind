/**
 * 이미지 생성 클라이언트 — Rust command(generate_image_gemini/openai) 호출 래퍼.
 *
 * 실제 API 호출은 Rust(reqwest)가 담당한다(WKWebView fetch 의 CORS 제약 회피 — 텍스트
 * LLM 과 동일 경로). 키는 기존 Settings 의 Keychain(gemini/openai)을 Rust 가 직접 읽으므로
 * 여기서 전달하지 않는다. 반환은 base64 data URL 배열(개수 1) — 삽입/저장이 공급사와 무관.
 *
 * 참조 이미지 압축(compressImageIfNeeded)은 lumina-studio 에서 그대로 가져옴(canvas 기반).
 */

export type ImageProvider = 'gemini' | 'openai';
/** 해상도 — 공통 축. Gemini=imageSize 직접, OpenAI=비율과 함께 size(WxH)로 환산. */
export type ImageResolution = '1K' | '2K' | '4K';
/** 렌더 품질 — OpenAI(gpt-image-2)의 quality 파라미터 전용(Gemini 는 해당 없음). */
export type ImageQuality = 'low' | 'medium' | 'high';

export interface AspectRatioDef {
    id: string;
    label: string;
    desc: string;
}

/** 선택 가능한 비율(가로:세로). UI 그리드가 이 목록을 그대로 렌더. */
export const ASPECT_RATIOS: readonly AspectRatioDef[] = [
    { id: '1:1', label: '1:1', desc: '정사각' },
    { id: '3:2', label: '3:2', desc: '가로' },
    { id: '2:3', label: '2:3', desc: '세로' },
    { id: '4:3', label: '4:3', desc: '표준' },
    { id: '3:4', label: '3:4', desc: '세로' },
    { id: '16:9', label: '16:9', desc: '와이드' },
    { id: '9:16', label: '9:16', desc: '수직' },
    { id: '21:9', label: '21:9', desc: '울트라' },
] as const;

/** 해상도 선택지(공통 — 두 공급사 모두 노출). */
export const IMAGE_RESOLUTIONS: readonly { id: ImageResolution; label: string }[] = [
    { id: '1K', label: '1K' },
    { id: '2K', label: '2K' },
    { id: '4K', label: '4K' },
] as const;

/** 품질 선택지(OpenAI 전용 — gpt-image-2 quality). */
export const IMAGE_QUALITIES: readonly { id: ImageQuality; label: string }[] = [
    { id: 'low', label: '낮음' },
    { id: 'medium', label: '보통' },
    { id: 'high', label: '높음' },
] as const;

/** 비율 미리보기 박스 크기(최대 변 maxDim px). */
export function getPreviewDimensions(ratio: string, maxDim = 28): { w: number; h: number } {
    const [rw, rh] = ratio.split(':').map(Number);
    if (!rw || !rh) return { w: maxDim, h: maxDim };
    if (rw >= rh) return { w: maxDim, h: Math.round(maxDim * (rh / rw)) };
    return { w: Math.round(maxDim * (rw / rh)), h: maxDim };
}

export interface GenerateImageOptions {
    provider: ImageProvider;
    /** 호출에 쓸 모델 ID (예: gemini-3.1-flash-image / gpt-image-2). */
    model: string;
    prompt: string;
    aspectRatio: string;
    resolution: ImageResolution;
    /** OpenAI 전용 렌더 품질. Gemini 는 무시. */
    quality?: ImageQuality;
    /** base64 data URL 배열. 비우면 텍스트→이미지. */
    referenceImages?: string[];
}

/**
 * 이미지 생성 — provider 에 따라 Rust command 호출. 반환은 base64 data URL 배열(보통 1장).
 * Tauri 가 인자명을 camelCase→snake_case 자동 매핑한다(aspectRatio → aspect_ratio 등).
 * - Gemini: aspectRatio + resolution(=imageSize) 만 전달(품질 파라미터 없음).
 * - OpenAI: aspectRatio + resolution(→ size WxH 환산) + quality 전달.
 */
export async function generateImage(opts: GenerateImageOptions): Promise<string[]> {
    const { provider, model, prompt, aspectRatio, resolution, quality, referenceImages } = opts;
    if (!prompt.trim()) throw new Error('프롬프트를 입력해주세요.');

    const { invoke } = await import('@tauri-apps/api/core');
    const refs = referenceImages ?? [];
    if (provider === 'gemini') {
        return invoke<string[]>('generate_image_gemini', { model, prompt, aspectRatio, resolution, referenceImages: refs });
    }
    return invoke<string[]>('generate_image_openai', {
        model,
        prompt,
        aspectRatio,
        resolution,
        quality: quality ?? 'high',
        referenceImages: refs,
    });
}

// ===== 사용자 친화적 에러 메시지 =====

/**
 * Rust 가 던진 에러 문자열(`Gemini HTTP 401 — ...`, `OpenAI 네트워크 오류: ...`,
 * `... API 키가 없습니다 ...` 등)을 한국어 메시지로 변환. raw 는 콘솔에 남긴다.
 */
export function humanizeImageGenError(err: unknown, provider: ImageProvider): string {
    const label = provider === 'gemini' ? 'Gemini' : 'OpenAI';
    const raw = err instanceof Error ? err.message : String(err);
    const body = raw.toLowerCase();
    console.error(`[imageGen/${provider}]`, raw.slice(0, 500));

    // Rust command 의 "API 키가 없습니다 ..." 안내는 그대로 노출(설정 유도).
    if (body.includes('api 키가 없습니다')) return raw;

    // GPT Image 모델(gpt-image-2 등)은 API 키와 별개로 "조직 인증"이 필요 — 미인증 시 거부됨.
    if (body.includes('verif') || body.includes('organization must') || body.includes('must be verified'))
        return `${label} 조직 인증(Organization Verification)이 필요합니다. platform.openai.com → 설정 → 조직(General)에서 인증을 완료한 뒤 다시 시도해주세요. (GPT Image 모델 공통 요건)`;

    // 결제 한도(billing hard limit) 도달 — OpenAI 계정 측 한도/크레딧 문제(코드·요청 무관).
    if (body.includes('billing') || body.includes('hard limit'))
        return `${label} 결제 한도에 도달했습니다. platform.openai.com → Settings → Limits 에서 사용 한도를 상향하거나 결제(크레딧)를 확인해주세요.`;

    const statusMatch = raw.match(/http\s+(\d{3})/i);
    const status = statusMatch ? Number(statusMatch[1]) : 0;

    if (status === 401 || status === 403 || body.includes('invalid api key') || body.includes('unauthorized') || body.includes('invalid_api_key'))
        return `${label} API 키가 유효하지 않습니다. 설정에서 키를 확인해주세요.`;
    if (status === 429 || body.includes('rate limit') || body.includes('quota') || body.includes('insufficient_quota'))
        return `${label} 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.`;
    if (status === 413 || body.includes('too large') || body.includes('entity too large'))
        return '요청 데이터가 너무 큽니다. 참조 이미지를 줄이거나 해상도를 낮춰주세요.';
    if (body.includes('safety') || body.includes('blocked') || body.includes('content_policy') || body.includes('moderation') || body.includes('violat'))
        return '콘텐츠 안전 정책에 의해 차단되었습니다. 프롬프트를 수정해주세요.';
    if (body.includes('invalid_image') || body.includes('could not process image') || body.includes('참조 이미지'))
        return '참조 이미지를 처리할 수 없습니다. 다른 이미지를 사용해주세요.';
    if (body.includes('timed out') || body.includes('timeout') || body.includes('시간 초과'))
        return `${label} 응답 시간 초과 — 이미지 생성이 오래 걸리고 있습니다(특히 2K/4K·high 품질). 품질·크기를 낮추거나 잠시 후 다시 시도해주세요.`;
    if (body.includes('네트워크') || body.includes('network') || body.includes('failed to fetch') || body.includes('dns'))
        return '네트워크 연결에 실패했습니다. 인터넷 연결을 확인해주세요.';
    if (status >= 500)
        return `${label} 서버에 일시적 오류가 발생했습니다. 잠시 후 다시 시도해주세요.`;
    if (status === 400) {
        if (body.includes('prompt')) return '프롬프트에 문제가 있습니다. 내용을 확인하고 다시 시도해주세요.';
        // 원인 미상 400 — OpenAI 원본 메시지를 노출해 진단(파라미터/모델/정책 등 구분).
        const detail = (raw.includes('—') ? raw.split('—').slice(1).join('—') : raw).trim();
        return `${label} 요청 거부: ${detail.slice(0, 400)}`;
    }
    // 폴백 — Rust 가 만든 한국어 메시지("...생성하지 못했습니다." 등)는 그대로 노출.
    return raw;
}

// ===== 참조 이미지 압축 (lumina-studio 이식, canvas 기반) =====

const REF_MAX_BYTES = 4 * 1024 * 1024; // 4MB/이미지 — OpenAI edits 하드리밋 + IPC 페이로드 절감
const REF_MAX_DIMENSION = 4096; // 최대 변(px)

/**
 * base64 data URL 이미지를 크기/해상도 한도 안으로 압축. 이미 한도 내면 원본 그대로 반환.
 */
export async function compressImageIfNeeded(dataUrl: string): Promise<string> {
    const base64Part = dataUrl.split(',')[1] || '';
    const estimatedBytes = Math.round((base64Part.length * 3) / 4);

    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const withinBytes = estimatedBytes <= REF_MAX_BYTES;
            const withinDims = img.width <= REF_MAX_DIMENSION && img.height <= REF_MAX_DIMENSION;
            if (withinBytes && withinDims) {
                resolve(dataUrl); // 한도 내 — 원본 유지
                return;
            }
            resolve(resizeAndCompress(img));
        };
        img.onerror = () => resolve(dataUrl); // 폴백: 원본 그대로
        img.src = dataUrl;
    });
}

function resizeAndCompress(img: HTMLImageElement): string {
    let { width, height } = img;

    if (width > REF_MAX_DIMENSION || height > REF_MAX_DIMENSION) {
        const scale = Math.min(REF_MAX_DIMENSION / width, REF_MAX_DIMENSION / height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas.toDataURL('image/jpeg', 0.85);
    ctx.drawImage(img, 0, 0, width, height);

    // JPEG 품질을 낮춰가며 4MB 이하 달성 시도
    for (const q of [0.92, 0.85, 0.75, 0.6, 0.45]) {
        const result = canvas.toDataURL('image/jpeg', q);
        const size = Math.round(((result.split(',')[1]?.length || 0) * 3) / 4);
        if (size <= REF_MAX_BYTES) return result;
    }

    // 최후: 절반으로 추가 축소
    canvas.width = Math.round(width * 0.5);
    canvas.height = Math.round(height * 0.5);
    const ctx2 = canvas.getContext('2d');
    if (ctx2) ctx2.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.7);
}
