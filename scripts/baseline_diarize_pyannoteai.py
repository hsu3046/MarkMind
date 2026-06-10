"""기준선(Phase 1, Route A) — pyannote.ai 클라우드 화자분리 (공식 pyannoteai SDK).
앱에 넣을 바로 그 엔진(precision-2)을 그대로 측정 + 실제 응답 JSON을 저장해
Phase 2 Rust 이식(diarize_cloud.rs)의 요청/응답 형태를 고정한다.

== 준비 ==
  pip install pyannoteai            # venv_common 에는 이미 설치됨
  export PYANNOTEAI_API_KEY=...     # https://dashboard.pyannote.ai 발급

== 실행 (crop 10분! 정답지가 crop 0~612초) ==
  python3 scripts/baseline_diarize_pyannoteai.py /Users/jaemoonyeah/Documents/crop_m4a.m4a 3

== 채점 ==
  python3 scripts/diar_eval.py /Users/jaemoonyeah/Documents/crop_m4a.m4a.diar.tsv

산출물:
  <audio>.diar.tsv          채점용 (start end speaker)
  <audio>.pyannoteai.json   원시 응답 (Rust 이식용 — 응답 구조 확인)
"""
import sys
import json
from pyannoteai.sdk import Client

audio = ""  # extract_turns 에러 메시지에서 참조


def extract_turns(pred):
    """응답 구조에서 diarization 리스트 [{start,end,speaker}] 견고하게 추출."""
    for path in (("output", "diarization"), ("diarization",), ("prediction", "diarization")):
        node = pred
        ok = True
        for k in path:
            if isinstance(node, dict) and k in node:
                node = node[k]
            else:
                ok = False
                break
        if ok and isinstance(node, list) and node and isinstance(node[0], dict):
            return [
                {
                    "start": float(x["start"]),
                    "end": float(x["end"]),
                    "speaker": x.get("speaker") or x.get("label") or "SPEAKER_?",
                }
                for x in node
            ]
    keys = list(pred.keys()) if isinstance(pred, dict) else type(pred).__name__
    raise SystemExit(
        f"diarization 리스트 못 찾음 — 응답 최상위 키: {keys}\n"
        f"전체 구조는 {audio}.pyannoteai.json 에서 확인 후 알려주세요(extract_turns 경로 보강)."
    )


def main():
    global audio
    audio = sys.argv[1] if len(sys.argv) > 1 else "crop_m4a.m4a"
    num = int(sys.argv[2]) if len(sys.argv) > 2 else None  # None=자동, 3=고정

    client = Client()  # PYANNOTEAI_API_KEY 환경변수 사용
    print(f"업로드: {audio}")
    media = client.upload(audio)
    print(f"diarize 제출 (model=precision-2, num_speakers={num})...")
    job = client.diarize(media, num_speakers=num, model="precision-2")
    print(f"job: {job} — 결과 폴링(완료까지 대기)...")
    pred = client.retrieve(job)

    raw = audio + ".pyannoteai.json"
    with open(raw, "w", encoding="utf-8") as f:
        json.dump(pred, f, ensure_ascii=False, indent=2, default=str)

    turns = extract_turns(pred)
    tsv = audio + ".diar.tsv"
    with open(tsv, "w", encoding="utf-8") as f:
        for t in turns:
            f.write(f"{t['start']:.3f}\t{t['end']:.3f}\t{t['speaker']}\n")

    print(f"\n저장: {tsv}  ({len(turns)} turns)")
    print(f"원시 응답: {raw}")
    print(f"다음: python3 scripts/diar_eval.py '{tsv}'")


if __name__ == "__main__":
    main()
