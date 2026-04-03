/**
 * AuthCallback — Handles the OAuth callback redirect.
 *
 * This component is rendered when the URL contains /auth/callback.
 * It extracts the authorization code and state from URL params,
 * processes the token exchange, and signals completion.
 */

import { useEffect, useState } from 'react';
import type { AuthUser } from '../types/auth';

interface AuthCallbackProps {
    onSuccess: (user: AuthUser) => void;
    onError: (error: string) => void;
    processCallback: (code: string, state: string) => Promise<AuthUser>;
}

export function AuthCallback({ onSuccess, onError, processCallback }: AuthCallbackProps) {
    const [status, setStatus] = useState<'processing' | 'error'>('processing');
    const [errorMessage, setErrorMessage] = useState('');

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        const state = params.get('state');
        const error = params.get('error');

        if (error) {
            setStatus('error');
            setErrorMessage(`인증 실패: ${error}`);
            onError(error);
            return;
        }

        if (!code || !state) {
            setStatus('error');
            setErrorMessage('인증 정보가 누락되었습니다.');
            onError('missing_params');
            return;
        }

        processCallback(code, state)
            .then((user) => {
                // Clean up URL (remove query params)
                window.history.replaceState({}, '', '/');
                onSuccess(user);
            })
            .catch((err) => {
                setStatus('error');
                const msg = err instanceof Error ? err.message : '인증 처리 중 오류가 발생했습니다.';
                setErrorMessage(msg);
                onError(msg);
            });
    }, [onSuccess, onError, processCallback]);

    return (
        <div className="auth-callback-overlay">
            <div className="auth-callback-card">
                {status === 'processing' ? (
                    <>
                        <div className="auth-callback-spinner" />
                        <p className="auth-callback-text">로그인 처리 중...</p>
                    </>
                ) : (
                    <>
                        <div className="auth-callback-error-icon">!</div>
                        <p className="auth-callback-text">{errorMessage}</p>
                        <button
                            className="auth-callback-retry"
                            onClick={() => {
                                window.history.replaceState({}, '', '/');
                                window.location.reload();
                            }}
                        >
                            다시 시도
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}
