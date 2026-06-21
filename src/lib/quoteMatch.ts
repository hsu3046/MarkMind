/**
 * 하이라이트용 — 인용 텍스트들을 "줄 단위" 로 분해(중복 제거, 너무 짧은 줄 제외).
 * 여러 줄 전체 정규식(`A\s*\n+\s*B...`)은 특수문자·긴 패턴·backtrack 에 약해 통째로 실패하므로,
 * 각 줄을 개별 indexOf 로 찾는 게 견고하다. Editor(마크다운 doc)·Preview(Tiptap text 노드) 공유.
 */
export function quoteLines(texts: string[]): string[] {
    return [...new Set(texts.flatMap((t) => t.split('\n').map((l) => l.trim()).filter((l) => l.length > 1)))];
}

/** md 에서 text 의 범위(없으면 null) — 줄 번호 계산용. 여러 줄 선택은 전체 정규식이 특수문자·
 *  backtrack 으로 약하므로, 첫 줄과 끝 줄을 각각 indexOf 로 잡아 from~to 를 구성(견고). */
export function quoteRange(md: string, text: string): { from: number; to: number } | null {
    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 1);
    if (lines.length === 0) {
        // 한 글자 등 너무 짧은 선택 — 통짜로 시도.
        const t = text.trim();
        const i = t ? md.indexOf(t) : -1;
        return i >= 0 ? { from: i, to: i + t.length } : null;
    }
    const first = lines[0];
    const from = md.indexOf(first);
    if (from < 0) return null;
    if (lines.length === 1) return { from, to: from + first.length };
    const last = lines[lines.length - 1];
    const lastIdx = md.indexOf(last, from + first.length);
    return { from, to: lastIdx >= 0 ? lastIdx + last.length : from + first.length };
}
