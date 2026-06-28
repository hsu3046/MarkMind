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

function unescapeHtmlTagAttributes(value: string): string {
    return value
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#34;/g, '"')
        .replace(/&apos;|&#39;/g, "'")
        .replace(/&amp;/g, '&');
}

function restoreEscapedHtmlTags(src: string): string {
    let out = '';
    let i = 0;

    const isTagStart = (index: number): boolean => {
        let cursor = index + 4;
        if (src[cursor] === '/') cursor += 1;
        if (!/[A-Za-z]/.test(src[cursor] ?? '')) return false;
        cursor += 1;
        while (/[A-Za-z0-9-]/.test(src[cursor] ?? '')) cursor += 1;
        return src.startsWith('&gt;', cursor) || src[cursor] === '/' || /[ \t\r\n]/.test(src[cursor] ?? '');
    };

    while (i < src.length) {
        if (!src.startsWith('&lt;', i) || !isTagStart(i)) {
            out += src[i];
            i += 1;
            continue;
        }

        let quote: '"' | "'" | null = null;
        let close = -1;
        let j = i + 4;
        while (j < src.length) {
            if (quote == null && src.startsWith('&gt;', j)) {
                close = j;
                break;
            }
            if (src[j] === '"' || src.startsWith('&quot;', j) || src.startsWith('&#34;', j)) {
                quote = quote === '"' ? null : quote == null ? '"' : quote;
                j += src[j] === '"' ? 1 : src.startsWith('&quot;', j) ? 6 : 5;
                continue;
            }
            if (src[j] === "'" || src.startsWith('&apos;', j) || src.startsWith('&#39;', j)) {
                quote = quote === "'" ? null : quote == null ? "'" : quote;
                j += src[j] === "'" ? 1 : src.startsWith('&apos;', j) ? 6 : 5;
                continue;
            }
            j += 1;
        }

        if (close === -1) {
            out += src[i];
            i += 1;
            continue;
        }

        const inner = src.slice(i + 4, close);
        out += `<${unescapeHtmlTagAttributes(inner)}>`;
        i = close + 4;
    }

    return out;
}

function isMarkdownContainerContentStart(prefix: string): boolean {
    let rest = prefix;
    let changed = true;

    while (changed) {
        const before = rest;
        rest = rest
            .replace(/^[ \t]{0,3}(?:>|&gt;)[ \t]?/, '')
            .replace(/^[ \t]{0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+/, '')
            .replace(/^[ \t]*\[[ xX]\][ \t]+/, '');
        changed = rest !== before;
    }

    return /^[ \t]*$/.test(rest);
}

function restoreComparisonGreaterThan(src: string): string {
    return src.replace(/(^|[^\S\n])&gt;(?=[^\S\n])/g, (match, prefix: string, offset: number) => {
        const entityStart = offset + prefix.length;
        const lineStart = src.lastIndexOf('\n', entityStart - 1) + 1;
        const beforeOnLine = src.slice(lineStart, entityStart);
        if (isMarkdownContainerContentStart(beforeOnLine)) return match;
        return `${prefix}>`;
    });
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
//   ④ html:false 경로에서 raw HTML/주석/꺾쇠/footnote marker 가 entity 또는
//      escape 로 변하는 것을 일부 복원한다. 전역 html:true 는 켜지 않는다(#89).
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

    // ④ raw HTML/주석/비교 꺾쇠/footnote marker 복원
    result = result
        .replace(/&lt;!--([\s\S]*?)--&gt;/g, '<!--$1-->')
        .replace(/(^|[^\S\n])&lt;(?=[^\S\n])/g, '$1<')
        .replace(/\\\[\^([^\]\n]+)\\\]/g, '[^$1]');
    result = restoreComparisonGreaterThan(result);
    result = restoreEscapedHtmlTags(result);

    // ── 복원 ──
    result = result.replace(/\x00MMC(\d+)\x00/g, (_, n) => codes[Number(n)]);
    result = result.replace(/\x00MMN(\d+)\x00/g, (_, n) => fences[Number(n)]);
    return result;
}
