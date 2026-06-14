/**
 * 설정창 "아이폰 연결" 섹션 — 같은 Wi-Fi 의 기기가 지정 폴더의 마크다운을
 * 읽고 편집하도록 LAN 서버를 Connect/Disconnect.
 *
 * 보안: 기본 OFF, 명시적 Connect 시에만 노출. 노출 중에는 상태를 시각적으로
 * 표시(실수 방지). Path(노출 폴더) 하나로 샌드박싱, 토큰(PIN) 필수.
 */

import { useEffect, useState } from 'react';
import { Wifi, WifiOff, FolderOpen, Copy, RefreshCw, Check } from 'lucide-react';
import {
    LanInfo,
    lanStart,
    lanStop,
    lanStatus,
    getSavedRoot,
    setSavedRoot,
    getOrCreateToken,
    regenerateToken,
    connectUrl,
} from '../../services/lanService';

export function LanShareSection() {
    const [root, setRoot] = useState('');
    const [token, setToken] = useState('');
    const [info, setInfo] = useState<LanInfo>({ running: false, addr: null, port: null, root: null });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        setRoot(getSavedRoot());
        setToken(getOrCreateToken());
        // 앱 재시작 후 실제 서버 상태 확인(보통 OFF로 시작).
        lanStatus().then(setInfo).catch(() => {});
    }, []);

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
            setInfo({ running: false, addr: null, port: null, root: null });
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

    const url = connectUrl(info, token);
    const handleCopy = async () => {
        if (!url) return;
        try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // 클립보드 불가 — 무시(주소는 화면에 표시됨)
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

            {/* 접속 주소 */}
            {info.running && url && (
                <div className="lan-connect-info" style={{ marginTop: 8 }}>
                    <p className="convert-key-note" style={{ marginBottom: 4 }}>
                        아이폰 Safari 에서 같은 Wi-Fi 로 접속:
                    </p>
                    <div className="convert-key-row">
                        <input type="text" value={url} readOnly onFocus={(e) => e.target.select()} />
                        <button onClick={handleCopy} title="주소 복사">
                            {copied ? <Check size={14} /> : <Copy size={14} />}
                        </button>
                    </div>
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
