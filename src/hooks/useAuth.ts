/**
 * useAuth — React hook for KnowAI SSO authentication state.
 *
 * Implements the dual-storage strategy from EXTERNAL_API.md §1.9:
 *   1st: Load user from sessionStorage instantly (for UI)
 *   2nd: Background refresh from /api/x/me (for latest balance)
 */

import { useState, useCallback, useEffect } from 'react';
import type { AuthUser, AuthState } from '../types/auth';
import {
    startLogin,
    handleCallback,
    fetchUserInfo,
    getStoredUser,
    hasStoredSession,
    logout as authLogout,
    getCallbackPath,
} from '../services/knowaiAuth';

interface UseAuth extends AuthState {
    login: () => Promise<void>;
    logout: () => void;
    processCallback: (code: string, state: string) => Promise<AuthUser>;
}

export function useAuth(): UseAuth {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // ── Initialize: restore session on mount ──
    useEffect(() => {
        // Skip if we're on the callback page
        if (window.location.pathname === getCallbackPath()) {
            setIsLoading(false);
            return;
        }

        const restoreSession = async () => {
            // 1st: Instant load from sessionStorage
            const storedUser = getStoredUser();
            if (storedUser) {
                setUser(storedUser);
                setIsLoading(false);

                // 2nd: Background refresh for latest data
                fetchUserInfo()
                    .then((freshUser) => {
                        if (freshUser) setUser(freshUser);
                    })
                    .catch(() => {
                        // Silent fail — keep stored user
                    });
                return;
            }

            // No stored user, but maybe has refresh token
            if (hasStoredSession()) {
                const freshUser = await fetchUserInfo();
                if (freshUser) {
                    setUser(freshUser);
                } else {
                    // Refresh failed — session expired
                    authLogout();
                }
            }

            setIsLoading(false);
        };

        restoreSession();
    }, []);

    // ── Login: redirect to KnowAI authorize ──
    const login = useCallback(async () => {
        await startLogin();
    }, []);

    // ── Process OAuth callback ──
    const processCallback = useCallback(async (code: string, state: string): Promise<AuthUser> => {
        setIsLoading(true);
        try {
            const authUser = await handleCallback(code, state);
            setUser(authUser);
            return authUser;
        } finally {
            setIsLoading(false);
        }
    }, []);

    // ── Logout ──
    const logout = useCallback(() => {
        authLogout();
        setUser(null);
    }, []);

    return {
        user,
        isLoading,
        isLoggedIn: !!user,
        login,
        logout,
        processCallback,
    };
}
