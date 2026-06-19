/**
 * 모델 선택 picker — 회사 → 방식 → 모델 단계형 (controlled).
 * 카탈로그(prop)를 그대로 읽어 렌더하므로 회사가 늘면 자동 확장된다.
 * 텍스트(AI_CATALOG)·이미지(IMAGE_AI_CATALOG) 모두 이 컴포넌트를 재사용한다.
 * 방식(인증) 단계는 회사가 2가지 이상 방식을 지원할 때만 노출(API 키만이면 숨김).
 */

import { useEffect } from 'react';
import {
    AICompanyDef,
    AIAuthMode,
    COMPANY_LOGO,
    normalizeWithCatalog,
    resolveUsableSelection,
} from '../../services/aiModelConfig';

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
    /** 회사별 API 키 보유 여부. 미제공 시 항상 보유로 간주. */
    apiKeyAvailable?: (company: C) => boolean;
    /** 회사별 구독(OAuth) 가용 여부. 미제공 시 구독은 항상 비활성. */
    subscriptionAvailable?: (company: C) => boolean;
}

export function AIModelPicker<C extends string>({
    title,
    catalog,
    selection,
    onChange,
    apiKeyAvailable,
    subscriptionAvailable,
}: AIModelPickerProps<C>) {
    const apply = (next: Partial<ModelPickerSelection<C>>) =>
        onChange(normalizeWithCatalog(catalog, { ...selection, ...next }));

    const def = catalog[selection.company];
    const models = def.models[selection.auth] ?? [];

    const apiKeyAvail = (company: C): boolean => apiKeyAvailable?.(company) ?? true;
    const subAvailable = (company: C): boolean => subscriptionAvailable?.(company) ?? false;
    // 특정 회사+방식이 실제 사용 가능한지(API 키 보유 / 구독 연동). 카탈로그 유효성과 별개.
    const authUsable = (company: C, auth: AIAuthMode): boolean =>
        auth === 'subscription' ? subAvailable(company) : apiKeyAvail(company);
    const authEnabled = (auth: AIAuthMode): boolean => authUsable(selection.company, auth);
    const authLabel = (auth: AIAuthMode): string => (auth === 'api_key' ? 'API 키' : '구독 OAuth');

    // 회사 버튼 활성 = 그 회사가 지원하는 인증(API 키/구독) 중 하나라도 사용 가능할 때.
    // 둘 다 없으면 disabled — AI 등록 탭에서 키 등록 또는 구독 연동이 필요.
    const companyEnabled = (company: C): boolean =>
        catalog[company].auths.some((auth) => authUsable(company, auth));
    const companyTitle = (company: C): string | undefined => {
        if (companyEnabled(company)) return undefined;
        const def = catalog[company];
        return def.auths.includes('subscription')
            ? `${def.label} API 키 또는 구독 연동이 필요합니다`
            : `${def.label} API 키가 필요합니다`;
    };

    // 저장된 선택이 현재 사용 불가하면(키 삭제·구독만 있음 등) 가용한 회사·방식으로 자동 보정.
    // 예: 구독만 있는 Claude 가 'api_key' 로 저장돼 있으면 → 'subscription'(구독 OAuth)로 교정.
    // callAI 와 동일한 resolveUsableSelection 으로 보정(가용 회사 전무면 그대로 — 키 등록 안내).
    useEffect(() => {
        const next = resolveUsableSelection(catalog, selection, authUsable);
        if (next !== selection) onChange(next);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selection, apiKeyAvailable, subscriptionAvailable, catalog]);

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
                            // 비가용(키·구독 없음) 회사는 active 강조하지 않음 — 선택된 듯 보이지 않게.
                            className={`ai-seg-btn${selection.company === key && companyEnabled(key) ? ' active' : ''}`}
                            disabled={!companyEnabled(key)}
                            title={companyTitle(key)}
                            onClick={() => apply({ company: key })}
                        >
                            <img className="ai-seg-logo" src={COMPANY_LOGO[key]} alt="" />
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

            {/* 모델 — 현재 회사가 비가용이면 선택 불가(disabled) */}
            <div className="ai-model-row">
                <span className="ai-model-key">모델</span>
                <div className="ai-model-select-wrap">
                    <img
                        className="ai-model-select-logo"
                        src={COMPANY_LOGO[selection.company]}
                        alt=""
                    />
                    <select
                        className="ai-model-select-logoed"
                        value={selection.model}
                        disabled={!companyEnabled(selection.company)}
                        onChange={(e) => apply({ model: e.target.value })}
                    >
                        {models.map((m) => (
                            <option key={m.id} value={m.id}>
                                {m.label}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            {/* 가용한 회사가 하나도 없으면(키·구독 전무) 안내 — 이미지 AI 가 키 없을 때 등 */}
            {!(Object.keys(catalog) as C[]).some(companyEnabled) && (
                <p className="convert-key-note">AI 등록 탭에서 설정 후 사용할 수 있습니다.</p>
            )}
        </section>
    );
}
