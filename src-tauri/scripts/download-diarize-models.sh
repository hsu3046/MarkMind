#!/usr/bin/env bash
# pyannote-rs 의 ONNX 모델 2개 다운로드 → src-tauri/resources/ 에 배치.
# 빌드 시 .app 안에 동봉 (tauri.conf.json bundle.resources).
#
# 모델:
#   - segmentation-3.0.onnx (~6MB) — pyannote segmentation
#   - wespeaker_en_voxceleb_CAM++.onnx (~28MB) — speaker embedding
# 라이선스: MIT (pyannote-rs releases), 원본은 pyannote/wespeaker (각각 MIT/Apache-2.0)

set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p resources

BASE="https://github.com/thewh1teagle/pyannote-rs/releases/download/v0.1.0"

download() {
    local name="$1"
    local out="resources/${name}"
    if [ -s "$out" ]; then
        echo "✓ exists: $out ($(du -h "$out" | cut -f1))"
        return
    fi
    echo "↓ ${name}"
    curl -fsSL -o "$out" "${BASE}/${name}"
    echo "✓ $out ($(du -h "$out" | cut -f1))"
}

download "segmentation-3.0.onnx"
download "wespeaker_en_voxceleb_CAM++.onnx"

echo ""
echo "✓ 화자 분리 ONNX 모델 동봉 준비 완료."
