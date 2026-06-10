# 화자분리 기준선(Phase 1) — 검증 pyannote 엔진 vs CLOVA 점수 비교

옛 자작 `diarize.rs`는 **폐기**. 검증된 pyannote 계열 엔진을 **한 번** 돌려, CLOVA가 깔끔히
가른 같은 음원에서 **얼마나 잘 가르는지 숫자로** 확인한다. 이 결과가 Phase 2(앱 통합) 진입
게이트다. 앱 코드는 아직 건드리지 않는다.

## 판정 기준 (유일)

각 화자 라벨의 **purity ≥ 70%**, 특히 **형제(양재현·양재문)가 서로 다른 라벨로 각각 70%+**.
- 자작 베이스라인(윈도우+AHC) = **가중 purity 52.7%, 형제 변별 실패**.
- 50%대에 머물면 → pyannote로도 이 음원 한계 → 등록 기반 식별(Phase 3)로.

## 실행 (crop 10분 파일로! 정답지가 crop 0~612초 기준)

두 경로 중 하나. **둘 다 같은 pyannote 모델군**이라 천장은 비슷하다.

### Route A — pyannote.ai 클라우드 (권장: 앱에 넣을 바로 그 엔진)
```bash
pip install requests
export PYANNOTEAI_API_KEY=...        # dashboard.pyannote.ai 발급
python3 scripts/baseline_diarize_pyannoteai.py /경로/crop_m4a.m4a 3
python3 scripts/diar_eval.py /경로/crop_m4a.m4a.diar.tsv
```

### Route B — WhisperX 로컬 (프록시: API 키 없이)
```bash
pip install whisperx
export HF_TOKEN=hf_xxx               # HF에서 pyannote/segmentation-3.0 + speaker-diarization-3.1 'Accept'
python3 scripts/baseline_diarize_whisperx.py /경로/crop_m4a.m4a 3
python3 scripts/diar_eval.py /경로/crop_m4a.m4a.diar.tsv
```

## 결과 해석

`scripts/diar_eval.py`가 출력하는 표에서:
- 각 라벨이 `→위치현태/양재현/양재문` 중 하나로 **70%+ ✅** 면 그 화자를 제대로 잡은 것.
- 맨 끝 `✅ 형제 변별 성공` 이 떠야 진짜 통과. (`❌ 형제 변별 실패`면 핵심 난관 미해결.)

→ 통과: Phase 2(클라우드 diarization을 앱에 통합, `diarize_cloud.rs`)로.
→ 실패: Phase 3(등록 기반 식별) 우선, 또는 이 음원은 CLOVA가 합리적이라는 결론.

## 채점기 입력 포맷 (scripts/diar_eval.py)

자동 감지: ① 앱 콘솔 `start–end → 화자N`  ② RTTM  ③ TSV `start⇥end⇥speaker`.
(정답지 CLOVA(검단산로) 0~612초는 스크립트에 내장. 다른 음원이면 GT_CHANGES 교체.)
