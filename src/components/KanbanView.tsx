/**
 * Kanban view mode (#93) — editable, Gantt-compatible board.
 *
 * Markdown is the SSOT: parseKanban() derives cards from checkbox/status/Gantt
 * markers. Safe edits patch a card's source line markers without moving the
 * surrounding Markdown structure.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, GripVertical, Kanban, ListChecks, X } from 'lucide-react';
import { parseKanban } from '../lib/kanban-parser';
import { updateKanbanCardLine, type KanbanCardPatch } from '../lib/kanbanEdit';
import { KANBAN_COLUMNS, type KanbanCard, type KanbanPriority, type KanbanStatus } from '../types/kanban';
import { KanbanPanel } from './KanbanPanel';
import './KanbanView.css';

interface KanbanViewProps {
    content: string;
    fileName: string;
    /** 마크다운 SSOT 쓰기 — AI 자동 생성 결과 반영(없으면 read-only). */
    onChange?: (md: string) => void;
    readOnly?: boolean;
    /** 모달(KanbanPanel) 열림 — 메인 툴바 "자동 생성" 클릭을 App 이 토글. */
    kanbanPanelOpen?: boolean;
    onCloseKanbanPanel?: () => void;
}

interface MouseDragCandidate {
    card: KanbanCard;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
    active: boolean;
}

interface KanbanDragOverlayState {
    card: KanbanCard;
    x: number;
    y: number;
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
}

interface KanbanDropIndicatorState {
    status: KanbanStatus;
    beforeCardId: string | null;
}

function staticEditableKanbanCardTarget(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof HTMLElement)) return null;
    if (target.closest('input, select, button, textarea, .kanban-date-modal-root')) return null;
    return target.closest<HTMLElement>('.kanban-card--editable:not(.is-editing)');
}

function clearTextSelection(): void {
    const selection = document.getSelection?.();
    if (selection && selection.rangeCount > 0) selection.removeAllRanges();
}

function setKanbanDragSelectionBlock(enabled: boolean): void {
    document.body.classList.toggle('kanban-drag-select-block', enabled);
    document.documentElement.classList.toggle('kanban-drag-select-block', enabled);
}

export function KanbanView({ content, fileName, onChange, readOnly = false, kanbanPanelOpen, onCloseKanbanPanel }: KanbanViewProps) {
    const data = useMemo(() => parseKanban(content, fileName), [content, fileName]);
    const editable = !!onChange && !readOnly;
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [dropStatus, setDropStatus] = useState<KanbanStatus | null>(null);
    const [dropIndicator, setDropIndicator] = useState<KanbanDropIndicatorState | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [dragOverlay, setDragOverlay] = useState<KanbanDragOverlayState | null>(null);
    const dragCandidateRef = useRef<MouseDragCandidate | null>(null);
    const dropIndicatorRef = useRef<KanbanDropIndicatorState | null>(null);
    const cardIndex = useMemo(() => new Map(data.cards.map((card, index) => [card.id, index])), [data.cards]);
    const byStatus = useMemo(() => {
        const grouped = Object.fromEntries(KANBAN_COLUMNS.map((col) => [col.id, [] as KanbanCard[]]));
        for (const card of data.cards) grouped[card.status].push(card);
        for (const cards of Object.values(grouped)) {
            cards.sort((a, b) => {
                const aOrder = a.order ?? ((cardIndex.get(a.id) ?? 0) + 1) * 1000;
                const bOrder = b.order ?? ((cardIndex.get(b.id) ?? 0) + 1) * 1000;
                return aOrder - bOrder || (cardIndex.get(a.id) ?? 0) - (cardIndex.get(b.id) ?? 0);
            });
        }
        return grouped;
    }, [cardIndex, data.cards]);

    useEffect(() => {
        if (editingId && !data.cards.some((card) => card.id === editingId)) setEditingId(null);
    }, [data.cards, editingId]);

    useEffect(() => {
        if (!editable) return;
        const preventCardSelection = (event: Event) => {
            if (!staticEditableKanbanCardTarget(event.target)) return;
            event.preventDefault();
            clearTextSelection();
        };
        document.addEventListener('mousedown', preventCardSelection, true);
        document.addEventListener('selectstart', preventCardSelection, true);
        document.addEventListener('dragstart', preventCardSelection, true);
        return () => {
            document.removeEventListener('mousedown', preventCardSelection, true);
            document.removeEventListener('selectstart', preventCardSelection, true);
            document.removeEventListener('dragstart', preventCardSelection, true);
        };
    }, [editable]);

    const applyCardPatch = useCallback((card: KanbanCard, patch: KanbanCardPatch) => {
        if (!editable || typeof card.mdLine !== 'number') return;
        const next = updateKanbanCardLine(content, card.mdLine, patch);
        if (next !== content) onChange?.(next);
    }, [content, editable, onChange]);

    const setActiveDropStatus = useCallback((status: KanbanStatus | null) => {
        setDropStatus(status);
    }, []);

    const setActiveDropIndicator = useCallback((indicator: KanbanDropIndicatorState | null) => {
        dropIndicatorRef.current = indicator;
        setDropIndicator(indicator);
        setActiveDropStatus(indicator?.status ?? null);
    }, [setActiveDropStatus]);

    const dropIndicatorFromPoint = useCallback((x: number, y: number, draggingCardId: string): KanbanDropIndicatorState | null => {
        const column = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-kanban-status]');
        const status = column?.dataset.kanbanStatus;
        if (!column || !KANBAN_COLUMNS.some((col) => col.id === status)) return null;
        const cards = Array.from(column.querySelectorAll<HTMLElement>('[data-kanban-card-id]'))
            .filter((el) => el.dataset.kanbanCardId !== draggingCardId);
        for (const cardEl of cards) {
            const rect = cardEl.getBoundingClientRect();
            if (y < rect.top + rect.height / 2) {
                return { status: status as KanbanStatus, beforeCardId: cardEl.dataset.kanbanCardId ?? null };
            }
        }
        return { status: status as KanbanStatus, beforeCardId: null };
    }, []);

    const startMouseDrag = useCallback((card: KanbanCard, e: ReactMouseEvent<HTMLElement>) => {
        if (!editable || typeof card.mdLine !== 'number' || e.button !== 0) return;
        if ((e.target as HTMLElement).closest('input, select, button, textarea, .kanban-date-modal-root')) return;
        const rect = e.currentTarget.getBoundingClientRect();
        e.preventDefault();
        clearTextSelection();
        setKanbanDragSelectionBlock(true);
        dragCandidateRef.current = {
            card,
            startX: e.clientX,
            startY: e.clientY,
            offsetX: e.clientX - rect.left,
            offsetY: e.clientY - rect.top,
            width: rect.width,
            height: rect.height,
            active: false,
        };
    }, [editable]);

    const applyCardDrop = useCallback((card: KanbanCard, indicator: KanbanDropIndicatorState) => {
        if (!editable || typeof card.mdLine !== 'number') return;
        const targetCards = byStatus[indicator.status].filter((item) => item.id !== card.id);
        const insertAt = indicator.beforeCardId
            ? Math.max(0, targetCards.findIndex((item) => item.id === indicator.beforeCardId))
            : targetCards.length;
        const orderedCards = [...targetCards];
        orderedCards.splice(insertAt < 0 ? targetCards.length : insertAt, 0, { ...card, status: indicator.status });

        let next = content;
        for (const [index, item] of orderedCards.entries()) {
            if (typeof item.mdLine !== 'number') continue;
            const patch: KanbanCardPatch = { order: (index + 1) * 1000 };
            if (item.id === card.id) patch.status = indicator.status;
            next = updateKanbanCardLine(next, item.mdLine, patch);
        }
        if (next !== content) onChange?.(next);
    }, [byStatus, content, editable, onChange]);

    useEffect(() => {
        const resetDrag = () => {
            dragCandidateRef.current = null;
            setDraggingId(null);
            setDragOverlay(null);
            setActiveDropIndicator(null);
            setKanbanDragSelectionBlock(false);
            clearTextSelection();
        };

        const onMouseMove = (e: MouseEvent) => {
            const drag = dragCandidateRef.current;
            if (!drag) return;
            e.preventDefault();
            clearTextSelection();
            const dx = e.clientX - drag.startX;
            const dy = e.clientY - drag.startY;
            if (!drag.active && Math.hypot(dx, dy) < 6) return;

            if (!drag.active) {
                drag.active = true;
                setEditingId((current) => current === drag.card.id ? null : current);
                setDraggingId(drag.card.id);
            }
            setDragOverlay({
                card: drag.card,
                x: e.clientX,
                y: e.clientY,
                offsetX: drag.offsetX,
                offsetY: drag.offsetY,
                width: drag.width,
                height: drag.height,
            });
            setActiveDropIndicator(dropIndicatorFromPoint(e.clientX, e.clientY, drag.card.id));
        };

        const onMouseUp = (e: MouseEvent) => {
            const drag = dragCandidateRef.current;
            if (!drag) return;
            const wasActive = drag.active;
            const indicator = dropIndicatorRef.current;
            resetDrag();

            if (!wasActive) {
                setEditingId(drag.card.id);
                e.preventDefault();
                return;
            }
            if (indicator) applyCardDrop(drag.card, indicator);
            e.preventDefault();
        };

        const onSelectStart = (e: Event) => {
            if (!dragCandidateRef.current) return;
            e.preventDefault();
            clearTextSelection();
        };
        const onSelectionChange = () => {
            if (dragCandidateRef.current) clearTextSelection();
        };
        const onDragStart = (e: DragEvent) => {
            if (!dragCandidateRef.current) return;
            e.preventDefault();
            clearTextSelection();
        };

        window.addEventListener('mousemove', onMouseMove, { capture: true });
        window.addEventListener('mouseup', onMouseUp, { capture: true });
        window.addEventListener('blur', resetDrag);
        document.addEventListener('selectstart', onSelectStart, true);
        document.addEventListener('selectionchange', onSelectionChange);
        document.addEventListener('dragstart', onDragStart, true);
        return () => {
            window.removeEventListener('mousemove', onMouseMove, { capture: true });
            window.removeEventListener('mouseup', onMouseUp, { capture: true });
            window.removeEventListener('blur', resetDrag);
            document.removeEventListener('selectstart', onSelectStart, true);
            document.removeEventListener('selectionchange', onSelectionChange);
            document.removeEventListener('dragstart', onDragStart, true);
            setKanbanDragSelectionBlock(false);
        };
    }, [applyCardDrop, dropIndicatorFromPoint, setActiveDropIndicator]);

    const panel = kanbanPanelOpen && onChange ? (
        <KanbanPanel
            content={content}
            onApply={(md, applyMode) => {
                const next = applyMode === 'replace'
                    ? md
                    : (content.trim() ? `${content.replace(/\s+$/, '')}\n\n${md}` : md);
                onChange(next);
            }}
            onClose={() => onCloseKanbanPanel?.()}
        />
    ) : null;

    if (data.cards.length === 0) {
        return (
            <div className="kanban-view">
                <div className="kanban-empty">
                    <Kanban size={48} strokeWidth={1.25} />
                    <p className="kanban-empty-title">표시할 카드가 없습니다</p>
                    <p className="kanban-empty-hint">체크박스나 상태 마커가 있는 항목을 카드로 표시합니다</p>
                    <pre className="kanban-empty-example"><code>{`## 개발
- [ ] 구현 @status(doing) @start(2026-07-01) @due(2026-07-10) @progress(40)
- [ ] 리뷰 @status(review)
- [x] 릴리스 @start(2026-07-15)`}</code></pre>
                    <p className="kanban-empty-markers">
                        <code>@status</code> 상태 · <code>@start</code>/<code>@due</code> 일정 · <code>@progress</code> 진행률
                    </p>
                </div>
                {panel}
            </div>
        );
    }

    return (
        <div className="kanban-view">
            <div className={`kanban-board${draggingId ? ' is-dragging' : ''}`} role="list" aria-label="칸반 보드">
                {KANBAN_COLUMNS.map((col) => {
                    const cards = byStatus[col.id];
                    return (
                        <section
                            key={col.id}
                            className={`kanban-column kanban-column--${col.id}${dropStatus === col.id ? ' is-drop-target' : ''}`}
                            aria-label={col.label}
                            data-kanban-status={col.id}
                        >
                            <div className="kanban-column-header">
                                <span className="kanban-column-title">
                                    <span className="kanban-status-dot" aria-hidden="true" />
                                    <span>{col.label}</span>
                                </span>
                                <span className="kanban-count">{cards.length}</span>
                            </div>
                            <div className="kanban-card-list">
                                {cards.length === 0 ? (
                                    <div className="kanban-column-empty">없음</div>
                                ) : (
                                    cards.map((card) => (
                                        <FragmentWithDropIndicator
                                            key={card.id}
                                            showIndicator={dropIndicator?.status === col.id && dropIndicator.beforeCardId === card.id}
                                        >
                                            <KanbanCardView
                                                card={card}
                                                editable={editable && typeof card.mdLine === 'number'}
                                                editing={editingId === card.id}
                                                dragging={draggingId === card.id}
                                                onFinishEdit={() => setEditingId((current) => current === card.id ? null : current)}
                                                onPatch={(patch) => applyCardPatch(card, patch)}
                                                onMouseDown={(e) => startMouseDrag(card, e)}
                                            />
                                        </FragmentWithDropIndicator>
                                    ))
                                )}
                                {dropIndicator?.status === col.id && dropIndicator.beforeCardId === null && (
                                    <div className="kanban-drop-insert-line" aria-hidden="true" />
                                )}
                            </div>
                        </section>
                    );
                })}
            </div>
            {dragOverlay && <KanbanDragOverlay overlay={dragOverlay} />}
            {panel}
        </div>
    );
}

function FragmentWithDropIndicator({ children, showIndicator }: { children: ReactNode; showIndicator: boolean }) {
    return (
        <>
            {showIndicator && <div className="kanban-drop-insert-line" aria-hidden="true" />}
            {children}
        </>
    );
}

function KanbanDragOverlay({ overlay }: { overlay: KanbanDragOverlayState }) {
    const { card } = overlay;
    return (
        <article
            aria-hidden="true"
            className={`kanban-card kanban-card--${card.status} kanban-drag-overlay`}
            style={{
                left: overlay.x - overlay.offsetX,
                top: overlay.y - overlay.offsetY,
                width: overlay.width,
                minHeight: overlay.height,
            }}
        >
            <div className="kanban-card-topline">
                <div className="kanban-card-section-wrap">
                    <GripVertical className="kanban-drag-handle" size={15} strokeWidth={2.1} aria-hidden="true" />
                    {card.section && <span className="kanban-card-section">{card.section}</span>}
                </div>
                {card.priority && <span className={`kanban-priority kanban-priority--${card.priority}`}>{priorityLabel(card.priority)}</span>}
            </div>
            <span className="kanban-card-title">{card.label}</span>
            {(card.start || card.due || card.progress !== null) && (
                <div className="kanban-card-meta">
                    {(card.start || card.due) && (
                        <span className="kanban-meta-chip">
                            <CalendarDays size={12} strokeWidth={1.7} />
                            <span>{dateRangeLabel(card.start, card.due)}</span>
                        </span>
                    )}
                    {card.progress !== null && (
                        <span className="kanban-meta-chip">
                            <ListChecks size={12} strokeWidth={1.7} />
                            <span>{card.progress}%</span>
                        </span>
                    )}
                </div>
            )}
        </article>
    );
}

function KanbanCardView({ card, editable, editing, dragging, onFinishEdit, onPatch, onMouseDown }: {
    card: KanbanCard;
    editable: boolean;
    editing: boolean;
    dragging: boolean;
    onFinishEdit: () => void;
    onPatch: (patch: KanbanCardPatch) => void;
    onMouseDown: (e: ReactMouseEvent<HTMLElement>) => void;
}) {
    const cardRef = useRef<HTMLElement | null>(null);
    const [labelDraft, setLabelDraft] = useState(card.label);
    const [startDraft, setStartDraft] = useState(inputDate(card.start));
    const [dueDraft, setDueDraft] = useState(inputDate(card.due));
    const [progressDraft, setProgressDraft] = useState(card.progress === null ? '' : String(card.progress));
    const [datePickerOpen, setDatePickerOpen] = useState(false);
    const title = [
        card.label,
        card.section ? `섹션: ${card.section}` : '',
        card.start ? `시작: ${ymd(card.start)}` : '',
        card.due ? `마감: ${ymd(card.due)}` : '',
        card.progress !== null ? `진행률: ${card.progress}%` : '',
    ].filter(Boolean).join('\n');

    useEffect(() => { setLabelDraft(card.label); }, [card.id, card.label]);
    useEffect(() => { setStartDraft(inputDate(card.start)); }, [card.id, card.start]);
    useEffect(() => { setDueDraft(inputDate(card.due)); }, [card.id, card.due]);
    useEffect(() => { setProgressDraft(card.progress === null ? '' : String(card.progress)); }, [card.id, card.progress]);

    const commitLabel = () => {
        const next = labelDraft.replace(/\s+/g, ' ').trim();
        if (!next) {
            setLabelDraft(card.label);
            return;
        }
        if (next !== card.label) onPatch({ label: next });
    };
    const commitProgress = () => {
        const current = card.progress === null ? '' : String(card.progress);
        if (progressDraft === current) return;
        const raw = progressDraft.trim();
        onPatch({ progress: raw === '' ? null : Number(raw) });
    };
    const finishEdit = useCallback(() => {
        const patch: KanbanCardPatch = {};
        const nextLabel = labelDraft.replace(/\s+/g, ' ').trim();
        if (nextLabel && nextLabel !== card.label) patch.label = nextLabel;
        if (!nextLabel) setLabelDraft(card.label);
        if (startDraft !== inputDate(card.start)) patch.start = startDraft || null;
        if (dueDraft !== inputDate(card.due)) patch.due = dueDraft || null;
        const currentProgress = card.progress === null ? '' : String(card.progress);
        if (progressDraft !== currentProgress) {
            const raw = progressDraft.trim();
            patch.progress = raw === '' ? null : Number(raw);
        }
        if (Object.keys(patch).length > 0) onPatch(patch);
        onFinishEdit();
    }, [card.label, card.progress, card.start, card.due, dueDraft, labelDraft, onFinishEdit, onPatch, progressDraft, startDraft]);
    const applyDateRange = (nextStart: string, nextDue: string) => {
        setStartDraft(nextStart);
        setDueDraft(nextDue);
        onPatch({ start: nextStart || null, due: nextDue || null });
        setDatePickerOpen(false);
    };
    const blurOnEnter = (e: ReactKeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
            setLabelDraft(card.label);
            setStartDraft(inputDate(card.start));
            setDueDraft(inputDate(card.due));
            setProgressDraft(card.progress === null ? '' : String(card.progress));
            setDatePickerOpen(false);
            e.currentTarget.blur();
        }
    };
    const finishOnDoubleClick = (e: ReactMouseEvent<HTMLElement>) => {
        if (!editing) return;
        if ((e.target as HTMLElement).closest('input, select, button, textarea, .kanban-date-modal-root')) return;
        finishEdit();
    };

    useEffect(() => {
        if (!editing) return;
        const onPointerDown = (e: PointerEvent) => {
            const target = e.target as Node | null;
            if (target && cardRef.current?.contains(target)) return;
            finishEdit();
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        return () => document.removeEventListener('pointerdown', onPointerDown, true);
    }, [editing, finishEdit]);

    return (
        <article
            ref={cardRef}
            className={`kanban-card kanban-card--${card.status}${editable ? ' kanban-card--editable' : ''}${editing ? ' is-editing' : ''}${dragging ? ' is-dragging' : ''}`}
            data-kanban-card-id={card.id}
            title={title}
            onDoubleClick={finishOnDoubleClick}
            onMouseDown={editable && !editing ? onMouseDown : undefined}
            onDragStart={(e) => e.preventDefault()}
            draggable={false}
        >
            <div className="kanban-card-topline">
                <div className="kanban-card-section-wrap">
                    {editable && !editing && (
                        <GripVertical className="kanban-drag-handle" size={15} strokeWidth={2.1} aria-hidden="true" />
                    )}
                    {card.section && <span className="kanban-card-section">{card.section}</span>}
                </div>
                {editing ? (
                    <div className="kanban-card-controls">
                        <select
                            className="kanban-card-select"
                            value={card.status}
                            onChange={(e) => onPatch({ status: e.target.value as KanbanStatus })}
                            onKeyDown={blurOnEnter}
                            title="상태"
                        >
                            {KANBAN_COLUMNS.map((col) => <option key={col.id} value={col.id}>{col.label}</option>)}
                        </select>
                        <select
                            className="kanban-card-select kanban-card-select--priority"
                            value={card.priority ?? ''}
                            onChange={(e) => onPatch({ priority: e.target.value ? e.target.value as KanbanPriority : null })}
                            onKeyDown={blurOnEnter}
                            title="우선순위"
                        >
                            <option value="">-</option>
                            <option value="urgent">P0</option>
                            <option value="high">P1</option>
                            <option value="medium">P2</option>
                            <option value="low">P3</option>
                        </select>
                    </div>
                ) : (
                    card.priority && <span className={`kanban-priority kanban-priority--${card.priority}`}>{priorityLabel(card.priority)}</span>
                )}
            </div>
            {editing ? (
                <input
                    className="kanban-card-title-input"
                    value={labelDraft}
                    onChange={(e) => setLabelDraft(e.target.value)}
                    onBlur={commitLabel}
                    onKeyDown={blurOnEnter}
                    title="제목"
                />
            ) : (
                <span className="kanban-card-title">{card.label}</span>
            )}
            {editing ? (
                <div className="kanban-card-edit-meta">
                    <button
                        type="button"
                        className="kanban-date-range-button"
                        title="일정 범위"
                        onClick={() => setDatePickerOpen(true)}
                    >
                        <CalendarDays size={12} strokeWidth={1.7} />
                        <span>{dateDraftLabel(startDraft, dueDraft)}</span>
                    </button>
                    <label className="kanban-card-field kanban-card-field--progress">
                        <ListChecks size={12} strokeWidth={1.7} />
                        <input
                            type="range"
                            min={0}
                            max={100}
                            step={5}
                            value={progressDraft || '0'}
                            onChange={(e) => setProgressDraft(e.target.value)}
                            onBlur={commitProgress}
                            onKeyDown={blurOnEnter}
                            title="진행률"
                        />
                        <span className="kanban-progress-value">{progressDraft || '0'}%</span>
                    </label>
                    {datePickerOpen && (
                        <KanbanDateRangeModal
                            start={startDraft}
                            due={dueDraft}
                            onApply={applyDateRange}
                            onClose={() => setDatePickerOpen(false)}
                        />
                    )}
                </div>
            ) : (card.start || card.due || card.progress !== null) && (
                <div className="kanban-card-meta">
                    {(card.start || card.due) && (
                        <span className="kanban-meta-chip">
                            <CalendarDays size={12} strokeWidth={1.7} />
                            <span>{dateRangeLabel(card.start, card.due)}</span>
                        </span>
                    )}
                    {card.progress !== null && (
                        <span className="kanban-meta-chip">
                            <ListChecks size={12} strokeWidth={1.7} />
                            <span>{card.progress}%</span>
                        </span>
                    )}
                </div>
            )}
        </article>
    );
}

function KanbanDateRangeModal({ start, due, onApply, onClose }: {
    start: string;
    due: string;
    onApply: (start: string, due: string) => void;
    onClose: () => void;
}) {
    const [draftStart, setDraftStart] = useState(start);
    const [draftDue, setDraftDue] = useState(due);
    const [viewMonth, setViewMonth] = useState(() => monthStart(parseInputDate(start) ?? parseInputDate(due) ?? new Date()));
    const nextMonth = addMonths(viewMonth, 1);

    useEffect(() => {
        const onKeyDown = (e: globalThis.KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onClose]);

    const selectDay = (value: string) => {
        if (!draftStart || draftDue) {
            setDraftStart(value);
            setDraftDue('');
            return;
        }
        if (value < draftStart) {
            setDraftDue(draftStart);
            setDraftStart(value);
            return;
        }
        setDraftDue(value);
    };

    const clear = () => {
        setDraftStart('');
        setDraftDue('');
    };

    return (
        <div className="kanban-date-modal-root" role="presentation" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
            <div className="kanban-date-modal-backdrop" onClick={onClose} aria-hidden />
            <div className="kanban-date-modal" role="dialog" aria-modal="true" aria-label="일정 범위 선택">
                <div className="kanban-date-modal-header">
                    <button
                        type="button"
                        className="kanban-date-nav-button"
                        aria-label="이전 달"
                        title="이전 달"
                        onClick={() => setViewMonth((current) => addMonths(current, -1))}
                    >
                        <ChevronLeft size={16} strokeWidth={2.1} />
                    </button>
                    <div className="kanban-date-modal-title">
                        <span>{monthLabel(viewMonth)}</span>
                        <span>{monthLabel(nextMonth)}</span>
                    </div>
                    <button
                        type="button"
                        className="kanban-date-nav-button"
                        aria-label="다음 달"
                        title="다음 달"
                        onClick={() => setViewMonth((current) => addMonths(current, 1))}
                    >
                        <ChevronRight size={16} strokeWidth={2.1} />
                    </button>
                    <button type="button" className="kanban-date-close-button" aria-label="닫기" title="닫기" onClick={onClose}>
                        <X size={15} strokeWidth={2.1} />
                    </button>
                </div>
                <div className="kanban-date-selected-range">
                    <span>{draftStart || '시작일 없음'}</span>
                    <span>~</span>
                    <span>{draftDue || '마감일 없음'}</span>
                </div>
                <div className="kanban-date-calendars">
                    <KanbanCalendarMonth
                        month={viewMonth}
                        start={draftStart}
                        due={draftDue}
                        onSelect={selectDay}
                    />
                    <KanbanCalendarMonth
                        month={nextMonth}
                        start={draftStart}
                        due={draftDue}
                        onSelect={selectDay}
                    />
                </div>
                <div className="kanban-date-actions">
                    <button type="button" className="kanban-date-secondary-button" onClick={clear}>지우기</button>
                    <button
                        type="button"
                        className="kanban-date-secondary-button"
                        onClick={() => {
                            const today = ymd(new Date());
                            setDraftStart(today);
                            setDraftDue('');
                            setViewMonth(monthStart(new Date()));
                        }}
                    >
                        오늘
                    </button>
                    <span className="kanban-date-action-spacer" />
                    <button type="button" className="kanban-date-secondary-button" onClick={onClose}>취소</button>
                    <button type="button" className="kanban-date-primary-button" onClick={() => onApply(draftStart, draftDue)}>적용</button>
                </div>
            </div>
        </div>
    );
}

function KanbanCalendarMonth({ month, start, due, onSelect }: {
    month: Date;
    start: string;
    due: string;
    onSelect: (value: string) => void;
}) {
    return (
        <div className="kanban-date-month">
            <div className="kanban-date-month-title">{monthLabel(month)}</div>
            <div className="kanban-date-weekdays">
                {['일', '월', '화', '수', '목', '금', '토'].map((day) => <span key={day}>{day}</span>)}
            </div>
            <div className="kanban-date-days">
                {calendarCells(month).map((value, index) => value ? (
                    <button
                        key={value}
                        type="button"
                        className={dateDayClass(value, start, due)}
                        onClick={() => onSelect(value)}
                    >
                        {Number(value.slice(-2))}
                    </button>
                ) : (
                    <span key={`blank-${index}`} className="kanban-date-day kanban-date-day--blank" />
                ))}
            </div>
        </div>
    );
}

function priorityLabel(priority: KanbanPriority): string {
    switch (priority) {
        case 'urgent': return 'P0';
        case 'high': return 'P1';
        case 'medium': return 'P2';
        case 'low': return 'P3';
    }
}

function dateRangeLabel(start: Date | null, due: Date | null): string {
    if (start && due) return formatDateRange(start, due);
    if (due) return `마감 ${fullDate(due)}`;
    if (start) return `시작 ${fullDate(start)}`;
    return '';
}

function fullDate(d: Date): string {
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function monthDay(d: Date): string {
    return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatDateRange(start: Date, due: Date): string {
    const end = start.getFullYear() === due.getFullYear() ? monthDay(due) : fullDate(due);
    return `${fullDate(start)} ~ ${end}`;
}

function dateDraftLabel(start: string, due: string): string {
    if (start && due) {
        const startDate = parseInputDate(start);
        const dueDate = parseInputDate(due);
        if (startDate && dueDate) return formatDateRange(startDate, dueDate);
        return `${fullInputDate(start)} ~ ${fullInputDate(due)}`;
    }
    if (due) return `마감 ${fullInputDate(due)}`;
    if (start) return `시작 ${fullInputDate(start)}`;
    return '일정 없음';
}

function fullInputDate(value: string): string {
    const date = parseInputDate(value);
    return date ? fullDate(date) : value;
}

function inputDate(d: Date | null): string {
    if (!d) return '';
    return ymd(d);
}

function ymd(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function parseInputDate(value: string): Date | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;
    const y = Number(match[1]);
    const m = Number(match[2]);
    const d = Number(match[3]);
    const date = new Date(y, m - 1, d);
    if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
    return date;
}

function monthStart(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, delta: number): Date {
    return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function monthLabel(date: Date): string {
    return `${date.getFullYear()}년 ${date.getMonth() + 1}월`;
}

function calendarCells(month: Date): Array<string | null> {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const dayCount = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const cells: Array<string | null> = [];
    for (let i = 0; i < first.getDay(); i++) cells.push(null);
    for (let day = 1; day <= dayCount; day++) cells.push(ymd(new Date(month.getFullYear(), month.getMonth(), day)));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
}

function dateDayClass(value: string, start: string, due: string): string {
    const classes = ['kanban-date-day'];
    const today = ymd(new Date());
    if (value === today) classes.push('is-today');
    if (value === start) classes.push('is-range-start');
    if (value === due) classes.push('is-range-end');
    if (start && due && value > start && value < due) classes.push('is-in-range');
    if (start && !due && value === start) classes.push('is-single-selected');
    return classes.join(' ');
}
