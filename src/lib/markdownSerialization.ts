function maskInlineCodeSpans(src: string, codes: string[]): string {
    let out = '';
    let i = 0;

    while (i < src.length) {
        if (src[i] !== '`') {
            out += src[i];
            i++;
            continue;
        }

        let openLen = 1;
        while (src[i + openLen] === '`') openLen++;

        let closeStart = -1;
        let closeEnd = -1;
        let j = i + openLen;
        while (j < src.length) {
            if (src[j] !== '`') {
                j++;
                continue;
            }
            let closeLen = 1;
            while (src[j + closeLen] === '`') closeLen++;
            if (closeLen === openLen) {
                closeStart = j;
                closeEnd = j + closeLen;
                break;
            }
            j += closeLen;
        }

        if (closeStart === -1) {
            out += src.slice(i, i + openLen);
            i += openLen;
            continue;
        }

        codes.push(src.slice(i, closeEnd));
        out += `\x00MMC${codes.length - 1}\x00`;
        i = closeEnd;
    }

    return out;
}

// tiptap-markdown 0.9.0 직렬화(getMarkdown) 후처리 — round-trip 시 끼어드는
// 불필요한 기호 제거(선별적). 코드(펜스/인라인)는 보호.
//   ① hardBreak 백슬래시: 라이브러리가 hardBreak 를 "\\\n" 로 직렬화 →
//      breaks:true 환경에선 '\n' 만으로 동일 렌더라 줄 끝 '\' 만 제거(개행 유지).
//   ② 표 셀의 block-marker escape(\#,\>,\+,\-,\1.): 셀 안에선 헤딩/리스트/인용이
//      될 수 없어 불필요 → 해제. 인라인 \*,\`,\[,\_ 는 보존(평문 특수문자 round-trip
//      안전성 위해 — 사용자 선택).
//   ③ literal single tilde escape(\~): GFM strike 는 `~~`만 사용하므로 일반 텍스트의
//      단일 물결표는 원문 품질을 위해 해제. `~~`/`~~~`를 새로 만들 수 있는 위치,
//      이중 백슬래시, 코드 영역은 보존.
export function normalizeSerializedMarkdown(md: string): string {
    // ── 코드펜스 보호 (joinBrokenTableRows 와 동일 마스킹) ──
    const fences: string[] = [];
    const srcLines = md.split('\n');
    const maskedLines: string[] = [];
    let i = 0;
    while (i < srcLines.length) {
        const line = srcLines[i];
        const open = line.match(/^[ ]{0,3}(([`~])\2{2,})/);
        if (open) {
            const ch = open[2];
            const minLen = open[1].length;
            const closeRe = new RegExp(`^[ ]{0,3}${ch === '`' ? '`' : '~'}{${minLen},}[ \\t]*$`);
            let j = i + 1;
            while (j < srcLines.length && !closeRe.test(srcLines[j])) j++;
            const endIdx = j < srcLines.length ? j + 1 : j;
            fences.push(srcLines.slice(i, endIdx).join('\n'));
            maskedLines.push(`\x00MMN${fences.length - 1}\x00`);
            i = endIdx;
            continue;
        }
        maskedLines.push(line);
        i++;
    }
    let result = maskedLines.join('\n');

    // ── 인라인 코드 보호 ──
    const codes: string[] = [];
    result = maskInlineCodeSpans(result, codes);

    // ① hardBreak 백슬래시 제거 (개행은 유지)
    result = result.replace(/\\(?=\n)/g, '').replace(/\\$/, '');

    // ② 표 행에서만 block-marker escape 해제
    result = result
        .split('\n')
        .map((ln) => {
            if (!/^\s*\|/.test(ln)) return ln;
            return ln
                .replace(/\\(#{1,6})/g, '$1')
                .replace(/\\([>+\-])/g, '$1')
                .replace(/(\d+)\\\./g, '$1.');
        })
        .join('\n');

    // ③ 일반 텍스트의 literal single tilde escape 해제
    result = result.replace(/\\~/g, (match, offset: number, src: string) => {
        const prev = src[offset - 1];
        const next = src[offset + 2];
        if (prev === '\\' || prev === '~' || next === '~') return match;
        return '~';
    });

    // ── 복원 ──
    result = result.replace(/\x00MMC(\d+)\x00/g, (_, n) => codes[Number(n)]);
    result = result.replace(/\x00MMN(\d+)\x00/g, (_, n) => fences[Number(n)]);
    return result;
}
