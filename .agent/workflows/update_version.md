---
description: 작업 내용을 분석하여 적절한 버전(patch/minor/major)을 자동 판단하고 업데이트
---

# Version Update Workflow

이 워크플로우는 현재 세션의 작업 내용을 분석하여 적절한 semver 버전을 판단하고, `package.json`과 `tauri.conf.json`을 동시에 업데이트합니다.

## Steps

### 1. 현재 버전 확인

`package.json`의 `version` 필드를 확인하여 현재 버전을 파악합니다.

```bash
node -e "console.log('Current version: v' + require('./package.json').version)"
```

### 2. 작업 내용 분석 및 버전 판단

이번 세션에서 수행된 작업을 분석하여 아래 기준으로 적절한 버전 타입을 판단합니다:

**판단 기준:**

| Type | 기준 | 예시 |
|------|------|------|
| `patch` | 버그 수정, 설정 변경, 아이콘 교체, 문서 수정, 스타일 미세 조정 | 권한 누락 수정, 오타 수정, CSS 조정 |
| `minor` | 새 기능 추가, UI 컴포넌트 추가, 사용자에게 보이는 변경 | 버전 표시 기능, 새 패널, 단축키 추가 |
| `major` | Breaking change, 구조 대폭 변경, API 호환성 깨짐 | 데이터 스키마 변경, 플러그인 시스템 도입 |

**판단 규칙:**
- 여러 종류의 변경이 섞여 있으면 **가장 높은 레벨**을 적용합니다.
- 확신이 없으면 유저에게 질문합니다: *"이번 변경은 [요약]입니다. `minor` 버전 업으로 진행할까요, 아니면 `patch`로 하시겠어요?"*
- 유저가 `/update_version`만 입력했다면, **반드시 최근 작업 내역을 먼저 분석**한 후 판단합니다.

### 3. 유저에게 확인

판단한 버전 타입과 이유를 유저에게 보고하고 승인을 받습니다:

```
이번 세션 작업 요약:
- [변경사항 1]
- [변경사항 2]
- ...

→ `{patch|minor|major}` 버전 업을 추천합니다. (v0.1.0 → v0.x.x)
진행할까요?
```

### 4. 버전 업데이트 실행

유저 승인 후 해당 명령어를 실행합니다:

// turbo
```bash
# patch의 경우:
npm run version:patch

# minor의 경우:
npm run version:minor

# major의 경우:
npm run version:major
```

### 5. 결과 확인

// turbo
```bash
node -e "const p=require('./package.json');const t=require('./src-tauri/tauri.conf.json');console.log('package.json: v'+p.version);console.log('tauri.conf.json: v'+t.version);console.log(p.version===t.version?'✅ Synced':'❌ Mismatch!')"
```

### 6. 완료 보고

유저에게 최종 결과를 보고합니다:

```
✅ 버전 업데이트 완료: v{이전} → v{새 버전}
- package.json ✓
- tauri.conf.json ✓

다음 빌드 시 StatusBar에 새 버전이 표시됩니다.
```
