"""로컬 화자분리 사이드카 — pyannote.audio (speaker-diarization-3.1).
MarkMind Rust 백엔드(diarize_local.rs)가 subprocess 로 호출한다.

입력:  argv[1] = 오디오 경로, argv[2] = num_speakers("auto" 또는 정수, 선택)
환경:  HF_TOKEN(게이트 모델 1회 다운로드용 무료 토큰; 캐시 후엔 불필요),
       MARKMIND_FFMPEG(ffmpeg 경로; 없으면 PATH 검색)
출력:  stdout 에 JSON 배열 [{"start":float,"end":float,"speaker":str}, ...]
       (진단 로그는 전부 stderr)

요구:  pip install pyannote.audio   (+ HF 에서 speaker-diarization-3.1 / segmentation-3.0 /
       speaker-diarization-community-1 Accept)
"""
import os
import sys
import json
import shutil
import subprocess


def log(*a):
    print(*a, file=sys.stderr, flush=True)


class StderrHook:
    """pyannote 진행 콜백 → stderr 에 구조화 라인 출력(Rust 가 파싱해 진행바/ETA 표시).
    `PROGRESS<TAB>step<TAB>completed<TAB>total`  또는  `STEP<TAB>step`."""

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def __call__(self, step_name, step_artifact=None, file=None, total=None, completed=None):
        if total:
            print(f"PROGRESS\t{step_name}\t{completed or 0}\t{total}", file=sys.stderr, flush=True)
        else:
            print(f"STEP\t{step_name}", file=sys.stderr, flush=True)


def find_ffmpeg():
    p = os.environ.get("MARKMIND_FFMPEG") or shutil.which("ffmpeg")
    if p and os.path.exists(p):
        return p
    raise SystemExit("ffmpeg 없음 (MARKMIND_FFMPEG 또는 PATH 필요)")


def load_waveform(path, sr=16000):
    """ffmpeg 로 16kHz mono float 파형 디코드 → pyannote 4.x torchcodec 우회."""
    import numpy as np
    import torch
    ff = find_ffmpeg()
    cmd = [ff, "-v", "error", "-i", path, "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    arr = np.frombuffer(raw, dtype=np.float32).copy()
    return torch.from_numpy(arr).unsqueeze(0), sr


def extract_turns(diar):
    """DiarizeOutput(4.x) / Annotation(3.x) 어느 쪽이든 Annotation 추출."""
    ann = diar if hasattr(diar, "itertracks") else None
    if ann is None:
        for attr in ("speaker_diarization", "diarization", "exclusive_speaker_diarization", "output"):
            cand = getattr(diar, attr, None)
            if cand is not None and hasattr(cand, "itertracks"):
                ann = cand
                break
    if ann is None:
        raise SystemExit(f"Annotation 추출 실패: {type(diar).__name__}")
    return [
        {"start": float(t.start), "end": float(t.end), "speaker": str(spk)}
        for t, _, spk in ann.itertracks(yield_label=True)
    ]


def main():
    audio = sys.argv[1]
    num_arg = sys.argv[2] if len(sys.argv) > 2 else "auto"
    num = int(num_arg) if num_arg.isdigit() else None
    token = os.environ.get("HF_TOKEN")

    from pyannote.audio import Pipeline
    log("모델 로드(speaker-diarization-3.1)...")
    pipeline = None
    for kw in ("use_auth_token", "token"):
        try:
            pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1", **{kw: token})
            break
        except TypeError:
            continue
    if pipeline is None:
        raise SystemExit("pyannote 파이프라인 로드 실패 (HF_TOKEN/게이트 모델 Accept 확인)")

    try:
        import torch
        if torch.backends.mps.is_available():
            pipeline.to(torch.device("mps"))
            log("device: mps")
    except Exception as e:
        log("device: cpu", e)

    log(f"diarizing {audio} (num_speakers={num})...")
    wav, sr = load_waveform(audio)
    feed = {"waveform": wav, "sample_rate": sr}
    try:
        diar = pipeline(feed, num_speakers=num, hook=StderrHook())
    except TypeError:
        # hook 미지원 버전 → 진행 표시 없이 실행
        diar = pipeline(feed, num_speakers=num)
    turns = extract_turns(diar)
    log(f"{len(turns)} turns")
    # stdout 에는 JSON 만 (Rust 가 파싱)
    sys.stdout.write(json.dumps(turns))
    sys.stdout.flush()


if __name__ == "__main__":
    main()
