# 제품 출시 칸반 샘플

이 파일은 **Kanban View(⌘6)** 와 **Gantt View(⌘5)** 를 함께 확인하기 위한 샘플입니다.

- Kanban은 `@status(todo|doing|review|blocked|done)` 를 우선 읽습니다.
- `@status`가 없으면 `[x]` 또는 `@progress(100)` 은 Done, `@progress(1~99)` 는 Doing, 나머지는 Todo로 표시됩니다.
- `@start`, `@due`, `@progress` 는 Gantt와 Kanban 양쪽에서 같이 사용할 수 있습니다.
- 카드 클릭 시 원문 위치로 이동합니다.

## 백로그

- [ ] 가격 정책 확정 @status(todo) @priority(high) @start(2026-07-01) @due(2026-07-05)
- [ ] 온보딩 문구 정리 @status(todo) @priority(medium) @due(2026-07-08)
- 고객 인터뷰 추가 질문 정리 @status(todo)

## 진행 중

- [ ] 결제 플로우 구현 @status(doing) @priority(urgent) @start(2026-07-03) @due(2026-07-14) @progress(45)
- [ ] 대시보드 빈 상태 디자인 @status(doing) @start(2026-07-06) @due(2026-07-12) @progress(30)
- API 응답 속도 개선 @start(2026-07-04) @due(2026-07-10) @progress(60)

## 리뷰

- [ ] 랜딩 페이지 카피 리뷰 @status(review) @priority(low) @due(2026-07-09)
- [ ] 이메일 템플릿 검수 @status(qa) @start(2026-07-07) @due(2026-07-11) @progress(80)

## 차단

- [ ] 사업자 인증 승인 대기 @status(blocked) @priority(high) @start(2026-07-02) @due(2026-07-12)
- [ ] 외부 웹훅 문서 확인 @status(hold) @due(2026-07-10)

## 완료

- [x] 릴리스 체크리스트 초안 @start(2026-06-24) @due(2026-06-26)
- 분석 이벤트 네이밍 확정 @progress(100)
- 내부 공유용 데모 문서 작성 @status(done) @start(2026-06-28)
