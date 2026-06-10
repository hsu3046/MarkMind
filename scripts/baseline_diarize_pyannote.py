"""기준선(Phase 1) — pyannote.audio 3.1 화자분리만 (whisper 없이).
채점에 필요한 건 화자 구간뿐이라 전사를 생략 → 빠르고 버전 안정적.
pyannote.ai 클라우드가 호스팅하는 바로 그 모델(speaker-diarization-3.1)을 로컬로 측정.

== 준비 ==
  pip install pyannote.audio        # whisperx 깔았으면 이미 있음
  # HF에서 두 게이트 모델 'Accept' (안 하면 401):
  #   https://huggingface.co/pyannote/speaker-diarization-3.1
  #   https://huggingface.co/pyannote/segmentation-3.0
  export HF_TOKEN=hf_xxx

== 실행 (crop 10분! 정답지가 crop 0~612초) ==
  python3 scripts/baseline_diarize_pyannote.py /Users/jaemoonyeah/Documents/crop_m4a.m4a 3

== 채점 ==
  python3 scripts/diar_eval.py /Users/jaemoonyeah/Documents/crop_m4a.m4a.diar.tsv
"""
import os
import sys
import shutil
import subprocess
import numpy as np
import torch
from pyannote.audio import Pipeline


def find_ffmpeg():
    p = shutil.which("ffmpeg")
    if p:
        return p
    here = os.path.dirname(os.path.abspath(__file__))
    cand = os.path.join(here, "..", "src-tauri", "binaries", "ffmpeg-aarch64-apple-darwin")
    if os.path.isfile(cand):
        return cand
    raise RuntimeError("ffmpeg 없음 — `brew install ffmpeg`")


def load_waveform(path, sr=16000):
    """ffmpeg로 직접 16kHz mono float 파형 디코드 → pyannote 4.x torchcodec 우회."""
    ff = find_ffmpeg()
    cmd = [ff, "-v", "error", "-i", path, "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    arr = np.frombuffer(raw, dtype=np.float32).copy()
    wav = torch.from_numpy(arr).unsqueeze(0)  # (1, samples)
    return wav, sr


def main():
    audio = sys.argv[1] if len(sys.argv) > 1 else "crop_m4a.m4a"
    num = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    token = os.environ["HF_TOKEN"]

    print("모델 로드 중 (speaker-diarization-3.1)...")
    # pyannote.audio 버전에 따라 인자명이 use_auth_token / token 으로 다름 → 둘 다 시도.
    pipeline = None
    last_err = None
    for kw in ("use_auth_token", "token"):
        try:
            pipeline = Pipeline.from_pretrained(
                "pyannote/speaker-diarization-3.1", **{kw: token}
            )
            break
        except TypeError as e:
            last_err = e  # 잘못된 kwarg → 다음 인자명 시도
            continue
        except Exception as e:
            last_err = e
            break
    if pipeline is None:
        print("\n❌ 파이프라인 로드 실패:", last_err)
        print(
            "\n점검:\n"
            "  1) HF에서 두 모델 '모두' Accept 했는가:\n"
            "     - pyannote/speaker-diarization-3.1\n"
            "     - pyannote/segmentation-3.0\n"
            "  2) 토큰이 'read' 권한이고, Accept한 계정과 같은 계정의 토큰인가\n"
            "  3) 현재 셸에 export 됐는가:  echo $HF_TOKEN\n"
            "  4) 토큰 확인:  python3 -c \"from huggingface_hub import whoami; print(whoami()['name'])\"\n"
        )
        sys.exit(1)

    # Apple Silicon GPU(mps) 있으면 가속, 없으면 CPU.
    try:
        import torch
        if torch.backends.mps.is_available():
            pipeline.to(torch.device("mps"))
            print("device: mps (Apple GPU)")
        else:
            print("device: cpu")
    except Exception as e:
        print("device: cpu (", e, ")")

    print(f"디코드(ffmpeg) → diarizing {audio} (num_speakers={num})...")
    wav, sr = load_waveform(audio)
    diar = pipeline({"waveform": wav, "sample_rate": sr}, num_speakers=num)

    # pyannote 4.x는 DiarizeOutput 반환(itertracks 없음) → 안에서 Annotation 추출.
    ann = diar if hasattr(diar, "itertracks") else None
    if ann is None:
        for attr in ("speaker_diarization", "diarization", "exclusive_speaker_diarization", "output"):
            cand = getattr(diar, attr, None)
            if cand is not None and hasattr(cand, "itertracks"):
                ann = cand
                break
    if ann is None:
        attrs = [a for a in dir(diar) if not a.startswith("_")]
        raise RuntimeError(
            f"출력에서 Annotation 못 찾음: type={type(diar).__name__}, attrs={attrs}"
        )

    tsv = audio + ".diar.tsv"
    n = 0
    with open(tsv, "w", encoding="utf-8") as f:
        for turn, _, spk in ann.itertracks(yield_label=True):
            f.write(f"{turn.start:.3f}\t{turn.end:.3f}\t{spk}\n")
            n += 1

    print(f"\n저장: {tsv}  ({n} turns)")
    print(f"다음: python3 scripts/diar_eval.py '{tsv}'")


if __name__ == "__main__":
    main()
