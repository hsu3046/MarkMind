/**
 * 회의록 작성 모드 옵션 — 템플릿 select + 사용자 정의 폴더 열기.
 */

import { useEffect, useState } from 'react';
import { Plus, FolderOpen } from 'lucide-react';
import type { TemplateInfo } from '../../types/converter';

interface NotesOptionsProps {
    selectedTemplate: string;
    onChange: (id: string) => void;
    loadTemplates: () => Promise<TemplateInfo[]>;
}

export function NotesOptions({ selectedTemplate, onChange, loadTemplates }: NotesOptionsProps) {
    const [templates, setTemplates] = useState<TemplateInfo[]>([]);

    useEffect(() => {
        let cancelled = false;
        loadTemplates()
            .then((list) => {
                if (cancelled) return;
                setTemplates(list);
                if (list.length > 0 && !list.find((t) => t.id === selectedTemplate)) {
                    onChange(list[0].id);
                }
            })
            .catch((err) => console.warn('[NotesOptions] 템플릿 로드 실패:', err));
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadTemplates]);

    const handleOpenFolder = async () => {
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('open_user_templates_folder');
            setTimeout(async () => {
                try {
                    const list = await loadTemplates();
                    setTemplates(list);
                } catch {}
            }, 1500);
        } catch (err) {
            console.error('[NotesOptions] 폴더 열기 실패:', err);
            alert('폴더 열기 실패: ' + err);
        }
    };

    return (
        <div className="ai-notes-options">
            <div className="ai-notes-field">
                <label>템플릿</label>
                <select value={selectedTemplate} onChange={(e) => onChange(e.target.value)}>
                    {templates.length === 0 && (
                        <option value="general">general (로딩 중...)</option>
                    )}
                    {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                            {t.name} {t.source === 'user' ? '(내 템플릿)' : ''}
                        </option>
                    ))}
                </select>
            </div>
            <button className="ai-template-add-btn" onClick={handleOpenFolder}>
                <Plus size={13} /> <FolderOpen size={13} /> 내 템플릿 폴더 열기
            </button>
        </div>
    );
}
