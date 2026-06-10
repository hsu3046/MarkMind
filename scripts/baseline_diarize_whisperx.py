"""기준선(Phase 1) — WhisperX(= faster-whisper + wav2vec2 정렬 + pyannote 3.1)로
화자분리를 돌려, MarkMind 자작(52.7%) 대비 천장을 측정한다.

이 스크립트는 채점용 산출물 2개를 만든다:
  - <audio>.diar.tsv          : "start<TAB>end<TAB>speaker"  → scripts/diar_eval.py 로 채점
  - <audio>.diarized.txt      : 화자 주석 전사 (사람 확인용)

== 사전 준비 (한 번만) ==
  pip install whisperx
  # Hugging Face에서 아래 두 모델 'Accept' (안 하면 401):
  #   https://huggingface.co/pyannote/segmentation-3.0
  #   https://huggingface.co/pyannote/speaker-diarization-3.1
  export HF_TOKEN=hf_xxx

== 실행 (crop 10분으로! 정답지가 crop 0~612초 기준) ==
  python3 scripts/baseline_diarize_whisperx.py /경로/crop_m4a.m4a 3

== 채점 ==
  python3 scripts/diar_eval.py /경로/crop_m4a.m4a.diar.tsv
  # 화자별 purity 70%+ (특히 형제 변별 ✅) 이면 → 클라우드 통합 가치 확정.
  # 여전히 50%대면 → 등록 기반 식별(Phase 3)로.

Apple Silicon 메모: faster-whisper(CTranslate2)는 Metal 미지원이라 CPU. 10분 large-v3는
수 분. 느리면 model을 'medium'으로 낮추거나 whisply(MLX) 사용.
"""
import os
import sys
import whisperx


def fmt(t):
    return f"{int(t // 60):02d}:{int(t % 60):02d}"


def main():
    audio_path = sys.argv[1] if len(sys.argv) > 1 else "crop_m4a.m4a"
    num_speakers = int(sys.argv[2]) if len(sys.argv) > 2 else 3  # 위치현태/양재현/양재문
    lang = "ko"
    device = "cpu"          # Apple Silicon
    compute = "int8"        # CPU용. CUDA면 "float16"
    hf_token = os.environ["HF_TOKEN"]

    audio = whisperx.load_audio(audio_path)

    # 1) 전사 (faster-whisper large-v3)
    model = whisperx.load_model("large-v3", device, compute_type=compute, language=lang)
    result = model.transcribe(audio, batch_size=8, language=lang)

    # 2) 단어 단위 정렬 (한국어 wav2vec2) — 화자 경계 정밀도의 핵심
    align_model, meta = whisperx.load_align_model(language_code=lang, device=device)
    result = whisperx.align(result["segments"], align_model, meta, audio, device,
                            return_char_alignments=False)

    # 3) 화자분리 (pyannote 3.x). 화자 수 고정이 가장 안정적.
    try:
        from whisperx.diarize import DiarizationPipeline
    except ImportError:
        from whisperx import DiarizationPipeline
    diarize = DiarizationPipeline(use_auth_token=hf_token, device=device)
    diar_segments = diarize(audio, min_speakers=num_speakers, max_speakers=num_speakers)

    # 4) 단어별 화자 라벨을 전사에 할당
    result = whisperx.assign_word_speakers(diar_segments, result)

    # 5a) 채점용 TSV (start end speaker) — 세그먼트별 할당 결과
    tsv_path = audio_path + ".diar.tsv"
    with open(tsv_path, "w", encoding="utf-8") as f:
        for seg in result["segments"]:
            spk = seg.get("speaker", "SPEAKER_?")
            f.write(f"{seg['start']:.3f}\t{seg['end']:.3f}\t{spk}\n")

    # 5b) 사람 확인용 전사
    txt_path = audio_path + ".diarized.txt"
    lines = [f"[{fmt(s['start'])}] {s.get('speaker','SPEAKER_?')}: {s['text'].strip()}"
             for s in result["segments"]]
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    print("\n".join(lines[:30]))
    print(f"\n... 저장 완료")
    print(f"  채점용 TSV : {tsv_path}")
    print(f"  전사       : {txt_path}")
    print(f"\n다음: python3 scripts/diar_eval.py '{tsv_path}'")


if __name__ == "__main__":
    main()
