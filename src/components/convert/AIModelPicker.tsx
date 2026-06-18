/**
 * 모델 선택 picker — 회사 → 방식 → 모델 단계형 (controlled).
 * 카탈로그(prop)를 그대로 읽어 렌더하므로 회사가 늘면 자동 확장된다.
 * 텍스트(AI_CATALOG)·이미지(IMAGE_AI_CATALOG) 모두 이 컴포넌트를 재사용한다.
 * 방식(인증) 단계는 회사가 2가지 이상 방식을 지원할 때만 노출(API 키만이면 숨김).
 */

import { AICompanyDef, AIAuthMode, normalizeWithCatalog } from '../../services/aiModelConfig';

export interface ModelPickerSelection<C extends string = string> {
    company: C;
    auth: AIAuthMode;
    model: string;
}

interface AIModelPickerProps<C extends string> {
    /** 섹션 제목 (예: "기본 AI 모델" / "이미지 AI 모델"). */
    title: string;
    catalog: Record<C, AICompanyDef>;
    selection: ModelPickerSelection<C>;
    onChange: (next: ModelPickerSelection<C>) => void;
    /** 회사별 구독(OAuth) 가용 여부. 미제공 시 구독은 항상 비활성. */
    subscriptionAvailable?: (company: C) => boolean;
}

export function AIModelPicker<C extends string>({
    title,
    catalog,
    selection,
    onChange,
    subscriptionAvailable,
}: AIModelPickerProps<C>) {
    const apply = (next: Partial<ModelPickerSelection<C>>) =>
        onChange(normalizeWithCatalog(catalog, { ...selection, ...next }));

    const def = catalog[selection.company];
    const models = def.models[selection.auth] ?? [];

    const subAvailable = (company: C): boolean => subscriptionAvailable?.(company) ?? false;
    const authEnabled = (auth: AIAuthMode): boolean =>
        auth === 'api_key' ? true : subAvailable(selection.company);
    const authLabel = (auth: AIAuthMode): string => (auth === 'api_key' ? 'API 키' : '구독 OAuth');

    return (
        <section className="convert-settings-section">
            <label>{title}</label>

            {/* 회사 */}
            <div className="ai-model-row">
                <span className="ai-model-key">회사</span>
                <div className="ai-seg">
                    {(Object.keys(catalog) as C[]).map((key) => (
                        <button
                            key={key}
                            type="button"
                            className={`ai-seg-btn${selection.company === key ? ' active' : ''}`}
                            onClick={() => apply({ company: key })}
                        >
                            {catalog[key].label}
                        </button>
                    ))}
                </div>
            </div>

            {/* 방식 — 둘 이상 지원하는 회사에서만 노출 */}
            {def.auths.length > 1 && (
                <div className="ai-model-row">
                    <span className="ai-model-key">방식</span>
                    <div className="ai-seg">
                        {def.auths.map((auth) => (
                            <button
                                key={auth}
                                type="button"
                                className={`ai-seg-btn${selection.auth === auth ? ' active' : ''}`}
                                disabled={!authEnabled(auth)}
                                onClick={() => apply({ auth })}
                            >
                                {authLabel(auth)}
                                {auth === 'subscription' && !subAvailable(selection.company) ? ' (미연결)' : ''}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* 모델 */}
            <div className="ai-model-row">
                <span className="ai-model-key">모델</span>
                <select value={selection.model} onChange={(e) => apply({ model: e.target.value })}>
                    {models.map((m) => (
                        <option key={m.id} value={m.id}>
                            {m.label}
                        </option>
                    ))}
                </select>
            </div>
        </section>
    );
}
