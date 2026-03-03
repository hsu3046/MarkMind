import { useRef, useCallback, useEffect, useState } from 'react';

export function useScrollSync(enabled: boolean) {
    const [syncEnabled, setSyncEnabled] = useState(enabled);
    const isSyncing = useRef(false);
    const rafId = useRef(0);
    const editorScrollerRef = useRef<HTMLElement | null>(null);
    const previewScrollerRef = useRef<HTMLElement | null>(null);

    // Acquire DOM references
    const attachRefs = useCallback(() => {
        editorScrollerRef.current = document.querySelector('.pane-editor .cm-scroller');
        previewScrollerRef.current = document.querySelector('.pane:not(.pane-editor) .preview-wrapper');
    }, []);

    const syncScroll = useCallback((source: 'editor' | 'preview') => {
        if (!syncEnabled || isSyncing.current) return;

        const editor = editorScrollerRef.current;
        const preview = previewScrollerRef.current;
        if (!editor || !preview) return;

        isSyncing.current = true;

        const srcEl = source === 'editor' ? editor : preview;
        const tgtEl = source === 'editor' ? preview : editor;

        const maxScroll = srcEl.scrollHeight - srcEl.clientHeight;
        const ratio = maxScroll > 0 ? srcEl.scrollTop / maxScroll : 0;

        const targetMaxScroll = tgtEl.scrollHeight - tgtEl.clientHeight;
        const targetScrollTop = ratio * targetMaxScroll;

        cancelAnimationFrame(rafId.current);
        rafId.current = requestAnimationFrame(() => {
            tgtEl.scrollTop = targetScrollTop;
            // Release lock after a short delay to prevent feedback loop
            setTimeout(() => {
                isSyncing.current = false;
            }, 50);
        });
    }, [syncEnabled]);

    // Set up scroll listeners
    useEffect(() => {
        attachRefs();

        const handleEditorScroll = () => syncScroll('editor');
        const handlePreviewScroll = () => syncScroll('preview');

        const editor = editorScrollerRef.current;
        const preview = previewScrollerRef.current;

        if (editor) editor.addEventListener('scroll', handleEditorScroll, { passive: true });
        if (preview) preview.addEventListener('scroll', handlePreviewScroll, { passive: true });

        return () => {
            if (editor) editor.removeEventListener('scroll', handleEditorScroll);
            if (preview) preview.removeEventListener('scroll', handlePreviewScroll);
            cancelAnimationFrame(rafId.current);
        };
    }, [syncScroll, attachRefs]);

    // Re-attach when DOM changes (e.g. view mode switch)
    const reattach = useCallback(() => {
        // Small delay to let React render the new elements
        setTimeout(() => attachRefs(), 100);
    }, [attachRefs]);

    const toggleSync = useCallback(() => {
        setSyncEnabled((prev) => !prev);
    }, []);

    return { syncEnabled, toggleSync, reattach };
}
