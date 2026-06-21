import { describe, it, expect } from 'vitest';
import { generateDiff, applyDiff, extractJsonObject, humanizeLLMError } from './aiService';

// 구독/키 호출 에러(특히 Tauri invoke 의 문자열 reject)를 사용자 안내로 변환 — usage limit /
// 인증 만료 / billing 등이 막연한 fallback 대신 구체 문구로 뜨는지 검증(에러 설명 보강).
describe('humanizeLLMError — LLM 에러 → 사용자 안내 변환', () => {
    it('Codex 구독 usage limit → ChatGPT 구독 한도 안내', () => {
        expect(humanizeLLMError('HTTP 429 — {"error":{"type":"usage_limit_reached"}}'))
            .toContain('ChatGPT 구독 사용 한도');
    });
    it('인증 만료(401) → 재로그인/키 확인 안내', () => {
        expect(humanizeLLMError('HTTP 401 — Unauthorized')).toContain('인증이 만료');
    });
    it('billing 하드 한도 → 결제·한도 안내(429 보다 우선)', () => {
        expect(humanizeLLMError('HTTP 429 — billing hard limit reached')).toContain('결제');
    });
    it('일반 rate limit(429) → 요청 한도 안내', () => {
        expect(humanizeLLMError('HTTP 429 — rate limit exceeded')).toContain('요청 한도');
    });
    it('설정 유도(API 키 없음) 메시지는 그대로 노출', () => {
        const raw = 'Gemini API 키가 설정되지 않았습니다. 설정에서 입력해주세요.';
        expect(humanizeLLMError(new Error(raw))).toBe(raw);
    });
    it('알 수 없는 에러는 원문 단서를 노출(막연한 fallback 아님)', () => {
        expect(humanizeLLMError('something weird happened xyz')).toContain('something weird happened xyz');
    });
    it('Error 객체와 문자열 입력 모두 동일 처리', () => {
        expect(humanizeLLMError(new Error('HTTP 401 — bad'))).toContain('인증이 만료');
        expect(humanizeLLMError('HTTP 401 — bad')).toContain('인증이 만료');
    });
});

// callAIJson 의 방어적 파서 — Gemini 외 프로바이더는 JSON 을 문자열로 주고 산문/펜스를 덧붙이기도
// 한다. 첫 균형 중괄호 객체만 정확히 잘라내는지 검증(메모리: 멀티 프로바이더 JSON 견고성).
describe('extractJsonObject — 방어적 JSON 추출', () => {
    it('순수 JSON 은 그대로', () => {
        const s = '{"children":[{"label":"A"}]}';
        expect(JSON.parse(extractJsonObject(s))).toEqual({ children: [{ label: 'A' }] });
    });

    it('```json 펜스를 벗긴다', () => {
        const s = '```json\n{"a":1}\n```';
        expect(JSON.parse(extractJsonObject(s))).toEqual({ a: 1 });
    });

    it('앞에 산문이 붙어도 첫 객체를 추출', () => {
        const s = 'Here is the result:\n{"a":1,"b":2}\nDone.';
        expect(JSON.parse(extractJsonObject(s))).toEqual({ a: 1, b: 2 });
    });

    it('중첩 객체의 균형 중괄호를 보존', () => {
        const s = 'x {"a":{"b":{"c":1}},"d":2} y';
        expect(JSON.parse(extractJsonObject(s))).toEqual({ a: { b: { c: 1 } }, d: 2 });
    });

    it('문자열 안의 중괄호는 깊이 계산에서 제외', () => {
        const s = '{"label":"a } b { c","n":1}';
        expect(JSON.parse(extractJsonObject(s))).toEqual({ label: 'a } b { c', n: 1 });
    });

    it('이스케이프된 따옴표를 올바르게 처리', () => {
        const s = '{"q":"say \\"hi\\" }"}';
        expect(JSON.parse(extractJsonObject(s))).toEqual({ q: 'say "hi" }' });
    });
});

// #36 — generateDiff 의 paragraph/word LCS 는 O(m·n) DP 라 대형 입력에서 메인 스레드를
// 막는다. 일정 규모(LCS_CELL_LIMIT = 200만 셀) 초과 시 "전체 교체"로 폴백하는 가드를 검증.
describe('generateDiff 대형 문서 가드(#36)', () => {
    it('일반 크기는 정밀 diff — 공통 문단을 unchanged 로 보존', () => {
        const orig = 'keep\n\nold\n\nkeep2';
        const mod = 'keep\n\nnew\n\nkeep2';
        const chunks = generateDiff(orig, mod);
        const unchanged = chunks
            .filter((c) => c.type === 'unchanged' && c.content)
            .map((c) => c.content);
        expect(unchanged).toContain('keep');
        expect(unchanged).toContain('keep2');
        // 변경 문단은 removed/added 로 표현
        expect(chunks.some((c) => c.type === 'removed')).toBe(true);
        expect(chunks.some((c) => c.type === 'added')).toBe(true);
    });

    it('문단 수가 임계를 넘으면 전체 교체로 폴백 — 공통 문단도 unchanged 로 잡히지 않음', () => {
        // 앞 1500 문단은 양쪽 동일. 정밀 diff 라면 전부 unchanged 로 보존됐을 것.
        const common = Array.from({ length: 1500 }, (_, i) => `c${i}`);
        const orig = [...common, 'tail-o'].join('\n\n'); // 1501 문단
        const mod = [...common, 'tail-m'].join('\n\n'); // 1501 문단 → 1501² ≈ 225만 > 200만
        const chunks = generateDiff(orig, mod);
        const unchanged = chunks.filter((c) => c.type === 'unchanged' && c.content);
        // 폴백이면 공통 문단(c0..c1499)도 unchanged 가 아니라 removed/added 로 나뉜다.
        expect(unchanged).toHaveLength(0);
        expect(chunks.some((c) => c.type === 'removed')).toBe(true);
        expect(chunks.some((c) => c.type === 'added')).toBe(true);
    });

    it('줄바꿈 없는 초대형 단일 문단도 가드로 처리(word LCS 폭발 방지)', () => {
        // 한 문단 안 토큰 수가 커서 wordDiff 의 토큰 LCS 가 폭발할 입력.
        const orig = Array.from({ length: 3000 }, (_, i) => `wo${i}`).join(' ');
        const mod = Array.from({ length: 3000 }, (_, i) => `wm${i}`).join(' ');
        // 단일 문단 쌍이므로 generateDiff 진입 가드(문단 1×1)는 통과 → wordDiff 가드가 받음.
        const chunks = generateDiff(orig, mod);
        // 예외 없이 removed/added 가 생성되면 통과(폭발 시 행/크래시 발생).
        expect(chunks.some((c) => c.type === 'removed')).toBe(true);
        expect(chunks.some((c) => c.type === 'added')).toBe(true);
    });

    it('대형 문서 폴백을 applyDiff 하면 원본/수정본이 정확히 복원(separator 가짜 빈 줄 없음, #36 P2-1)', () => {
        const common = Array.from({ length: 1500 }, (_, i) => `c${i}`);
        const orig = [...common, 'tail-o'].join('\n\n'); // 1501 문단
        const mod = [...common, 'tail-m'].join('\n\n'); // 1501² > 200만 → 폴백
        const chunks = generateDiff(orig, mod);
        // accept-all → 수정본 정확 복원 (선두 가짜 빈 줄 없음)
        expect(applyDiff(chunks.map((c) => ({ ...c, accepted: true })))).toBe(mod);
        // reject-all → 원본 정확 복원 (후미 가짜 빈 줄 없음)
        expect(applyDiff(chunks.map((c) => ({ ...c, accepted: false })))).toBe(orig);
    });
});
