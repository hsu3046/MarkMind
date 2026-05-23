/**
 * Convert 사이드바 공통 래퍼 — AIPanel 과 동일한 위치/디자인.
 * 안에 AudioTab / NotesTab / OcrTab 중 하나를 mount.
 *
 * 키 설정은 각 탭 내부에서 처리 (변환 시작 시 keychain 검증).
 */

import { ReactNode, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { initSecureStorage } from '../../services/secureStorage';

interface ConvertSidebarProps {
    visible: boolean;
    title: string;
    icon: ReactNode;
    onClose: () => void;
    children: ReactNode;
}

export function ConvertSidebar({
    visible,
    title,
    icon,
    onClose,
    children,
}: ConvertSidebarProps) {
    const [keysReady, setKeysReady] = useState(false);

    useEffect(() => {
        if (!visible) return;
        let cancelled = false;
        (async () => {
            await initSecureStorage();
            if (!cancelled) setKeysReady(true);
        })();
        return () => {
            cancelled = true;
        };
    }, [visible]);

    if (!visible) return null;

    return (
        <div className="convert-sidebar">
            <div className="convert-sidebar-header">
                <span className="convert-sidebar-title">
                    {icon}
                    {title}
                </span>
                <button
                    className="convert-sidebar-icon-btn"
                    onClick={onClose}
                    title="닫기"
                >
                    <X size={14} />
                </button>
            </div>
            <div className="convert-sidebar-body">
                {!keysReady ? (
                    <div className="convert-sidebar-loading">로딩 중...</div>
                ) : (
                    children
                )}
            </div>
        </div>
    );
}
