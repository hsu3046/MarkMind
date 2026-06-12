import { Table } from '@tiptap/extension-table';
import { getHTMLFromFragment } from '@tiptap/core';
import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model';

// ─── tiptap-markdown 테이블 직렬화 보강 ───
//
// GFM 테이블은 셀 병합(colspan/rowspan)과 셀 내 다중 블록을 표현할 문법이 없음.
// tiptap-markdown 기본 table 직렬화기는 그런 테이블을 만나면 HTML 폴백을 타는데,
// 에디터가 html:false 라서 폴백이 `[table]` placeholder 텍스트만 출력 →
// 병합하는 순간 테이블 데이터 전체가 파괴되는 사고가 있었음.
//
// 이 확장은 기본 스펙을 덮어써서 (tiptap-markdown 의 getMarkdownSpec 은
// extension.storage.markdown 을 기본 스펙보다 우선):
//   - GFM 으로 표현 가능한 테이블 → 기본과 동일하게 GFM 파이프 테이블로 직렬화
//   - 표현 불가(병합/다중 블록) 테이블 → HTML <table> 로 직렬화 (데이터 보존,
//     HTML-in-Markdown 은 GFM 표준 관행)
//   - 로드 시 markdown-it 에 block rule 을 추가해, html:false 에서도
//     <table>…</table> 블록만은 raw HTML 로 통과 → ProseMirror DOMParser 가
//     colspan/rowspan 포함 테이블 노드로 복원 (round-trip 성립)

/** tiptap-markdown MarkdownSerializerState 중 사용하는 표면만 구조 타이핑 */
interface MarkdownState {
    inTable: boolean;
    write(content: string): void;
    ensureNewLine(): void;
    renderInline(node: ProseMirrorNode): void;
    closeBlock(node: ProseMirrorNode): void;
}

/** markdown-it StateBlock 중 사용하는 표면만 구조 타이핑 */
interface MdStateBlock {
    src: string;
    bMarks: number[];
    eMarks: number[];
    tShift: number[];
    blkIndent: number;
    line: number;
    push(type: string, tag: string, nesting: number): {
        map: [number, number] | null;
        content: string;
    };
    getLines(begin: number, end: number, indent: number, keepLastLF: boolean): string;
}

interface MdInstance {
    block: {
        ruler: {
            before(
                beforeName: string,
                ruleName: string,
                fn: (
                    state: MdStateBlock,
                    startLine: number,
                    endLine: number,
                    silent: boolean,
                ) => boolean,
            ): void;
        };
    };
}

function childNodes(node: ProseMirrorNode): ProseMirrorNode[] {
    const children: ProseMirrorNode[] = [];
    node.forEach((child) => children.push(child));
    return children;
}

function hasSpan(cell: ProseMirrorNode): boolean {
    return cell.attrs.colspan > 1 || cell.attrs.rowspan > 1;
}

/** tiptap-markdown 기본 판정과 동일 — 병합/다중 블록 셀이 있으면 GFM 표현 불가 */
function isGfmSerializable(node: ProseMirrorNode): boolean {
    const rows = childNodes(node);
    const firstRow = rows[0];
    if (!firstRow) return false;
    const bodyRows = rows.slice(1);

    if (
        childNodes(firstRow).some(
            (cell) => cell.type.name !== 'tableHeader' || hasSpan(cell) || cell.childCount > 1,
        )
    ) {
        return false;
    }
    if (
        bodyRows.some((row) =>
            childNodes(row).some(
                (cell) => cell.type.name === 'tableHeader' || hasSpan(cell) || cell.childCount > 1,
            ),
        )
    ) {
        return false;
    }
    return true;
}

// parse.setup 은 tiptap-markdown 이 parse 호출마다 모든 확장에 대해 실행 —
// 같은 markdown-it 인스턴스에 rule 중복 등록 방지
const patchedInstances = new WeakSet<object>();

/**
 * `<table` 로 시작하는 줄부터 `</table>` 로 끝나는 줄까지를 raw html_block
 * 토큰으로 통과시키는 markdown-it block rule. markdown-it 의 html_block
 * renderer 는 options.html 과 무관하게 content 를 raw 출력하므로,
 * 전역 html:false 를 유지한 채 테이블 HTML 만 선택적으로 허용된다.
 */
function htmlTableBlockRule(
    state: MdStateBlock,
    startLine: number,
    endLine: number,
    silent: boolean,
): boolean {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const firstLine = state.src.slice(start, state.eMarks[startLine]);
    if (!/^<table[\s>]/i.test(firstLine)) return false;

    // 닫는 태그가 줄 끝에 오는 라인까지 스캔 — 없으면 매치 포기 (일반 텍스트로 폴백)
    let closeLine = -1;
    for (let line = startLine; line < endLine; line++) {
        const text = state.src.slice(
            state.bMarks[line] + state.tShift[line],
            state.eMarks[line],
        );
        if (/<\/table>\s*$/i.test(text)) {
            closeLine = line;
            break;
        }
    }
    if (closeLine === -1) return false;
    if (silent) return true;

    const token = state.push('html_block', '', 0);
    token.map = [startLine, closeLine + 1];
    token.content = state.getLines(startLine, closeLine + 1, state.blkIndent, true);
    state.line = closeLine + 1;
    return true;
}

export const MarkdownTable = Table.extend({
    addStorage() {
        return {
            markdown: {
                serialize(state: MarkdownState, node: ProseMirrorNode) {
                    if (!isGfmSerializable(node)) {
                        // 병합/다중 블록 — HTML 로 직렬화해 데이터 보존
                        const html = getHTMLFromFragment(Fragment.from(node), node.type.schema);
                        state.write(html);
                        state.closeBlock(node);
                        return;
                    }
                    // GFM 파이프 테이블 — tiptap-markdown 기본 로직과 동일
                    state.inTable = true;
                    node.forEach((row, _offset, i) => {
                        state.write('| ');
                        row.forEach((col, _colOffset, j) => {
                            if (j) {
                                state.write(' | ');
                            }
                            const cellContent = col.firstChild;
                            if (cellContent && cellContent.textContent.trim()) {
                                state.renderInline(cellContent);
                            }
                        });
                        state.write(' |');
                        state.ensureNewLine();
                        if (!i) {
                            const delimiterRow = Array.from({ length: row.childCount })
                                .map(() => '---')
                                .join(' | ');
                            state.write(`| ${delimiterRow} |`);
                            state.ensureNewLine();
                        }
                    });
                    state.closeBlock(node);
                    state.inTable = false;
                },
                parse: {
                    setup(md: MdInstance) {
                        if (patchedInstances.has(md)) return;
                        patchedInstances.add(md);
                        md.block.ruler.before('paragraph', 'markmind_html_table', htmlTableBlockRule);
                    },
                },
            },
        };
    },
});
