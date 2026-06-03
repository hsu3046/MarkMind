// 테이블 BubbleMenu — 셀 안 cursor 시 floating row/col 조작 핸들러.
//
// 4-차원 검증 결과 (investigate-table-bubble-menu workflow):
// - import 경로: @tiptap/react/menus (v3 표준, v2 경로 제거됨)
// - positioning: Floating UI (Tippy.js 제거됨), strategy='fixed' + appendTo=body
//   로 split-pane overflow:hidden clipping 회피
// - shouldShow: editor.isActive('table') 가 cell/header/row/CellSelection/
//   NodeSelection 모두 cover
// - 모든 command 에 can() 검사로 disabled 처리 (안전한 컨텍스트 외 자동 비활성)
//
// Tauri WKWebView 호환 — iOS 26 fixed/Base UI portal 함정 N/A (macOS 데스크탑).

import type { ButtonHTMLAttributes } from 'react';
import { BubbleMenu } from '@tiptap/react/menus';
import type { Editor } from '@tiptap/react';

interface Props {
    editor: Editor | null;
}

export function TableBubbleMenu({ editor }: Props) {
    if (!editor) return null;

    return (
        <BubbleMenu
            editor={editor}
            pluginKey="bubbleMenuTable"
            updateDelay={100}
            // split-pane 의 overflow:hidden 안에서도 잘리지 않도록 body 에 portal
            appendTo={() => document.body}
            options={{
                strategy: 'fixed',
                placement: 'top',
                offset: 8,
                flip: true,
                shift: { padding: 8 },
            }}
            shouldShow={({ editor: ed }) => {
                if (!ed.isEditable) return false;
                return ed.isActive('table');
            }}
            className="table-bubble-menu"
        >
            <Btn
                onClick={() => editor.chain().focus().addRowBefore().run()}
                disabled={!editor.can().addRowBefore()}
                title="위 행 추가"
            >
                ↑+
            </Btn>
            <Btn
                onClick={() => editor.chain().focus().addRowAfter().run()}
                disabled={!editor.can().addRowAfter()}
                title="아래 행 추가"
            >
                ↓+
            </Btn>
            <Btn
                onClick={() => editor.chain().focus().addColumnBefore().run()}
                disabled={!editor.can().addColumnBefore()}
                title="왼쪽 열 추가"
            >
                ←+
            </Btn>
            <Btn
                onClick={() => editor.chain().focus().addColumnAfter().run()}
                disabled={!editor.can().addColumnAfter()}
                title="오른쪽 열 추가"
            >
                →+
            </Btn>
            <span className="tbm-sep" aria-hidden />
            <Btn
                onClick={() => editor.chain().focus().deleteRow().run()}
                disabled={!editor.can().deleteRow()}
                title="행 삭제"
            >
                −행
            </Btn>
            <Btn
                onClick={() => editor.chain().focus().deleteColumn().run()}
                disabled={!editor.can().deleteColumn()}
                title="열 삭제"
            >
                −열
            </Btn>
            <span className="tbm-sep" aria-hidden />
            <Btn
                onClick={() => editor.chain().focus().toggleHeaderRow().run()}
                disabled={!editor.can().toggleHeaderRow()}
                title="헤더 행 토글"
            >
                H
            </Btn>
            <Btn
                onClick={() => editor.chain().focus().mergeOrSplit().run()}
                disabled={!editor.can().mergeOrSplit()}
                title="셀 병합/분할"
            >
                ⇄
            </Btn>
            <span className="tbm-sep" aria-hidden />
            <Btn
                onClick={() => editor.chain().focus().deleteTable().run()}
                disabled={!editor.can().deleteTable()}
                title="표 삭제"
                className="tbm-btn tbm-danger"
            >
                ✕
            </Btn>
        </BubbleMenu>
    );
}

function Btn({
    children,
    className,
    ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) {
    return (
        <button
            type="button"
            className={className ?? 'tbm-btn'}
            {...rest}
        >
            {children}
        </button>
    );
}
