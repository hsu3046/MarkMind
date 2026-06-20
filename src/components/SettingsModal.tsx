/**
 * 통합 Settings 모달 — API 키 / AI 모델 / 뷰어 설정 / 추가 기능을 한 곳에서 관리.
 * SettingsView (convert/SettingsView.tsx) 재사용.
 */

import { SettingsView, type ViewerSettings } from './convert/SettingsView';
import { X } from 'lucide-react';

interface SettingsModalProps {
    visible: boolean;
    onClose: () => void;
    /** 뷰어 설정(폰트크기/행간/배경/본문폰트/읽기폭) — App 상태를 뷰어 설정 탭으로 전달. */
    viewer: ViewerSettings;
}

export function SettingsModal({ visible, onClose, viewer }: SettingsModalProps) {
    if (!visible) return null;

    return (
        <>
            <div className="settings-modal-backdrop" onClick={onClose} aria-hidden />
            <div className="settings-modal" role="dialog" aria-modal="true">
                <div className="settings-modal-header">
                    <span className="settings-modal-title">Settings</span>
                    <button
                        className="modal-close"
                        onClick={onClose}
                        title="닫기 (Esc)"
                        aria-label="설정 닫기"
                    >
                        <X size={18} />
                    </button>
                </div>
                <div className="settings-modal-body">
                    <SettingsView onDone={onClose} viewer={viewer} />
                </div>
            </div>
        </>
    );
}
