import { useState, useEffect, useCallback } from 'react';

type Theme = 'light' | 'dark';

const LS_THEME_KEY = 'md-editor-theme'; // 사용자가 명시적으로 토글한 경우만 저장

export function useTheme() {
    const [theme, setThemeState] = useState<Theme>(() => {
        if (typeof window === 'undefined') return 'light';
        const saved = localStorage.getItem(LS_THEME_KEY);
        if (saved === 'light' || saved === 'dark') return saved;
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    });

    // DOM data-theme 항상 갱신
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
    }, [theme]);

    // OS prefers-color-scheme 변경 — localStorage 명시 저장 안 했을 때만 따라감
    useEffect(() => {
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const handler = (e: MediaQueryListEvent) => {
            if (!localStorage.getItem(LS_THEME_KEY)) {
                setThemeState(e.matches ? 'dark' : 'light');
            }
        };
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, []);

    /** 명시적 토글 — localStorage 저장 (OS follow 모드 해제) */
    const toggleTheme = useCallback(() => {
        setThemeState((prev) => {
            const next = prev === 'light' ? 'dark' : 'light';
            localStorage.setItem(LS_THEME_KEY, next);
            return next;
        });
    }, []);

    /** in-memory 만 변경 — bgColor 자동 동기화용. localStorage 안 건드림 → 다음 세션 OS follow 유지 */
    const setThemeTransient = useCallback((next: Theme) => {
        setThemeState(next);
    }, []);

    /** OS prefers-color-scheme 으로 복귀 + localStorage 의 명시 저장 삭제 */
    const resetThemeToOS = useCallback(() => {
        localStorage.removeItem(LS_THEME_KEY);
        const next = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        setThemeState(next);
    }, []);

    return { theme, toggleTheme, setThemeTransient, resetThemeToOS };
}
