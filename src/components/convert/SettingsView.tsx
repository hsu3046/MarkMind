/**
 * 통합 API 키 + Drive OAuth 설정 화면.
 * 저장 흐름:
 *   1) 변경된 API 키 / Drive credentials 만 골라 검증 (ping/format)
 *   2) Keychain 저장
 *   3) 검증 결과를 localStorage 캐시 → 다음 진입 시 배지로 표시
 *      - 'valid'   → "정상"
 *      - 'invalid' → "확인 필요"
 *      - 'error'   → "확인 필요" (네트워크 오류 등 — 추후 재시도 권장)
 */

import { useEffect, useState } from 'react';
import { Eye, EyeOff, Trash2, Cloud, CloudOff } from 'lucide-react';
import { getKey, hasKey, Provider, removeKey, updateCacheAfterBatch } from '../../services/secureStorage';
import { detectSubscriptionLogins, SubscriptionStatus } from '../../services/subscriptionService';
import * as gdrive from '../../services/gdriveService';
import * as secretsBatch from '../../services/secretsService';
import { confirmAction } from '../../services/dialogService';
import { isTauri } from '../../services/platform';
import { LanShareSection } from './LanShareSection';
import { AIModelPicker } from './AIModelPicker';
import {
    AI_CATALOG,
    getAIModelSelection,
    setAIModelSelection,
    AIModelSelection,
    IMAGE_AI_CATALOG,
    getImageAIModelSelection,
    setImageAIModelSelection,
    ImageAIModelSelection,
} from '../../services/aiModelConfig';
import { loadUserMemory, saveUserMemory, USER_MEMORY_MAX_CHARS } from '../../services/userMemory';
import {
    ValidationResult,
    validateProvider,
    validateGoogleCredsFormat,
    setValidationStatus,
    getValidationStatus,
    clearValidationStatus,
} from '../../services/apiValidation';

interface SettingsViewProps {
    onDone: () => void;
}

interface KeySpec {
    provider: Provider;
    label: string;
    placeholder: string;
    issueUrl: string;
    issueLabel: string;
}

const KEY_SPECS: KeySpec[] = [
    {
        provider: 'gemini',
        label: 'Gemini API 키',
        placeholder: 'AIza...',
        issueUrl: 'https://aistudio.google.com/apikey',
        issueLabel: 'aistudio.google.com/apikey',
    },
    {
        provider: 'claude',
        label: 'Claude API 키',
        placeholder: 'sk-ant-...',
        issueUrl: 'https://console.anthropic.com/settings/keys',
        issueLabel: 'console.anthropic.com/settings/keys',
    },
    {
        provider: 'openai',
        label: 'OpenAI API 키',
        placeholder: 'sk-...',
        issueUrl: 'https://platform.openai.com/api-keys',
        issueLabel: 'platform.openai.com/api-keys',
    },
    {
        provider: 'pyannoteai',
        label: 'pyannote.ai API 키',
        placeholder: 'sk_...',
        issueUrl: 'https://dashboard.pyannote.ai',
        issueLabel: 'dashboard.pyannote.ai',
    },
];

type SettingsTab = 'basic' | 'ai' | 'extra';
/** AI 설정 탭에 노출할 API 키 (나머지 키는 추가 기능 탭). */
const AI_PROVIDERS: Provider[] = ['gemini', 'claude', 'openai'];

function maskClientId(id: string): string {
    if (id.length <= 12) return id;
    const at = id.indexOf('.apps.googleusercontent.com');
    if (at > 8) return `${id.slice(0, 8)}…${id.slice(at)}`;
    return `${id.slice(0, 8)}…${id.slice(-12)}`;
}

type StatusBadge = { text: string; cls: string } | null;

function statusBadge(stored: boolean, result: ValidationResult | null): StatusBadge {
    if (!stored) return null;
    if (result === 'valid') return { text: '정상', cls: 'badge badge-ok' };
    return { text: '확인 필요', cls: 'badge badge-warn' };
}

export function SettingsView({ onDone }: SettingsViewProps) {
    const [values, setValues] = useState<Record<Provider, string>>({
        gemini: '',
        claude: '',
        openai: '',
        pyannoteai: '',
    });
    const [show, setShow] = useState<Record<Provider, boolean>>({
        gemini: false,
        claude: false,
        openai: false,
        pyannoteai: false,
    });
    const [stored, setStored] = useState<Record<Provider, boolean>>({
        gemini: false,
        claude: false,
        openai: false,
        pyannoteai: false,
    });
    const [validation, setValidation] = useState<Record<Provider | 'gdrive', ValidationResult | null>>({
        gemini: null,
        claude: null,
        openai: null,
        pyannoteai: null,
        gdrive: null,
    });
    const [saving, setSaving] = useState(false);

    // 로컬 화자분리 Python 경로 (vault 저장). env MARKMIND_DIAR_PYTHON 이 있으면 그게 우선.
    const [diarPython, setDiarPython] = useState('');
    const [diarPythonOrig, setDiarPythonOrig] = useState('');

    // Drive
    const [driveClientId, setDriveClientId] = useState<string | null>(null);
    const [driveEmail, setDriveEmail] = useState<string | null>(null);
    const [credsEditing, setCredsEditing] = useState(true); // 첫 render 안전 default
    const [credsInput, setCredsInput] = useState({ id: '', secret: '' });
    const [showSecret, setShowSecret] = useState(false);
    const [driveBusy, setDriveBusy] = useState(false);
    const [driveError, setDriveError] = useState<string | null>(null);

    // 사용자 메모리(#15) — AI system prompt 주입용 "내 정보"
    const [userMemory, setUserMemory] = useState('');
    const [memoryOrig, setMemoryOrig] = useState('');

    // 구독 연동 — 로컬 Claude Code / Codex CLI 로그인 감지 현황
    const [subStatus, setSubStatus] = useState<SubscriptionStatus>({ claude: false, codex: false });

    // 전역 모델 선택 — 기본 AI(텍스트) / 이미지 AI. 기본 설정 탭의 picker 와 연동.
    const [aiSel, setAiSel] = useState<AIModelSelection>(getAIModelSelection());
    const [imgSel, setImgSel] = useState<ImageAIModelSelection>(getImageAIModelSelection());

    // 설정 탭 (기본 / AI / 추가 기능). AI 가 가장 자주 쓰이므로 기본 진입 탭.
    const [activeTab, setActiveTab] = useState<SettingsTab>('ai');

    useEffect(() => {
        setValues({
            gemini: getKey('gemini') || '',
            claude: getKey('claude') || '',
            openai: getKey('openai') || '',
            pyannoteai: getKey('pyannoteai') || '',
        });
        setStored({
            gemini: hasKey('gemini'),
            claude: hasKey('claude'),
            openai: hasKey('openai'),
            pyannoteai: hasKey('pyannoteai'),
        });
        setValidation({
            gemini: getValidationStatus('gemini'),
            claude: getValidationStatus('claude'),
            openai: getValidationStatus('openai'),
            pyannoteai: getValidationStatus('pyannoteai'),
            gdrive: getValidationStatus('gdrive'),
        });
        (async () => {
            const id = await gdrive.getClientId();
            setDriveClientId(id);
            setCredsEditing(!id);
            const email = await gdrive.getStatus();
            setDriveEmail(email);
            const dp = (await secretsBatch.getDiarPython()) || '';
            setDiarPython(dp);
            setDiarPythonOrig(dp);
            const mem = await loadUserMemory();
            setUserMemory(mem);
            setMemoryOrig(mem);
            setSubStatus(await detectSubscriptionLogins());
        })();
    }, []);

    // ─── 입력 빠른 초기화 (휴지통) ───
    const handleClearKeyInput = async (provider: Provider) => {
        if (stored[provider]) {
            const label = KEY_SPECS.find((s) => s.provider === provider)?.label ?? provider;
            const ok = await confirmAction(`${label}를 삭제하시겠습니까?`, { title: '삭제', kind: 'warning' });
            if (!ok) return;
            await removeKey(provider);
            clearValidationStatus(provider);
            setStored((s) => ({ ...s, [provider]: false }));
            setValidation((v) => ({ ...v, [provider]: null }));
        }
        setValues((v) => ({ ...v, [provider]: '' }));
    };

    const handleClearCredsInputId = () => setCredsInput((v) => ({ ...v, id: '' }));
    const handleClearCredsInputSecret = () => setCredsInput((v) => ({ ...v, secret: '' }));

    const handleClearStoredCreds = async () => {
        const ok = await confirmAction(
            'Google Drive OAuth 설정을 모두 삭제하시겠습니까?\n저장된 연결도 함께 끊깁니다.',
            { title: '삭제', kind: 'warning' },
        );
        if (!ok) return;
        setDriveBusy(true);
        try {
            await gdrive.clearCredentials();
            clearValidationStatus('gdrive');
            setDriveClientId(null);
            setDriveEmail(null);
            setCredsEditing(true);
            setCredsInput({ id: '', secret: '' });
            setValidation((v) => ({ ...v, gdrive: null }));
        } catch (err) {
            setDriveError(String(err));
        } finally {
            setDriveBusy(false);
        }
    };

    // ─── Drive 연결 / 해제 ───
    const handleDriveConnect = async () => {
        setDriveBusy(true);
        setDriveError(null);
        try {
            const result = await gdrive.connect();
            setDriveEmail(result.email);
        } catch (err) {
            setDriveError(String(err));
        } finally {
            setDriveBusy(false);
        }
    };

    const handleDriveDisconnect = async () => {
        const ok = await confirmAction('Google Drive 연결을 해제하시겠습니까?', { title: '연결 해제', kind: 'warning' });
        if (!ok) return;
        setDriveBusy(true);
        try {
            await gdrive.disconnect();
            setDriveEmail(null);
        } catch (err) {
            setDriveError(String(err));
        } finally {
            setDriveBusy(false);
        }
    };

    // 저장 시도 후 검증 결과에 따른 알림 (모달 하단)
    const [postSaveWarn, setPostSaveWarn] = useState<string | null>(null);

    // ─── 통합 저장 ───
    // 단일 batch 호출로 모든 변경된 키 + Drive credentials 를 1회 Keychain write 에 묶음.
    // (ad-hoc 서명 빌드에서 다이얼로그 1번)
    // 그 다음 변경된 키만 검증 (네트워크 ping) + 결과 표시.
    const handleSave = async () => {
        setSaving(true);
        setDriveError(null);
        setPostSaveWarn(null);
        try {
            const newValidation = { ...validation };
            const failedLabels: string[] = [];

            // 0) 변경된 키 검출
            const changedKeys: Provider[] = [];
            for (const spec of KEY_SPECS) {
                const newValue = values[spec.provider].trim();
                const oldValue = getKey(spec.provider) || '';
                if (newValue && newValue !== oldValue) changedKeys.push(spec.provider);
            }

            // 1) Drive credentials 변경 검출
            const driveId = credsEditing ? credsInput.id.trim() : '';
            const driveSecret = credsEditing ? credsInput.secret.trim() : '';
            const drivePartial = credsEditing && (driveId || driveSecret) && !(driveId && driveSecret);
            if (drivePartial) {
                const proceed = await confirmAction(
                    'Drive OAuth 입력이 완전하지 않습니다 (Client ID + Secret 둘 다 필요).\n' +
                    'Drive 설정은 저장하지 않고 나머지만 저장할까요?',
                );
                if (!proceed) {
                    setSaving(false);
                    return;
                }
            }
            const driveBoth = credsEditing && driveId && driveSecret;

            // 2) batch 저장 — 변경된 필드만 명시적으로 전송. 미전송 필드는 보존.
            //    Keychain write 1회 = 다이얼로그 1번.
            const diarChanged = diarPython.trim() !== diarPythonOrig.trim();
            const anyChange = changedKeys.length > 0 || driveBoth || diarChanged;
            if (anyChange) {
                const payload: Parameters<typeof secretsBatch.setUserInputs>[0] = {};
                if (changedKeys.includes('gemini')) payload.gemini = values.gemini.trim();
                if (changedKeys.includes('claude')) payload.claude = values.claude.trim();
                if (changedKeys.includes('openai')) payload.openai = values.openai.trim();
                if (changedKeys.includes('pyannoteai')) payload.pyannoteai = values.pyannoteai.trim();
                if (diarChanged) payload.diarPython = diarPython.trim();
                if (driveBoth) {
                    payload.gdriveClientId = driveId;
                    payload.gdriveClientSecret = driveSecret;
                }
                await secretsBatch.setUserInputs(payload);
                if (diarChanged) setDiarPythonOrig(diarPython.trim());

                // 메모리 캐시 갱신
                const cachePatch: Partial<Record<Provider, string | null>> = {};
                changedKeys.forEach((p) => { cachePatch[p] = values[p].trim() || null; });
                updateCacheAfterBatch(cachePatch);
                changedKeys.forEach((p) => setStored((s) => ({ ...s, [p]: true })));
                if (driveBoth) {
                    setDriveClientId(driveId);
                    setCredsEditing(false);
                    setCredsInput({ id: '', secret: '' });
                    setShowSecret(false);
                }
            }

            // 나의 정보(옵션) — 변경 시 함께 저장(키 변경 여부와 독립).
            if (userMemory.trim() !== memoryOrig.trim()) {
                await saveUserMemory(userMemory);
                setMemoryOrig(userMemory);
            }

            // 3) 변경된 키 검증 — 네트워크 ping (Keychain 미접근)
            for (const p of changedKeys) {
                setValidation((v) => ({ ...v, [p]: null }));
                const result = await validateProvider(p, values[p].trim());
                setValidationStatus(p, result);
                newValidation[p] = result;
                if (result !== 'valid') {
                    const label = KEY_SPECS.find((s) => s.provider === p)?.label ?? p;
                    failedLabels.push(label);
                }
            }

            // 4) Drive credentials 형식 검증 + 첫 설정이면 자동 OAuth
            if (driveBoth) {
                const formatValid = validateGoogleCredsFormat(driveId, driveSecret);
                if (!formatValid) {
                    setValidationStatus('gdrive', 'invalid');
                    newValidation.gdrive = 'invalid';
                    failedLabels.push('Google Drive OAuth');
                } else if (!driveEmail) {
                    setDriveBusy(true);
                    try {
                        // OAuth 성공 시 refresh_token + email 이 vault 에 1회 write (다이얼로그 1번 추가)
                        const result = await gdrive.connect();
                        setDriveEmail(result.email);
                        setValidationStatus('gdrive', 'valid');
                        newValidation.gdrive = 'valid';
                    } catch (err) {
                        console.error('[Drive] 자동 연결 실패:', err);
                        setDriveError(`연결 실패: ${err}`);
                        setValidationStatus('gdrive', 'invalid');
                        newValidation.gdrive = 'invalid';
                        failedLabels.push('Google Drive 연결');
                    } finally {
                        setDriveBusy(false);
                    }
                } else {
                    setValidationStatus('gdrive', 'valid');
                    newValidation.gdrive = 'valid';
                }
            }

            setValidation(newValidation);

            if (failedLabels.length > 0) {
                setPostSaveWarn(
                    `다음 키가 작동하지 않습니다: ${failedLabels.join(', ')}\n` +
                    `값을 확인 후 다시 저장하거나 X 로 닫아주세요.`,
                );
                return;
            }
            onDone();
        } catch (err) {
            console.error('[SettingsView] 저장 실패:', err);
            setDriveError(`저장 실패: ${err}`);
        } finally {
            setSaving(false);
        }
    };

    const renderKeySpec = (spec: KeySpec) => {
        const badge = statusBadge(stored[spec.provider], validation[spec.provider]);
        return (
            <section key={spec.provider} className="convert-settings-section">
                <label>
                    {spec.label} {badge && <span className={badge.cls}>{badge.text}</span>}
                </label>
                <div className="convert-key-row">
                    <input
                        type={show[spec.provider] ? 'text' : 'password'}
                        placeholder={spec.placeholder}
                        value={values[spec.provider]}
                        onChange={(e) => setValues((v) => ({ ...v, [spec.provider]: e.target.value }))}
                    />
                    <button
                        onClick={() => setShow((s) => ({ ...s, [spec.provider]: !s[spec.provider] }))}
                        title="표시/숨김"
                    >
                        {show[spec.provider] ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <button
                        onClick={() => handleClearKeyInput(spec.provider)}
                        className="danger"
                        disabled={!stored[spec.provider]}
                        title="삭제"
                    >
                        <Trash2 size={14} />
                    </button>
                </div>
                <p className="convert-key-note">
                    발급:{' '}
                    <a href={spec.issueUrl} target="_blank" rel="noopener noreferrer">
                        {spec.issueLabel}
                    </a>
                </p>
            </section>
        );
    };

    return (
        <div className="convert-settings">
            <div className="settings-tabs">
                <button
                    type="button"
                    className={`settings-tab${activeTab === 'basic' ? ' active' : ''}`}
                    onClick={() => setActiveTab('basic')}
                >
                    기본 설정
                </button>
                <button
                    type="button"
                    className={`settings-tab${activeTab === 'ai' ? ' active' : ''}`}
                    onClick={() => setActiveTab('ai')}
                >
                    AI 설정
                </button>
                <button
                    type="button"
                    className={`settings-tab${activeTab === 'extra' ? ' active' : ''}`}
                    onClick={() => setActiveTab('extra')}
                >
                    추가 설정
                </button>
            </div>

            {activeTab === 'ai' && (
                <>
                    {KEY_SPECS.filter((s) => AI_PROVIDERS.includes(s.provider)).map(renderKeySpec)}

            <hr className="settings-divider" />

            {/* === 구독 연동 (Claude / ChatGPT — 로컬 CLI 토큰 재사용) === */}
            <section className="convert-settings-section">
                <div className="sub-link-list">
                    {/* Claude */}
                    <div className="sub-link-row">
                        <span className="sub-link-name">Claude 구독 연동</span>
                        <span className={subStatus.claude ? 'badge badge-ok' : 'badge badge-warn'}>
                            {subStatus.claude
                                ? `${subStatus.claudePlan ? subStatus.claudePlan + ' · ' : ''}연결됨`
                                : '연결 안 됨'}
                        </span>
                    </div>
                    {!subStatus.claude && (
                        <p className="convert-key-note sub-link-hint">
                            연결하려면 터미널에서 <code>claude</code> 로 로그인하세요 (
                            <a href="https://code.claude.com" target="_blank" rel="noopener noreferrer">
                                Claude Code 설치 안내
                            </a>
                            ).
                        </p>
                    )}

                    {/* ChatGPT (Codex) */}
                    <div className="sub-link-row">
                        <span className="sub-link-name">ChatGPT 구독 연동</span>
                        <span className={subStatus.codex ? 'badge badge-ok' : 'badge badge-warn'}>
                            {subStatus.codex
                                ? `${subStatus.codexPlan ? subStatus.codexPlan + ' · ' : ''}연결됨`
                                : '연결 안 됨'}
                        </span>
                    </div>
                    {!subStatus.codex && (
                        <p className="convert-key-note sub-link-hint">
                            연결하려면 터미널에서 <code>codex</code> 로 로그인하세요 (
                            <a href="https://developers.openai.com/codex" target="_blank" rel="noopener noreferrer">
                                Codex 설치 안내
                            </a>
                            ).
                        </p>
                    )}

                    {/* Grok — 구독 연동 준비중. 고정 표시. */}
                    <div className="sub-link-row">
                        <span className="sub-link-name">Grok 구독 연동</span>
                        <span className="badge badge-muted">준비중</span>
                    </div>

                    {/* Gemini — 구독 연동 미지원(제공사 차단). 고정 표시. */}
                    <div className="sub-link-row">
                        <span className="sub-link-name">Gemini 구독 연동</span>
                        <span className="badge badge-muted">지원 안함</span>
                    </div>
                </div>

                <p className="convert-key-note">
                    현재 이용 중인 AI 구독 플랜과 연동할 수 있습니다. 단, 제공사 정책에 따라 연동이 중단될
                    수 있습니다.
                </p>
            </section>
                </>
            )}

            {activeTab === 'extra' && (
                <>
                    {/* === 나의 정보 (AI 컨텍스트) — 추가 설정 맨 위 === */}
                    <section className="convert-settings-section">
                        <label>
                            나의 정보 (옵션){' '}
                            {memoryOrig && <span className="badge badge-ok">설정됨</span>}
                        </label>
                        <textarea
                            className="convert-memory-input"
                            placeholder="예: 한국어 사용자, B2B SaaS 분야, 존댓말 선호. 자주 쓰는 용어·약어 등"
                            value={userMemory}
                            rows={4}
                            maxLength={USER_MEMORY_MAX_CHARS}
                            onChange={(e) => setUserMemory(e.target.value)}
                        />
                        <p className="convert-key-note">
                            {userMemory.length}/{USER_MEMORY_MAX_CHARS}자
                        </p>
                    </section>

                    <hr className="settings-divider" />

                    {/* === Google Drive === */}
            <section className="convert-settings-section drive-section">
                <label>
                    Google Drive 연동
                    {driveEmail && <span className="badge badge-ok">연결됨</span>}
                    {!driveEmail && driveClientId && (() => {
                        const badge = statusBadge(true, validation.gdrive);
                        return badge && <span className={badge.cls}>{badge.text}</span>;
                    })()}
                </label>

                {/* Step 1: OAuth credentials 입력 또는 마스킹 표시 */}
                {credsEditing ? (
                    <>
                        <div className="convert-key-row">
                            <input
                                type="text"
                                placeholder="Client ID — xxxxxxxx.apps.googleusercontent.com"
                                value={credsInput.id}
                                onChange={(e) => setCredsInput((v) => ({ ...v, id: e.target.value }))}
                                disabled={driveBusy}
                            />
                            <button
                                onClick={handleClearCredsInputId}
                                className="danger"
                                disabled={driveBusy || !credsInput.id}
                                title="입력 비우기"
                            >
                                <Trash2 size={14} />
                            </button>
                        </div>
                        <div className="convert-key-row" style={{ marginTop: 6 }}>
                            <input
                                type={showSecret ? 'text' : 'password'}
                                placeholder="Client Secret — GOCSPX-..."
                                value={credsInput.secret}
                                onChange={(e) =>
                                    setCredsInput((v) => ({ ...v, secret: e.target.value }))
                                }
                                disabled={driveBusy}
                            />
                            <button
                                onClick={() => setShowSecret((v) => !v)}
                                title="표시/숨김"
                                disabled={driveBusy}
                            >
                                {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                            </button>
                            <button
                                onClick={handleClearCredsInputSecret}
                                className="danger"
                                disabled={driveBusy || !credsInput.secret}
                                title="입력 비우기"
                            >
                                <Trash2 size={14} />
                            </button>
                        </div>
                    </>
                ) : (
                    <div className="drive-row">
                        <div className="drive-info">
                            <code className="drive-client-id">
                                {driveClientId ? maskClientId(driveClientId) : '—'}
                            </code>
                        </div>
                        <button
                            onClick={() => {
                                setCredsEditing(true);
                                setDriveError(null);
                            }}
                            disabled={driveBusy}
                            title="OAuth 설정 변경"
                        >
                            변경
                        </button>
                        <button
                            className="danger"
                            onClick={handleClearStoredCreds}
                            disabled={driveBusy}
                            title="OAuth 설정 삭제"
                        >
                            <Trash2 size={14} />
                        </button>
                    </div>
                )}

                <p className="convert-key-note">
                    발급:{' '}
                    <a
                        href="https://console.cloud.google.com/apis/credentials"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        console.cloud.google.com/apis/credentials
                    </a>
                </p>

                {/* Step 2: 연결 (credentials 저장 + 마스킹 표시 상태일 때) */}
                {driveClientId && !credsEditing && (
                    <div className="drive-connect-row">
                        {driveEmail ? (
                            <>
                                <div className="drive-info">
                                    <Cloud size={14} />
                                    <span className="drive-email">{driveEmail}</span>
                                </div>
                                <button
                                    className="danger"
                                    onClick={handleDriveDisconnect}
                                    disabled={driveBusy}
                                >
                                    <CloudOff size={14} />
                                    <span>연결 해제</span>
                                </button>
                            </>
                        ) : (
                            <button
                                className="primary"
                                onClick={handleDriveConnect}
                                disabled={driveBusy}
                            >
                                <Cloud size={14} />
                                <span>{driveBusy ? '브라우저에서 동의 중...' : 'Google Drive 연결'}</span>
                            </button>
                        )}
                    </div>
                )}

                {driveError && <p className="drive-error">{driveError}</p>}
            </section>

            <hr className="settings-divider" />

                    {KEY_SPECS.filter((s) => !AI_PROVIDERS.includes(s.provider)).map(renderKeySpec)}

            {/* === pyannote.ai 로컬 설치 경로 === */}
            <section className="convert-settings-section">
                <label>
                    pyannote.ai 로컬 설치 경로{' '}
                    {diarPythonOrig && <span className="badge badge-ok">설정됨</span>}
                </label>
                <div className="convert-key-row">
                    <input
                        type="text"
                        placeholder="/path/to/venv/bin/python3 (pyannote.audio 설치된 Python)"
                        value={diarPython}
                        onChange={(e) => setDiarPython(e.target.value)}
                    />
                    <button
                        onClick={() => setDiarPython('')}
                        className="danger"
                        disabled={!diarPython}
                        title="입력 비우기"
                    >
                        <Trash2 size={14} />
                    </button>
                </div>
                <p className="convert-key-note">
                    해당 Python 에 <code>pyannote.audio</code> 가 설치돼 있어야 합니다. 비우면 클라우드 키 또는
                    기본 동작.
                </p>
            </section>
                </>
            )}

            {/* === 기본 설정 — 기본/이미지 AI 모델 + 아이폰 연결 === */}
            {activeTab === 'basic' && (
                <>
                    <AIModelPicker
                        title="기본 AI 모델"
                        catalog={AI_CATALOG}
                        selection={aiSel}
                        onChange={(s) => {
                            setAiSel(s);
                            setAIModelSelection(s);
                        }}
                        subscriptionAvailable={(c) =>
                            c === 'claude' ? subStatus.claude : c === 'openai' ? subStatus.codex : false
                        }
                    />

                    <hr className="settings-divider" />

                    <AIModelPicker
                        title="이미지 AI 모델"
                        catalog={IMAGE_AI_CATALOG}
                        selection={imgSel}
                        onChange={(s) => {
                            setImgSel(s);
                            setImageAIModelSelection(s);
                        }}
                    />

                    <hr className="settings-divider" />

                    {isTauri() ? (
                        <LanShareSection />
                    ) : (
                        <section className="convert-settings-section">
                            <p className="convert-key-note">
                                아이폰 연결은 데스크탑 앱에서만 사용할 수 있습니다.
                            </p>
                        </section>
                    )}
                </>
            )}

            {postSaveWarn && <p className="convert-key-note warn">{postSaveWarn}</p>}

            <div className="convert-settings-actions">
                <button className="primary save-btn" onClick={handleSave} disabled={saving}>
                    {saving
                        ? (driveBusy ? '브라우저에서 동의 중...' : '검증 중...')
                        : '저장'}
                </button>
            </div>
        </div>
    );
}
