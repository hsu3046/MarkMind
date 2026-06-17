/**
 * 로컬 이미지 표시용 Tiptap Image 확장 (#55).
 *
 * 핵심: `node.attrs.src` 에는 **원본 경로**(`./assets/a.png` 등)를 그대로 보존하고,
 * DOM 렌더(renderHTML)에서만 `resolveImageSrc` 로 asset:// URL 로 바꿔 표시한다.
 * tiptap-markdown(prosemirror-markdown) 직렬화는 `node.attrs.src` 를 직접 쓰므로
 * 저장 시 `![](원본경로)` 로 라운드트립 무손실.
 *
 * docDir 은 파일 전환 시 바뀌므로 정적 옵션 대신 getter 클로저로 최신값을 읽는다
 * (editor 재생성 불필요 → undo 히스토리 보존).
 */
import { Image } from '@tiptap/extension-image';
import { resolveImageSrc } from '../lib/imageSrc';

export function createImageInline(getDocDir: () => string | null) {
    return Image.extend({
        addAttributes() {
            return {
                ...this.parent?.(),
                src: {
                    default: null,
                    // data-src(보존본) 우선 — 재파싱(복사/붙여넣기) 시에도 원본 유지.
                    parseHTML: (el) => el.getAttribute('data-src') || el.getAttribute('src'),
                    // DOM 표시는 asset:// 변환, 원본은 data-src 에 보존.
                    renderHTML: (attrs) => {
                        const original = attrs.src as string | null;
                        if (!original) return {};
                        return {
                            src: resolveImageSrc(original, getDocDir()),
                            'data-src': original,
                        };
                    },
                },
            };
        },
    }).configure({ allowBase64: true });
}
