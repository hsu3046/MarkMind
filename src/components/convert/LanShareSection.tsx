/**
 * 설정창 "아이폰 연결" 섹션 — 같은 Wi-Fi 의 기기가 지정 폴더의 마크다운을
 * 읽고 편집하도록 LAN 서버를 Connect/Disconnect.
 *
 * 보안: 기본 OFF, 명시적 Connect 시에만 노출. 노출 중에는 상태를 시각적으로
 * 표시(실수 방지). Path(노출 폴더) 하나로 샌드박싱, 토큰(PIN) 필수.
 */

import { useEffect, useState } from 'react';
import { Wifi, WifiOff, FolderOpen, Copy, RefreshCw, Check, Share2 } from 'lucide-react';
import {
    LanInfo,
    lanStart,
    lanStop,
    lanStatus,
    getSavedRoot,
    setSavedRoot,
    getOrCreateToken,
    regenerateToken,
    urlFor,
    shareAirdrop,
} from '../../services/lanService';

export function LanShareSection() {
    const [root, setRoot] = useState('');
    const [token, setToken] = useState('');
    const [info, setInfo] = useState<LanInfo>({ running: false, host: null, addr: null, port: null, root: null });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState<'host' | 'ip' | null>(null);

    useEffect(() => {
        setRoot(getSavedRoot());
        setToken(getOrCreateToken());
        // 앱 재시작 후 실제 서버 상태 확인(보통 OFF로 시작).
        lanStatus().then(setInfo).catch(() => {});
    }, []);

    // P3c: 다른 윈도우에서 연결/해제해도 이 설정창이 stale 하지 않도록 주기 동기화.
    // 작업 중(busy)에는 건너뛰어 사용자 액션 결과를 덮어쓰지 않는다.
    useEffect(() => {
        const id = setInterval(() => {
            if (!busy) lanStatus().then(setInfo).catch(() => {});
        }, 3000);
        return () => clearInterval(id);
    }, [busy]);

    const pickFolder = async () => {
        try {
            const { open } = await import('@tauri-apps/plugin-dialog');
            const selected = await open({ directory: true, multiple: false });
            if (typeof selected === 'string') {
                setRoot(selected);
                setSavedRoot(selected);
            }
        } catch (err) {
            setError(String(err));
        }
    };

    const handleConnect = async () => {
        const dir = root.trim();
        if (!dir) {
            setError('공유할 폴더를 먼저 선택하세요.');
            return;
        }
        setBusy(true);
        setError(null);
        try {
            setSavedRoot(dir);
            const result = await lanStart(dir, token);
            setInfo(result);
        } catch (err) {
            setError(String(err));
        } finally {
            setBusy(false);
        }
    };

    const handleDisconnect = async () => {
        setBusy(true);
        setError(null);
        try {
            await lanStop();
            setInfo({ running: false, host: null, addr: null, port: null, root: null });
        } catch (err) {
            setError(String(err));
        } finally {
            setBusy(false);
        }
    };

    const handleRegenerate = () => {
        // 연결 중에는 토큰을 바꾸면 기존 접속이 끊기므로 막는다.
        if (info.running) return;
        setToken(regenerateToken());
    };

    const port = info.port ?? 0;
    const hostUrl = info.host && port ? urlFor(info.host, port, token) : '';
    const ipUrl = info.addr && port ? urlFor(info.addr, port, token) : '';
    const handleCopy = async (which: 'host' | 'ip', url: string) => {
        if (!url) return;
        try {
            await navigator.clipboard.writeText(url);
            setCopied(which);
            setTimeout(() => setCopied(null), 1500);
        } catch {
            // 클립보드 불가 — 무시(주소는 화면에 표시됨)
        }
    };

    const handleShare = async (url: string) => {
        if (!url) return;
        try {
            await shareAirdrop(url);
        } catch (err) {
            setError(String(err));
        }
    };

    return (
        <section className="convert-settings-section">
            <label>
                아이폰 연결 — LAN 파일 공유{' '}
                {info.running ? (
                    <span className="badge badge-ok">연결됨</span>
                ) : (
                    <span className="badge badge-warn">꺼짐</span>
                )}
            </label>

            {/* 공유 폴더 */}
            <div className="convert-key-row">
                <input
                    type="text"
                    placeholder="공유할 폴더 경로 (예: ~/iCloud Drive/MarkMind)"
                    value={root}
                    onChange={(e) => setRoot(e.target.value)}
                    disabled={info.running || busy}
                />
                <button onClick={pickFolder} disabled={info.running || busy} title="폴더 선택">
                    <FolderOpen size={14} />
                </button>
            </div>

            {/* 토큰(PIN) */}
            <div className="convert-key-row" style={{ marginTop: 6 }}>
                <input type="text" value={`PIN: ${token}`} readOnly disabled />
                <button
                    onClick={handleRegenerate}
                    disabled={info.running || busy}
                    title={info.running ? '연결 해제 후 변경 가능' : 'PIN 재생성'}
                >
                    <RefreshCw size={14} />
                </button>
            </div>

            {/* Connect / Disconnect */}
            <div className="drive-connect-row" style={{ marginTop: 8 }}>
                {info.running ? (
                    <button className="danger" onClick={handleDisconnect} disabled={busy}>
                        <WifiOff size={14} />
                        <span>연결 해제</span>
                    </button>
                ) : (
                    <button className="primary" onClick={handleConnect} disabled={busy}>
                        <Wifi size={14} />
                        <span>{busy ? '연결 중...' : '연결 (Connect)'}</span>
                    </button>
                )}
            </div>

            {/* 접속 주소 — 고정 .local(권장) + IP(폴백) */}
            {info.running && (hostUrl || ipUrl) && (
                <div className="lan-connect-info" style={{ marginTop: 8 }}>
                    <p className="convert-key-note" style={{ marginBottom: 4 }}>
                        아이폰 Safari 에서 같은 Wi-Fi 로 접속:
                    </p>

                    {hostUrl && (
                        <>
                            <div className="convert-key-row">
                                <input
                                    type="text"
                                    value={hostUrl}
                                    readOnly
                                    onFocus={(e) => e.target.select()}
                                />
                                <button onClick={() => handleCopy('host', hostUrl)} title="주소 복사">
                                    {copied === 'host' ? <Check size={14} /> : <Copy size={14} />}
                                </button>
                                <button onClick={() => handleShare(hostUrl)} title="AirDrop 으로 공유">
                                    <Share2 size={14} />
                                </button>
                            </div>
                            <p className="convert-key-note" style={{ margin: '2px 0 6px' }}>
                                고정 주소 — IP 가 바뀌어도 그대로 (권장)
                            </p>
                        </>
                    )}

                    {ipUrl && (
                        <>
                            <div className="convert-key-row">
                                <input
                                    type="text"
                                    value={ipUrl}
                                    readOnly
                                    onFocus={(e) => e.target.select()}
                                />
                                <button onClick={() => handleCopy('ip', ipUrl)} title="주소 복사">
                                    {copied === 'ip' ? <Check size={14} /> : <Copy size={14} />}
                                </button>
                                <button onClick={() => handleShare(ipUrl)} title="AirDrop 으로 공유">
                                    <Share2 size={14} />
                                </button>
                            </div>
                            <p className="convert-key-note" style={{ margin: '2px 0 0' }}>
                                IP 주소 — 위 고정 주소가 안 될 때 폴백
                            </p>
                        </>
                    )}
                </div>
            )}

            <p className="convert-key-note">
                지정한 <strong>폴더 하나</strong>의 마크다운만 노출되며, PIN 이 있어야 접근됩니다.
                <strong> 신뢰하는 집 Wi-Fi 에서만</strong> 사용하고, 끝나면 연결을 해제하세요.
                카페·회사 등 공유 네트워크에서는 켜두지 마세요.
            </p>

            {error && <p className="drive-error">{error}</p>}
        </section>
    );
}
