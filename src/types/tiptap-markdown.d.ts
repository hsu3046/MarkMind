/**
 * tiptap-markdown / tiptap-search-and-replace extension 의 storage 타입 보강.
 * 패키지 자체가 storage 타입을 export 안 해 매번 @ts-expect-error 캐스팅하던 것을 정리.
 */

import '@tiptap/core';

declare module '@tiptap/core' {
    interface Storage {
        markdown?: {
            getMarkdown(): string;
        };
        searchAndReplace?: {
            results?: unknown[];
            resultIndex?: number;
        };
    }
}
