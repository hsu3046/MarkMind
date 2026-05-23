/**
 * 통합 Settings 모달 — STT/OCR/AI 에이전트의 API 키를 한 곳에서 관리.
 * SettingsView (convert/SettingsView.tsx) 재사용.
 */

import { SettingsView } from './convert/SettingsView';
import { X } from 'lucide-react';

interface SettingsModalProps {
    visible: boolean;
    onClose: () => void;
}

export function SettingsModal({ visible, onClose }: SettingsModalProps) {
    if (!visible) return null;

    return (
        <>
            <div className="settings-modal-backdrop" onClick={onClose} aria-hidden />
            <div className="settings-modal" role="dialog" aria-modal="true">
                <div className="settings-modal-header">
                    <span className="settings-modal-title">Settings</span>
                    <button
                        className="settings-modal-close"
                        onClick={onClose}
                        title="닫기 (Esc)"
                        aria-label="설정 닫기"
                    >
                        <X size={18} />
                    </button>
                </div>
                <p className="settings-modal-note">입력한 정보는 본인 컴퓨터에만 저장됩니다.</p>
                <div className="settings-modal-body">
                    <SettingsView onDone={onClose} />
                </div>
            </div>
        </>
    );
}
