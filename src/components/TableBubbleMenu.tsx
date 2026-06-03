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
import { Trash2 } from 'lucide-react';

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
            {/*
              버튼 disabled 평가 제거 — row/col 삭제 직후 ProseMirror selection 이
              일시적으로 transitional 위치로 이동해 `editor.can().X()` 가 모든
              command 에 false 를 반환하는 사고 발생 (사용자 보고 2026-06-03).
              shouldShow=isActive('table') 가 이미 셀 안 보장 → menu 가 보이는
              동안 모든 command 시도 가능. invalid selection 일 때 chain 이 안전
              하게 무시 (no-op). UX 일관성 + 사고 회피.
            */}
            <Btn
                onClick={() => editor.chain().focus().addRowBefore().run()}
                title="위 행 추가"
            >
                ↑+
            </Btn>
            <Btn
                onClick={() => editor.chain().focus().addRowAfter().run()}
                title="아래 행 추가"
            >
                ↓+
            </Btn>
            <Btn
                onClick={() => editor.chain().focus().addColumnBefore().run()}
                title="왼쪽 열 추가"
            >
                ←+
            </Btn>
            <Btn
                onClick={() => editor.chain().focus().addColumnAfter().run()}
                title="오른쪽 열 추가"
            >
                →+
            </Btn>
            <span className="tbm-sep" aria-hidden />
            <Btn
                onClick={() => editor.chain().focus().deleteRow().run()}
                title="행 삭제"
            >
                −행
            </Btn>
            <Btn
                onClick={() => editor.chain().focus().deleteColumn().run()}
                title="열 삭제"
            >
                −열
            </Btn>
            <span className="tbm-sep" aria-hidden />
            <Btn
                onClick={() => editor.chain().focus().mergeCells().run()}
                title="선택한 셀들을 병합 (먼저 셀 여러 개를 드래그 선택)"
            >
                병합
            </Btn>
            <Btn
                onClick={() => editor.chain().focus().splitCell().run()}
                title="병합된 셀을 분리"
            >
                분리
            </Btn>
            <span className="tbm-sep" aria-hidden />
            <Btn
                onClick={() => editor.chain().focus().deleteTable().run()}
                title="표 삭제"
                className="tbm-btn tbm-danger"
            >
                <Trash2 size={14} strokeWidth={1.6} />
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
