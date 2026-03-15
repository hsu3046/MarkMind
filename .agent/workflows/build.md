---
description: Tauri 앱 프로덕션 빌드 (버전 업데이트 포함)
---

# Build Workflow

프로덕션 빌드를 실행합니다. 빌드 전에 자동으로 `/update_version` 워크플로우를 실행하여 버전을 업데이트합니다.

## Steps

### 1. 버전 업데이트

먼저 `/update_version` 워크플로우를 실행합니다.
작업 내용을 분석하여 적절한 버전(patch/minor/major)을 판단하고 유저 승인 후 업데이트합니다.

### 2. 프로덕션 빌드 실행

// turbo
```bash
npm run tauri build
```

> 빌드 시간은 약 2-5분 소요됩니다.

### 3. 빌드 결과 확인

// turbo
```bash
ls -lh src-tauri/target/release/bundle/macos/*.app
```

### 4. 완료 보고

유저에게 최종 결과를 보고합니다:

```
✅ 빌드 완료
- 버전: v{버전}
- 경로: src-tauri/target/release/bundle/macos/MarkMind.app
```
