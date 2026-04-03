/**
 * LoginButton — KnowAI SSO login/user display component.
 *
 * - Logged out: Shows "로그인" button with icon
 * - Loading: Shows spinner
 * - Logged in: Shows avatar + name, with dropdown for balance + logout
 */

import { useState, useRef, useEffect } from 'react';
import { LogIn, LogOut, ChevronDown, Coins } from 'lucide-react';
import type { AuthUser } from '../types/auth';

interface LoginButtonProps {
    user: AuthUser | null;
    isLoading: boolean;
    onLogin: () => void;
    onLogout: () => void;
}

export function LoginButton({ user, isLoading, onLogin, onLogout }: LoginButtonProps) {
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    // Close menu on outside click
    useEffect(() => {
        if (!menuOpen) return;
        const handler = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [menuOpen]);

    // Loading state
    if (isLoading) {
        return (
            <div className="login-btn-wrapper">
                <div className="login-btn-loading" />
            </div>
        );
    }

    // Logged out
    if (!user) {
        return (
            <button className="toolbar-text-btn login-btn" onClick={onLogin} title="KnowAI로 로그인">
                <LogIn size={14} strokeWidth={1.5} />
                <span>로그인</span>
            </button>
        );
    }

    // Logged in — show avatar + dropdown
    return (
        <div className="login-user-wrapper" ref={menuRef}>
            <button
                className={`toolbar-text-btn login-user-btn${menuOpen ? ' active' : ''}`}
                onClick={() => setMenuOpen((v) => !v)}
            >
                {user.avatar ? (
                    <img src={user.avatar} alt={user.name} className="login-user-avatar" />
                ) : (
                    <div className="login-user-avatar-fallback">
                        {user.name.charAt(0).toUpperCase()}
                    </div>
                )}
                <span className="login-user-name">{user.name}</span>
                <ChevronDown size={12} strokeWidth={1.5} />
            </button>

            {menuOpen && (
                <div className="login-user-menu">
                    <div className="login-user-menu-info">
                        <div className="login-user-menu-balance">
                            <Coins size={14} strokeWidth={1.5} />
                            <span>{user.balance.toLocaleString()} 크레딧</span>
                        </div>
                    </div>
                    <div className="dropdown-divider" />
                    <button
                        className="dropdown-item"
                        onClick={() => {
                            setMenuOpen(false);
                            onLogout();
                        }}
                    >
                        <LogOut size={14} strokeWidth={1.5} />
                        <span>로그아웃</span>
                    </button>
                </div>
            )}
        </div>
    );
}
