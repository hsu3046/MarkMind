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
export type ImageQuality = 'standard' | '2k' | '4k';

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

export interface ImageQualityDef {
    id: ImageQuality;
    label: string;
}

export const IMAGE_QUALITIES: readonly ImageQualityDef[] = [
    { id: 'standard', label: '표준' },
    { id: '2k', label: '2K' },
    { id: '4k', label: '4K' },
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
    prompt: string;
    aspectRatio: string;
    quality: ImageQuality;
    /** base64 data URL 배열. 비우면 텍스트→이미지. */
    referenceImages?: string[];
}

/**
 * 이미지 생성 — provider 에 따라 Rust command 호출. 반환은 base64 data URL 배열(보통 1장).
 * Tauri 가 인자명을 camelCase→snake_case 자동 매핑한다(aspectRatio → aspect_ratio 등).
 */
export async function generateImage(opts: GenerateImageOptions): Promise<string[]> {
    const { provider, prompt, aspectRatio, quality, referenceImages } = opts;
    if (!prompt.trim()) throw new Error('프롬프트를 입력해주세요.');

    const { invoke } = await import('@tauri-apps/api/core');
    const command = provider === 'gemini' ? 'generate_image_gemini' : 'generate_image_openai';
    return invoke<string[]>(command, {
        prompt,
        aspectRatio,
        quality,
        referenceImages: referenceImages ?? [],
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
    if (body.includes('네트워크') || body.includes('network') || body.includes('failed to fetch') || body.includes('timeout') || body.includes('dns'))
        return '네트워크 연결에 실패했습니다. 인터넷 연결을 확인해주세요.';
    if (status >= 500)
        return `${label} 서버에 일시적 오류가 발생했습니다. 잠시 후 다시 시도해주세요.`;
    if (status === 400) {
        if (body.includes('prompt')) return '프롬프트에 문제가 있습니다. 내용을 확인하고 다시 시도해주세요.';
        return `${label} 요청이 거부되었습니다. 설정을 확인해주세요.`;
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
