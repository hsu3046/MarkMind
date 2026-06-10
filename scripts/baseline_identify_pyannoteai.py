"""Phase 1 결정 테스트 — pyannote.ai '등록 기반 식별(identify)'이 형제(양재문) 천장을
넘는지 확인. 화자별 reference 음성 → voiceprint → 전체를 voiceprint에 최근접 매칭.
비지도 diarize가 못 가른 양재문을 등록으로 잡으면 → Phase 2는 identify 기반으로 통합.

== 준비 ==
  export PYANNOTEAI_API_KEY=...

== reference 클립 추출 (CLOVA 정답지의 단독 발화 구간) ==
  A=/Users/jaemoonyeah/Documents/crop_m4a.m4a
  ffmpeg -y -i "$A" -ss 5   -to 20  -ac 1 -ar 16000 ref_wichi.wav    # 위치현태
  ffmpeg -y -i "$A" -ss 75  -to 120 -ac 1 -ar 16000 ref_jaehyun.wav  # 양재현
  ffmpeg -y -i "$A" -ss 263 -to 275 -ac 1 -ar 16000 ref_jaemun.wav   # 양재문

== 실행 (순서 = 위치현태, 양재현, 양재문) ==
  python3 scripts/baseline_identify_pyannoteai.py "$A" ref_wichi.wav ref_jaehyun.wav ref_jaemun.wav

== 채점 ==
  python3 scripts/diar_eval.py "$A".diar.tsv
"""
import sys
import json
from pyannoteai.sdk import Client

LABELS = ["위치현태", "양재현", "양재문"]


def vp_from(job):
    out = job.get("output", {}) if isinstance(job, dict) else {}
    for k in ("voiceprint", "voiceprints", "embedding"):
        if k in out:
            return out[k]
    raise SystemExit(f"voiceprint 키 못 찾음 — output keys: {list(out.keys())}")


def turns_from(job):
    diar = job.get("output", {}).get("diarization")
    if not diar:
        raise SystemExit(f"diarization 없음 — output keys: {list(job.get('output', {}).keys())}")
    return [(float(x["start"]), float(x["end"]), x.get("speaker") or x.get("label") or "?") for x in diar]


def main():
    full = sys.argv[1]
    refs = sys.argv[2:5]
    if len(refs) != 3:
        raise SystemExit("reference 클립 3개 필요 (위치현태, 양재현, 양재문 순)")

    client = Client()
    vps = {}
    for lab, ref in zip(LABELS, refs):
        print(f"voiceprint: {lab} <- {ref}")
        media = client.upload(ref)
        job = client.retrieve(client.voiceprint(media))
        vps[lab] = vp_from(job)

    print("identify (전체 음원)...")
    media = client.upload(full)
    job = client.retrieve(client.identify(media, voiceprints=vps, num_speakers=3))

    with open(full + ".identify.json", "w", encoding="utf-8") as f:
        json.dump(job, f, ensure_ascii=False, indent=2, default=str)

    turns = turns_from(job)
    tsv = full + ".diar.tsv"
    with open(tsv, "w", encoding="utf-8") as f:
        for s, e, spk in turns:
            f.write(f"{s:.3f}\t{e:.3f}\t{spk}\n")
    print(f"\n저장: {tsv}  ({len(turns)} turns), 원시: {full}.identify.json")
    print(f"다음: python3 scripts/diar_eval.py '{tsv}'")


if __name__ == "__main__":
    main()
