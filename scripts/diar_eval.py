#!/usr/bin/env python3
"""화자 분리 평가 — diar 타임라인을 CLOVA 정답지에 매핑 집계.

판정 기준(유일): 각 diar 화자 라벨이 한 실제 화자에게 몇 % 몰리는가(purity).
70%+ 면 그 클러스터가 한 사람을 제대로 잡은 것, 50%대 분산이면 실패.

지원 입력 포맷 (자동 감지, 한 파일에 섞여도 됨):
  1) MarkMind 앱 콘솔:  "...  12.3–45.6  → 화자2"      (초 단위, en-dash/하이픈/물결)
  2) RTTM (pyannote):   "SPEAKER file 1 12.30 33.30 <NA> <NA> SPEAKER_01 <NA> <NA>"
  3) TSV/공백 3열:       "12.30  45.60  SPEAKER_01"       (start end label)

사용법:
    python3 scripts/diar_eval.py <diar_output.(txt|rttm|tsv)>
    pbpaste | python3 scripts/diar_eval.py -

기준선 비교: MarkMind 자작(윈도우+AHC) = 가중 purity 52.7% (위치현태·양재현 5:5 융합).
"""
import sys, re
from collections import defaultdict, Counter

# ── CLOVA 정답지(검단산로) — crop_m4a 첫 ~612초. (변화시점 초, 실제화자) ──
# A=위치현태, B=양재현, C=양재문
GT_CHANGES = [
    (0, "A"), (53, "B"), (55, "A"), (59, "B"), (61, "B"), (135, "B"),
    (170, "A"), (222, "A"), (233, "B"), (237, "A"), (262, "C"), (277, "B"),
    (341, "A"), (353, "B"), (359, "B"), (370, "A"), (374, "B"), (375, "C"),
    (376, "B"), (394, "C"), (400, "A"), (401, "C"), (403, "A"), (423, "B"),
    (425, "A"), (428, "B"), (431, "A"), (451, "B"), (455, "A"), (467, "B"),
    (473, "A"), (526, "B"), (565, "A"), (578, "B"), (579, "A"),
]
GT_END = 612.0
REAL_NAMES = {"A": "위치현태", "B": "양재현", "C": "양재문"}


def gt_intervals():
    out = []
    for i, (start, spk) in enumerate(GT_CHANGES):
        end = GT_CHANGES[i + 1][0] if i + 1 < len(GT_CHANGES) else GT_END
        if end > start:
            out.append((float(start), float(end), spk))
    return out


def overlap_by_real(s, e, gt):
    acc = defaultdict(float)
    for gs, ge, spk in gt:
        ov = max(0.0, min(e, ge) - max(s, gs))
        if ov > 0:
            acc[spk] += ov
    return acc


# ── 다중 포맷 파서 → [(start, end, label)] ──
APP_RE = re.compile(r"(\d+(?:\.\d+)?)\s*[–\-~]\s*(\d+(?:\.\d+)?).*?(화자\s*\d+|SPEAKER[_ ]?\d+|spk[_ ]?\d+)", re.I)


def parse(text):
    rows = []
    for line in text.splitlines():
        ls = line.strip()
        if not ls:
            continue
        # RTTM: SPEAKER <file> 1 <start> <dur> <NA> <NA> <spk> ...
        if ls.upper().startswith("SPEAKER "):
            f = ls.split()
            if len(f) >= 8:
                try:
                    st, du = float(f[3]), float(f[4])
                    if du > 0:
                        rows.append((st, st + du, f[7]))
                        continue
                except ValueError:
                    pass
        # 앱 콘솔: start–end → 화자N
        m = APP_RE.search(ls)
        if m:
            s, e = float(m.group(1)), float(m.group(2))
            if e > s:
                rows.append((s, e, re.sub(r"\s+", "", m.group(3))))
                continue
        # TSV/공백 3열: start end label
        f = re.split(r"[\t ]+", ls)
        if len(f) >= 3:
            try:
                s, e = float(f[0]), float(f[1])
                if e > s:
                    rows.append((s, e, f[2]))
            except ValueError:
                pass
    return rows


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else "-"
    text = sys.stdin.read() if src == "-" else open(src, encoding="utf-8").read()
    diar = parse(text)
    if not diar:
        print("diar 구간을 못 찾음 (앱 콘솔 / RTTM / TSV 형식 필요)")
        return
    gt = gt_intervals()

    mat = defaultdict(lambda: defaultdict(float))
    for s, e, lab in diar:
        for spk, sec in overlap_by_real(s, e, gt).items():
            mat[lab][spk] += sec

    labels = sorted(mat.keys())
    print(f"\n총 diar 구간 {len(diar)}개, diar 화자 라벨 {len(labels)}개\n")
    print(f"{'label':>12} | {'위치현태':>8} {'양재현':>8} {'양재문':>8} | {'purity':>7} 판정")
    print("-" * 66)
    correct = total = 0.0
    cluster_to_real = {}
    for lab in labels:
        d = mat[lab]
        tot = sum(d.values())
        a, b, c = d.get("A", 0), d.get("B", 0), d.get("C", 0)
        best = max(("A", "B", "C"), key=lambda k: d.get(k, 0))
        pur = (d.get(best, 0) / tot * 100) if tot else 0
        cluster_to_real[lab] = best
        v = "✅" if pur >= 70 else ("⚠️" if pur >= 60 else "❌")
        print(f"{lab:>12} | {a:8.1f} {b:8.1f} {c:8.1f} | {pur:6.1f}% {v} →{REAL_NAMES[best]}")
        correct += d.get(best, 0)
        total += tot
    print("-" * 66)
    acc = correct / total * 100 if total else 0
    print(f"\n가중 평균 purity(전체 정확도 상한): {acc:.1f}%   [자작 베이스라인 52.7%]")
    coll = {REAL_NAMES[k]: v for k, v in Counter(cluster_to_real.values()).items() if v > 1}
    if coll:
        print(f"⚠️ 매핑 충돌(여러 라벨이 같은 사람): {coll} — 한 사람이 여러 화자로 쪼개짐")
    missing = [REAL_NAMES[m] for m in set(REAL_NAMES) - set(cluster_to_real.values())]
    if missing:
        print(f"⚠️ 놓친 실제 화자: {missing} — 아예 못 잡음")
    # 형제(B=양재현, C=양재문) 변별 여부 — 서로 다른 라벨이 각각 70%+로 잡혔는가
    bro = {"B": None, "C": None}
    for lab in labels:
        d = mat[lab]; tot = sum(d.values())
        for k in ("B", "C"):
            if tot and d.get(k, 0) / tot >= 0.7 and (bro[k] is None):
                bro[k] = lab
    if bro["B"] and bro["C"] and bro["B"] != bro["C"]:
        print(f"✅ 형제 변별 성공: 양재현={bro['B']}, 양재문={bro['C']}")
    else:
        print("❌ 형제 변별 실패(양재현·양재문이 각각 한 라벨로 70%+ 안 잡힘) — 이 음원의 핵심 난관")
    print()


if __name__ == "__main__":
    main()
