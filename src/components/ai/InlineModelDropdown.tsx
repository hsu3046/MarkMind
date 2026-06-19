/**
 * 인라인 모델 드롭다운 — AIPanel 각 모드에서 Settings 왕복 없이 바로 모델을 전환.
 *
 * 가용 모델(키 등록 or 구독 연결)만 플랫 리스트로 나열한다. 각 항목은 회사 로고(public/)
 * + 모델명 + 구독 배지로 구성. 선택 시 onChange 로 전역 선택을 갱신하고 부모가 리렌더한다.
 *
 * 드롭다운 외부 탭 닫기는 투명 backdrop div 방식만 사용(iOS/WKWebView 에서 신뢰 가능 —
 * document mousedown 리스너는 비인터랙티브 요소 탭 시 버블링 안 됨).
 */

import { useMemo, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { COMPANY_LOGO, type AIAuthMode, type AICompanyDef } from '../../services/aiModelConfig';
import './InlineModelDropdown.css';

interface Selection<C extends string> {
    company: C;
    auth: AIAuthMode;
    model: string;
}

interface InlineModelDropdownProps<C extends string> {
    /** 회사→인증→모델 카탈로그 (AI_CATALOG 또는 IMAGE_AI_CATALOG). */
    catalog: Record<C, AICompanyDef>;
    /** 현재 선택(가용성 보정 후). */
    selection: Selection<C>;
    /** 선택 변경 — 전역 setter 호출 + 부모 리렌더. */
    onChange: (sel: Selection<C>) => void;
    /** (company, auth) 가용 여부 — 키 등록 or 구독 연결. */
    isUsable: (company: C, auth: AIAuthMode) => boolean;
    /** 트리거 앞 라벨 (예: "이미지 모델", "AI 모델"). */
    label: string;
}

interface Item<C extends string> {
    company: C;
    auth: AIAuthMode;
    model: string;
    /** 모델명(라벨). 구독 표시는 별도 배지로. */
    text: string;
    /** 구독 방식 여부 → "구독" 배지. */
    sub: boolean;
}

export function InlineModelDropdown<C extends string>({
    catalog,
    selection,
    onChange,
    isUsable,
    label,
}: InlineModelDropdownProps<C>) {
    const [open, setOpen] = useState(false);

    // 가용한 (회사, 인증, 모델) 조합을 플랫 리스트로.
    const items = useMemo<Item<C>[]>(() => {
        const out: Item<C>[] = [];
        (Object.keys(catalog) as C[]).forEach((company) => {
            const def = catalog[company];
            def.auths.forEach((auth) => {
                if (!isUsable(company, auth)) return;
                (def.models[auth] ?? []).forEach((m) => {
                    out.push({ company, auth, model: m.id, text: m.label, sub: auth === 'subscription' });
                });
            });
        });
        return out;
        // isUsable 은 부모가 매 렌더 새로 만들 수 있으나, 구독상태 변화 반영 위해 의존.
    }, [catalog, isUsable]);

    const current = items.find(
        (i) => i.company === selection.company && i.auth === selection.auth && i.model === selection.model,
    );

    const pick = (it: Item<C>) => {
        onChange({ company: it.company, auth: it.auth, model: it.model });
        setOpen(false);
    };

    return (
        <div className="inline-model-dropdown">
            <span className="imd-label">{label}:</span>
            <button
                type="button"
                className="imd-trigger"
                onClick={() => setOpen((o) => !o)}
                title="모델 선택"
            >
                {current && <img className="imd-logo" src={COMPANY_LOGO[current.company]} alt="" />}
                <strong>{current?.text ?? selection.model}</strong>
                {current?.sub && <span className="imd-sub-badge">구독</span>}
                <ChevronDown size={13} className={`imd-caret${open ? ' open' : ''}`} />
            </button>

            {open && (
                <>
                    <div className="imd-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />
                    <div className="imd-menu" role="listbox">
                        {items.length === 0 ? (
                            <div className="imd-empty">사용 가능한 모델이 없습니다</div>
                        ) : (
                            items.map((it) => {
                                const active = it === current;
                                return (
                                    <button
                                        type="button"
                                        key={`${it.company}-${it.auth}-${it.model}`}
                                        className={`imd-item${active ? ' active' : ''}`}
                                        role="option"
                                        aria-selected={active}
                                        onClick={() => pick(it)}
                                    >
                                        <span className="imd-item-check">{active && <Check size={13} />}</span>
                                        <img className="imd-logo" src={COMPANY_LOGO[it.company]} alt="" />
                                        <span className="imd-item-text">{it.text}</span>
                                        {it.sub && <span className="imd-sub-badge">구독</span>}
                                    </button>
                                );
                            })
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
