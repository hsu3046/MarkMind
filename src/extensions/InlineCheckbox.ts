// 인라인 체크박스 — table cell 안에서도 동작하는 클릭 가능한 [x] / [ ] 노드.
//
// 4-차원 검증 결과 반영 (verify-inline-checkbox-plan workflow):
// - markdown-it 의 list-item 충돌은 `core.ruler.after('inline', ...)` 후처리로 해결.
//   GFM task-list plugin 이 list_item 첫 [x] 를 이미 소화한 뒤 inline 토큰의
//   잔존 text 만 스캔 → `- [x]`, `1. [x]` 모두 자연 회피.
// - InputRule 은 즉시 변환 UX 위해 추가. regex 앞 \S 강제로 paragraph 시작
//   케이스 자연 회피 → @tiptap/extension-task-item 의 wrappingInputRule
//   (`^\s*[\[ x\]]\s$`) 과 충돌 없음.
// - stopEvent 는 mouse/touch/pointer/click/change 한정 → Backspace/Arrow keydown
//   이 ProseMirror 로 전달되어 atom 노드 정상 삭제·이동.
// - chain 안에서 `tr.doc.nodeAt(pos)` 재조회 → 외부 변경 race 회피.
// - tiptap-markdown 0.9.0 검증: extension.storage.markdown.{serialize, parse.setup}
//   이 MarkdownParser/Serializer 가 자동 수집하는 hook. setup(md) 가 markdown-it
//   instance 받아 inline ruler 등록.
//
// Read-only ReactMarkdown 경로 (split mode preview pane) 와 별개 — 해당 경로는
// remark-gfm 통과로 `[x]` 가 plain text 로 표시됨. Rich Text 모드 전용 기능.

import { Node, mergeAttributes, InputRule } from '@tiptap/core';

export const InlineCheckbox = Node.create({
    name: 'inlineCheckbox',
    // task-item (priority 51) 보다 높게 → cell/textmid 에서 우리가 먼저 매치.
    // paragraph 시작 + non-cell/non-list 케이스는 handler 안에서 task-item 에 양보.
    priority: 60,
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,
    draggable: false,

    addAttributes() {
        return {
            checked: {
                default: false,
                parseHTML: (el) => el.getAttribute('data-checked') === 'true',
                renderHTML: (attrs) => ({
                    'data-checked': attrs.checked ? 'true' : 'false',
                }),
            },
        };
    },

    parseHTML() {
        return [{ tag: 'span[data-type="inline-checkbox"]' }];
    },

    renderHTML({ HTMLAttributes }) {
        return [
            'span',
            mergeAttributes(HTMLAttributes, { 'data-type': 'inline-checkbox' }),
        ];
    },

    addNodeView() {
        return ({ node, getPos, editor }) => {
            const wrapper = document.createElement('label');
            wrapper.setAttribute('data-type', 'inline-checkbox');
            wrapper.contentEditable = 'false';
            wrapper.className = 'inline-cb-wrapper';

            const input = document.createElement('input');
            input.type = 'checkbox';
            input.className = 'inline-cb';
            input.checked = !!node.attrs.checked;

            // ProseMirror selection 점프 차단 (TaskItem 패턴 검증됨)
            input.addEventListener('mousedown', (e) => e.preventDefault());

            input.addEventListener('change', () => {
                if (!editor.isEditable) {
                    input.checked = !input.checked;
                    return;
                }
                const checked = input.checked;
                editor
                    .chain()
                    .focus(undefined, { scrollIntoView: false })
                    .command(({ tr }) => {
                        const pos = typeof getPos === 'function' ? getPos() : null;
                        if (typeof pos !== 'number') return false;
                        // tr.doc 기준 재조회 — race/stale 회피
                        const cur = tr.doc.nodeAt(pos);
                        if (!cur || cur.type.name !== 'inlineCheckbox') return false;
                        tr.setNodeMarkup(pos, undefined, { ...cur.attrs, checked });
                        return true;
                    })
                    .run();
            });

            wrapper.appendChild(input);

            return {
                dom: wrapper,
                update: (updated) => {
                    if (updated.type.name !== 'inlineCheckbox') return false;
                    input.checked = !!updated.attrs.checked;
                    return true;
                },
                // mouse/touch/pointer/click/change 만 ProseMirror 에서 격리.
                // keyboard event (Backspace, Arrow) 는 통과 → atom 노드 정상 삭제·이동.
                // (Node 는 @tiptap/core 의 Node 와 shadow 되어 globalThis.Node 명시)
                stopEvent: (ev: Event) =>
                    wrapper.contains(ev.target as globalThis.Node) &&
                    /^(mouse|touch|pointer|click|change)/.test(ev.type),
                ignoreMutation: () => true,
            };
        };
    },

    addInputRules() {
        // 즉시 변환 (A2 + Codex P2 fix) — 사용자가 `[x] ` 또는 `[ ] ` 타이핑하면
        // 즉시 체크박스. nodeInputRule 대신 직접 InputRule — handler 안에서
        // 컨텍스트 분기 (paragraph 시작 + non-cell/non-list 이면 task-item 에 양보).
        //
        // capture group 1 = `[x]` 만 replace (nodeInputRule 의 동일 로직):
        // - match[0] 안에서 group 1 위치 계산
        // - last typed char (trailing space) 보존
        // - prefix 텍스트는 안 건드림 (Codex 진단 잘못 — 위 소스 검증)
        //
        // 빈 cell 안 `[ ] ` 도 정상 매치 (prefix \S 제거).
        const nodeType = this.type;
        return [
            new InputRule({
                find: /(\[([ xX])\])\s$/,
                handler: ({ state, range, match }) => {
                    const { tr, doc } = state;
                    const $from = doc.resolve(range.from);
                    const parentType = $from.node(-1)?.type.name;
                    const inCell =
                        parentType === 'tableCell' ||
                        parentType === 'tableHeader';
                    const inListItem =
                        parentType === 'listItem' || parentType === 'taskItem';

                    // Codex P2 fix — paragraph prefix 가 list marker 패턴
                    // (`- `, `* `, `+ `, `1. ` 등) 이면 task-item 의 wrappingInputRule
                    // 에 양보. 사용자 입력 `- [x] ` 의 마지막 space 가 trigger 일 때
                    // range.from 은 `[` 위치 (paragraph 시작 아님) — 단순 start 체크
                    // 로는 잘못된 변환. paragraph text 의 [`처음 ~ range.from`] prefix
                    // 가 list marker 만 있으면 양보 — cell 안에서도 동일 (cell 안
                    // task-list 의도 보존).
                    const offsetInParent = range.from - $from.start();
                    const prefix = $from.parent.textContent.slice(0, offsetInParent);
                    const isTaskListMarker = /^\s*([-*+]|\d+\.)\s+$/.test(prefix);
                    if (isTaskListMarker && !inListItem) {
                        return null;
                    }
                    // paragraph 가 비어있는 시작 (`[x] ` 단독) + non-cell/non-list
                    // → task-item 에 양보. cell 안 빈 `[ ] ` 는 변환 (사용자 의도:
                    // cell 안 inline checkbox).
                    if (prefix.length === 0 && !inCell && !inListItem) {
                        return null;
                    }

                    const checked = match[2] === 'x' || match[2] === 'X';
                    const newNode = nodeType.create({ checked });

                    // capture group 1 (`[x]`) 만 replace + last char 보존 — nodeInputRule.ts 동일 로직
                    const offset = match[0].lastIndexOf(match[1]);
                    const matchStart = range.from + offset;
                    const matchEnd = matchStart + match[1].length;
                    const lastChar = match[0][match[0].length - 1];
                    tr.insertText(lastChar, range.from + match[0].length - 1);
                    tr.replaceWith(matchStart, matchEnd, newNode);
                },
            }),
        ];
    },

    addStorage() {
        // tiptap-markdown 0.9.0 의 hook (검증):
        // - serialize(state, node): MarkdownSerializerState 받아 `[x]`/`[ ]` write
        // - parse.setup(md): markdown-it instance 받아 inline ruler + renderer 등록
        // parseHTML 매처 (위 parseHTML()) 가 ruler 출력 HTML 을 다시 ProseMirror
        // node 로 복원 — 4단 round-trip 완성.
        return {
            markdown: {
                serialize(state: { write: (text: string) => void }, node: { attrs: { checked: boolean } }) {
                    state.write(node.attrs.checked ? '[x]' : '[ ]');
                },
                parse: {
                    setup(this: unknown, md: MarkdownIt): void {
                        // task-list plugin (markdown-it-task-lists, tiptap-markdown
                        // 의 TaskList extension 이 등록) 가 `core.ruler.after('inline',
                        // 'github-task-lists', ...)` 위치에 있음. 우리도 같은 위치
                        // `after('inline')` 에 등록하면 우리가 먼저 실행될 위험 →
                        // list_item 첫 [x] 를 우리가 consume → task-list 가 처리할
                        // 게 없어 bullet-list 안 inline checkbox 로 끝남 (Codex P2 #1).
                        //
                        // 해결: `after('github-task-lists', ...)` 로 task-list 직후
                        // 등록. task-list 가 list_item 첫 [x] 를 이미 inline 토큰
                        // 에서 제거한 상태로 우리에게 옴 → 자연 회피.
                        //
                        // fallback: 만약 'github-task-lists' rule 이 없으면
                        // (TaskList extension 미등록 환경) `after('inline')` 으로.
                        const ruleNames = md.core.ruler.__rules__?.map?.(
                            (r: { name: string }) => r.name,
                        ) ?? [];
                        const anchor = ruleNames.includes('github-task-lists')
                            ? 'github-task-lists'
                            : 'inline';
                        md.core.ruler.after(
                            anchor,
                            'inline_checkbox_postprocess',
                            (state: MarkdownItState) => {
                                const RE = /\[([ xX])\]/g;
                                for (const tok of state.tokens) {
                                    if (tok.type !== 'inline' || !tok.children) continue;
                                    const newChildren: MarkdownItToken[] = [];
                                    for (const child of tok.children) {
                                        if (child.type !== 'text') {
                                            newChildren.push(child);
                                            continue;
                                        }
                                        const text = child.content;
                                        let last = 0;
                                        let m: RegExpExecArray | null;
                                        RE.lastIndex = 0;
                                        let matched = false;
                                        while ((m = RE.exec(text)) !== null) {
                                            matched = true;
                                            if (m.index > last) {
                                                const t = new state.Token('text', '', 0);
                                                t.content = text.slice(last, m.index);
                                                newChildren.push(t);
                                            }
                                            const cb = new state.Token('inline_checkbox', '', 0);
                                            cb.meta = { checked: m[1].toLowerCase() === 'x' };
                                            newChildren.push(cb);
                                            last = m.index + m[0].length;
                                        }
                                        if (!matched) {
                                            newChildren.push(child);
                                        } else if (last < text.length) {
                                            const t = new state.Token('text', '', 0);
                                            t.content = text.slice(last);
                                            newChildren.push(t);
                                        }
                                    }
                                    tok.children = newChildren;
                                }
                            },
                        );

                        md.renderer.rules.inline_checkbox = (tokens, idx) => {
                            const checked = tokens[idx].meta?.checked ? 'true' : 'false';
                            return `<span data-type="inline-checkbox" data-checked="${checked}"></span>`;
                        };
                    },
                },
            },
        };
    },
});

// markdown-it 의 런타임 타입 (외부 .d.ts 가 너무 무거워 최소 인터페이스만 정의)
interface MarkdownItToken {
    type: string;
    content: string;
    children?: MarkdownItToken[] | null;
    meta?: { checked: boolean } | null;
}
interface MarkdownItState {
    tokens: MarkdownItToken[];
    Token: new (type: string, tag: string, nesting: number) => MarkdownItToken;
}
interface MarkdownIt {
    core: {
        ruler: {
            after: (
                target: string,
                name: string,
                fn: (state: MarkdownItState) => void,
            ) => void;
            // 내부 필드 — rule 등록 여부 확인용 (Codex P2 #1 fix)
            __rules__?: { name: string }[];
        };
    };
    renderer: {
        rules: Record<
            string,
            (tokens: MarkdownItToken[], idx: number) => string
        >;
    };
}
