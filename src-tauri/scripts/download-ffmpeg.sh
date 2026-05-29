#!/usr/bin/env bash
# evermeet.cx 에서 ffmpeg + ffprobe 받아 src-tauri/binaries/ 에 Tauri 가
# 인식하는 이름 ({name}-{target-triple}) 으로 배치.
#
# 호출: src-tauri 디렉토리 안에서 또는 scripts/ 안에서 실행 가능.
#       Tauri 의 beforeBuildCommand 또는 npm run setup:ffmpeg 로도 호출.
#
# 라이선스: evermeet.cx 빌드는 LGPL — 배포 시 LICENSE-LGPL.txt 동봉 권장.

set -euo pipefail

cd "$(dirname "$0")/.."

# Target triple — `FFMPEG_TARGET` 환경변수가 있으면 그걸 우선시 (CI matrix
# 가 빌드 대상별로 정확한 target 지정 가능). 미지정 시 host triple 자동
# 감지 (로컬 개발자 경험 유지).
TARGET="${FFMPEG_TARGET:-}"
if [ -z "$TARGET" ]; then
    TARGET="$(rustc -vV | sed -n 's/^host: //p')"
fi
if [ -z "$TARGET" ]; then
    echo "✗ target triple 감지 실패 (FFMPEG_TARGET 환경변수로 지정 가능)" >&2
    exit 1
fi

case "$TARGET" in
    aarch64-apple-darwin|x86_64-apple-darwin) ;;
    *)
        echo "✗ 지원 안 함: $TARGET (macOS arm64/x86_64 만 지원)" >&2
        exit 1
        ;;
esac

mkdir -p binaries

download() {
    local name="$1"
    local url="https://evermeet.cx/ffmpeg/getrelease/${name}/zip"
    local out="binaries/${name}-${TARGET}"

    if [ -x "$out" ]; then
        echo "✓ exists: $out"
        return
    fi

    echo "↓ ${name} (target=${TARGET})"
    local tmpdir
    tmpdir=$(mktemp -d)
    curl -fsSL -o "${tmpdir}/${name}.zip" "$url"
    unzip -q "${tmpdir}/${name}.zip" -d "$tmpdir"
    mv "${tmpdir}/${name}" "$out"
    chmod +x "$out"
    rm -rf "$tmpdir"
    echo "✓ $out ($(du -h "$out" | cut -f1))"
}

download ffmpeg
download ffprobe

echo ""
echo "✓ ffmpeg/ffprobe 동봉 준비 완료. Tauri 빌드 시 자동으로 .app 안에 포함됩니다."
