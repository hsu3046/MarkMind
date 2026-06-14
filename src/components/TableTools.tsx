// 테이블 도구 — 셀 안에 cursor 가 있을 때 리치 toolbar 우측 빈 공간에 표시.
//
// 이전엔 Floating UI BubbleMenu 로 테이블 위에 떠 있었으나(본문을 가리고
// 위치가 불안정), 사용자 요청으로 플로팅을 없애고 RichToolbar 안에 통합.
// RichToolbar 가 selectionUpdate/transaction 마다 리렌더되므로 isActive('table')
// 변화가 즉시 반영된다.
//
// command 안전성: deleteRow/deleteColumn 직후 ProseMirror selection 이 일시적으로
// transitional 위치로 이동해 editor.can().X() 가 모든 command 에 false 를 반환하는
// 사고가 있었음(2026-06-03). 따라서 disabled 평가 없이, isActive('table') 로
// 그룹이 보이는 동안 모든 command 시도 가능 — invalid selection 이면 chain 이
// 안전하게 no-op.

import type { ButtonHTMLAttributes } from 'react';
import type { Editor } from '@tiptap/react';
import { Trash2 } from 'lucide-react';

interface Props {
    editor: Editor | null;
}

export function TableTools({ editor }: Props) {
    // 셀 안에 cursor 가 있을 때만 표시 (cell/header/row/CellSelection 모두 cover)
    if (!editor || !editor.isEditable || !editor.isActive('table')) return null;

    return (
        <div className="rich-table-tools" role="group" aria-label="표 편집">
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
        </div>
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
