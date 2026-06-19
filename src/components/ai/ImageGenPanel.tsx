/**
 * 이미지 생성 패널 — AIPanel 의 'image-gen' 모드 본문.
 *
 * 프롬프트(+참조 이미지)로 이미지를 생성 → 패널에 미리보기 → "문서에 삽입" 또는 "파일로 저장".
 * 공급사/모델은 Settings 의 "이미지 AI 모델" 전역 선택을 따른다(기본 AI 모델과 동일 방식 —
 * 패널엔 별도 토글 없음). 키는 기존 Settings(Keychain)를 재사용. 실제 API 호출은 Rust 경유
 * (services/imageGen.ts). 상태는 이 컴포넌트 로컬(diff 흐름 아님).
 *
 * 참조 이미지는 OS 드롭(App onDragDropEvent → refDropped prop)으로만 추가한다 —
 * dragDropEnabled=true 라 webview HTML5 onDrop 이 억제되기 때문(클릭 파일선택 없음).
 */

import { useState, useEffect } from 'react';
import { Loader2, AlertCircle, Sparkles, FileInput, Download, X, ImageIcon } from 'lucide-react';
import { hasKey } from '../../services/secureStorage';
import {
    getImageAIModelSelection,
    setImageAIModelSelection,
    IMAGE_AI_CATALOG,
    resolveUsableSelection,
    type ImageAICompany,
    type AIAuthMode,
} from '../../services/aiModelConfig';
import { InlineModelDropdown } from './InlineModelDropdown';
import { detectSubscriptionLogins } from '../../services/subscriptionService';
import {
    generateImage,
    humanizeImageGenError,
    compressImageIfNeeded,
    ASPECT_RATIOS,
    IMAGE_RESOLUTIONS,
    IMAGE_QUALITIES,
    getPreviewDimensions,
    type ImageResolution,
    type ImageQuality,
} from '../../services/imageGen';
import './ImageGenPanel.css';

interface ImageGenPanelProps {
    /** 생성 이미지를 현재 문서에 삽입(App 이 writeTempImage→커서 삽입). */
    onInsertImage: (dataUrl: string) => void;
    onShowSettings: () => void;
    /** OS 드롭으로 들어온 참조 이미지 경로 배열(App 라우팅). 소비 후 onConsumeRefDropped. */
    refDropped: string[] | null;
    onConsumeRefDropped: () => void;
}

const MAX_REFS = 4;

/** 확장자 → MIME(참조 이미지 readFile 용). */
const EXT_MIME: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    heic: 'image/heic',
    heif: 'image/heif',
};

/** Uint8Array → base64 data URL(큰 파일 stack overflow 회피 위해 청크 처리). */
function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return `data:${mime};base64,${btoa(binary)}`;
}

export function ImageGenPanel({
    onInsertImage,
    onShowSettings,
    refDropped,
    onConsumeRefDropped,
}: ImageGenPanelProps) {
    // 구독 연동(codex) 감지 — 로컬 토큰 확인이라 비동기(state). 텍스트 AI
    // (resolveUsableTextSelection)와 동일 규칙으로 가용성 판정.
    const [subCodex, setSubCodex] = useState(false);
    const [subGrok, setSubGrok] = useState(false);
    const [, bumpSel] = useState(0); // 인라인 드롭다운 모델 변경 시 리렌더 트리거
    useEffect(() => {
        detectSubscriptionLogins()
            .then((s) => {
                setSubCodex(s.codex);
                setSubGrok(s.grok);
            })
            .catch(() => {});
    }, []);

    // 가용성: 구독은 codex(OpenAI)·grok 로그인, API 키는 hasKey.
    const isUsable = (company: ImageAICompany, auth: AIAuthMode): boolean =>
        auth === 'subscription'
            ? (company === 'openai' && subCodex) || (company === 'grok' && subGrok)
            : hasKey(company);

    // 전역 이미지 모델 선택(Settings) — 매 렌더 읽고, 가용한 공급사·방식으로 보정(callAI 와
    // 동일 resolveUsableSelection). 키·구독 둘 다 없으면 원본 유지 → providerUsable=false 안내.
    const imgModel = resolveUsableSelection(IMAGE_AI_CATALOG, getImageAIModelSelection(), isUsable);
    const provider = imgModel.company; // 'gemini' | 'openai' | 'grok'
    const isSubscription = imgModel.auth === 'subscription';
    // 참조 이미지: Gemini·OpenAI(API키)만 지원. 구독(codex)·Grok(imagine)은 미지원 → 숨김.
    const supportsReference = !isSubscription && provider !== 'grok';
    const providerUsable = isUsable(provider, imgModel.auth);

    const [prompt, setPrompt] = useState('');
    const [aspectRatio, setAspectRatio] = useState('1:1');
    const [resolution, setResolution] = useState<ImageResolution>('1K');
    const [quality, setQuality] = useState<ImageQuality>('high'); // OpenAI 전용
    const [refs, setRefs] = useState<string[]>([]);
    const [status, setStatus] = useState<'idle' | 'generating' | 'done' | 'error'>('idle');
    const [result, setResult] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    // 참조 이미지 드롭 소비: 경로 → readFile → dataUrl → 압축 → refs 추가.
    useEffect(() => {
        if (!refDropped || refDropped.length === 0) return;
        let cancelled = false;
        (async () => {
            try {
                const { readFile } = await import('@tauri-apps/plugin-fs');
                const added: string[] = [];
                for (const path of refDropped) {
                    const ext = path.split('.').pop()?.toLowerCase() ?? 'png';
                    const mime = EXT_MIME[ext] ?? 'image/png';
                    const bytes = await readFile(path);
                    const dataUrl = bytesToDataUrl(bytes, mime);
                    added.push(await compressImageIfNeeded(dataUrl));
                }
                if (!cancelled && added.length > 0) {
                    setRefs((prev) => [...prev, ...added].slice(0, MAX_REFS));
                }
            } catch (err) {
                console.error('[ImageGenPanel] 참조 이미지 읽기 실패:', err);
            } finally {
                if (!cancelled) onConsumeRefDropped();
            }
        })();
        return () => {
            cancelled = true;
        };
        // refDropped 변경 시에만 — refs 는 setRefs(prev) 로 최신 반영(stale 무관).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refDropped]);

    const handleGenerate = async () => {
        if (!providerUsable) {
            onShowSettings();
            return;
        }
        if (!prompt.trim() || status === 'generating') return;
        setStatus('generating');
        setError(null);
        setResult(null);
        try {
            const urls = await generateImage({
                provider,
                auth: imgModel.auth,
                model: imgModel.model,
                prompt: prompt.trim(),
                aspectRatio,
                resolution,
                quality: provider === 'openai' ? quality : undefined,
                // 구독(codex) 경로는 참조 이미지 미지원(1차) → 빈 배열.
                referenceImages: supportsReference ? refs : [],
            });
            if (urls.length === 0) throw new Error('이미지를 생성하지 못했습니다.');
            setResult(urls[0]);
            setStatus('done');
        } catch (err) {
            setError(humanizeImageGenError(err, provider));
            setStatus('error');
        }
    };

    const handleSaveFile = async () => {
        if (!result || saving) return;
        setSaving(true);
        try {
            const [{ save }, { writeFile }] = await Promise.all([
                import('@tauri-apps/plugin-dialog'),
                import('@tauri-apps/plugin-fs'),
            ]);
            const path = await save({
                defaultPath: `markmind-image-${Date.now()}.png`,
                filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
            });
            if (!path) return;
            const b64 = result.split(',')[1] ?? '';
            const raw = atob(b64);
            const bytes = new Uint8Array(raw.length);
            for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
            await writeFile(path, bytes);
        } catch (err) {
            console.error('[ImageGenPanel] 파일 저장 실패:', err);
            setError('파일 저장에 실패했습니다.');
        } finally {
            setSaving(false);
        }
    };

    const removeRef = (idx: number) => setRefs((prev) => prev.filter((_, i) => i !== idx));

    return (
        <div className="imggen">
            {/* 현재 이미지 모델 — 인라인 드롭다운으로 즉시 전환(가용 모델만) */}
            <InlineModelDropdown
                label="이미지 모델"
                catalog={IMAGE_AI_CATALOG}
                selection={imgModel}
                onChange={(s) => {
                    setImageAIModelSelection(s);
                    bumpSel((n) => n + 1);
                }}
                isUsable={isUsable}
            />

            {!providerUsable ? (
                <div className="ai-no-key">
                    <AlertCircle size={20} />
                    <p>
                        {isSubscription
                            ? provider === 'grok'
                                ? 'Grok 구독 로그인을 연결해주세요 (터미널에서 grok login, 유료 SuperGrok 필요)'
                                : 'ChatGPT 구독 로그인을 연결해주세요 (터미널에서 codex 로그인)'
                            : `${IMAGE_AI_CATALOG[provider].label} API 키를 설정해주세요`}
                    </p>
                    <button className="ai-btn primary" onClick={onShowSettings}>
                        설정하기
                    </button>
                </div>
            ) : (
                <>
                    {/* 프롬프트 */}
                    <div className="ai-prompt-area">
                        <textarea
                            className="ai-prompt-input"
                            placeholder="생성할 이미지를 설명하세요... (예: 노을 진 해변의 수채화)"
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            rows={4}
                        />
                    </div>

                    {/* 참조 이미지 (드롭으로 추가) — 구독(codex)·Grok(imagine)은 미지원이라 숨김 */}
                    {supportsReference && (
                        <div className="imggen-section">
                            <div className="imggen-label">
                                참조 이미지 <span className="imggen-label-hint">선택 · 드래그해서 추가</span>
                            </div>
                            <div className="imggen-refs">
                                {refs.map((src, i) => (
                                    <div key={i} className="imggen-ref">
                                        <img src={src} alt={`참조 ${i + 1}`} />
                                        <button
                                            className="imggen-ref-remove"
                                            onClick={() => removeRef(i)}
                                            title="참조 이미지 제거"
                                        >
                                            <X size={11} />
                                        </button>
                                    </div>
                                ))}
                                {refs.length < MAX_REFS && (
                                    <div className="imggen-ref-drop">
                                        <ImageIcon size={16} />
                                        <span>여기로 드롭</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* 비율 */}
                    <div className="imggen-section">
                        <div className="imggen-label">비율</div>
                        <div className="imggen-aspects">
                            {ASPECT_RATIOS.map((r) => {
                                const { w, h } = getPreviewDimensions(r.id);
                                return (
                                    <button
                                        key={r.id}
                                        className={`imggen-aspect${aspectRatio === r.id ? ' active' : ''}`}
                                        onClick={() => setAspectRatio(r.id)}
                                        title={r.desc}
                                    >
                                        <span className="imggen-aspect-box" style={{ width: w, height: h }} />
                                        <span className="imggen-aspect-label">{r.label}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* 해상도 — Gemini imageSize / OpenAI(API키) size 환산. 구독(codex)은
                        size 3종 고정(비율로 매핑)이라 미사용 → 숨김. */}
                    {!isSubscription && (
                        <div className="imggen-section">
                            <div className="imggen-label">해상도</div>
                            <div className="imggen-qualities">
                                {IMAGE_RESOLUTIONS.map((r) => (
                                    <button
                                        key={r.id}
                                        className={`imggen-quality${resolution === r.id ? ' active' : ''}`}
                                        onClick={() => setResolution(r.id)}
                                    >
                                        {r.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* 품질 — OpenAI API 키 전용. 구독(codex)은 quality 가 무시되어 숨김 */}
                    {provider === 'openai' && !isSubscription && (
                        <div className="imggen-section">
                            <div className="imggen-label">품질</div>
                            <div className="imggen-qualities">
                                {IMAGE_QUALITIES.map((q) => (
                                    <button
                                        key={q.id}
                                        className={`imggen-quality${quality === q.id ? ' active' : ''}`}
                                        onClick={() => setQuality(q.id)}
                                    >
                                        {q.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* 생성 버튼 */}
                    <div className="ai-prompt-actions">
                        <button
                            className="ai-btn primary"
                            onClick={handleGenerate}
                            disabled={status === 'generating' || !prompt.trim()}
                            title="이미지 생성"
                        >
                            {status === 'generating' ? (
                                <Loader2 size={14} className="spinning" />
                            ) : (
                                <Sparkles size={14} />
                            )}
                            {status === 'generating' ? '생성 중...' : '이미지 생성'}
                        </button>
                    </div>

                    {error && (
                        <div className="ai-error">
                            <AlertCircle size={14} />
                            {error}
                        </div>
                    )}

                    {/* 결과 미리보기 + 삽입/저장 */}
                    {result && (
                        <div className="imggen-result">
                            <img className="imggen-result-img" src={result} alt="생성된 이미지" />
                            <div className="imggen-result-actions">
                                <button className="ai-btn primary" onClick={() => onInsertImage(result)}>
                                    <FileInput size={14} /> 문서에 삽입
                                </button>
                                <button
                                    className="ai-btn secondary"
                                    onClick={handleSaveFile}
                                    disabled={saving}
                                >
                                    {saving ? <Loader2 size={14} className="spinning" /> : <Download size={14} />}
                                    파일로 저장
                                </button>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
