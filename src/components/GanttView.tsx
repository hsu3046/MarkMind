/**
 * Gantt view mode (#54) — self-rendered SVG, drag-editable.
 *
 * Markdown is the SSOT: parseGantt() pulls deterministic inline markers
 * (@start/@due/@progress) off the document tree. We render a classic gantt —
 * a left label column (sections + task names) and a right time axis with bars,
 * progress fill, milestone diamonds, and a "today" line.
 *
 * Editing: bars/milestones are draggable when `onChange` is supplied. Dragging a
 * bar's body moves it (start+due together); the left/right edges resize one end;
 * a milestone moves as a point, and a bar pulled shorter than a day collapses to
 * a milestone (and back). Every commit flows through ganttEdit→updateKanbanCardLine
 * (the SHARED line engine), so a Gantt edit never disturbs the Kanban markers on
 * the same line (@status/@priority/@order). A short press (no drag) does nothing.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { ChartBarStacked } from 'lucide-react';
import { parseGantt } from '../lib/gantt-parser';
import { applyGanttDrag, applyGanttLabel, applyGanttProgress, previewGanttDrag, type GanttDragMode, type GanttDragResult } from '../lib/ganttEdit';
import type { GanttTask } from '../types/gantt';
import { GanttPanel } from './GanttPanel';
import './GanttView.css';

// ── layout constants ─────────────────────────────────────────────────────────
const LABEL_W = 300;   // left label column width (task name + date/progress meta)
const HEADER_H = 40;   // time-axis header height
const ROW_H = 32;      // task row height
const SECTION_H = 30;  // section header row height
const DAY_W = 30;      // px per day
const BAR_PAD = 6;     // vertical padding inside a row for the bar

const MS_PER_DAY = 86_400_000;
const EDGE_HIT = 7;       // px from a bar edge that starts a resize instead of a move
const DRAG_THRESHOLD = 4; // px of travel before a press becomes a drag (else: jump)
const MS_R = 8;           // milestone diamond half-size

function midnight(d: Date): Date {
    const c = new Date(d);
    c.setHours(0, 0, 0, 0);
    return c;
}
function diffDays(a: Date, b: Date): number {
    return Math.round((midnight(b).getTime() - midnight(a).getTime()) / MS_PER_DAY);
}
function addDays(base: Date, n: number): Date {
    return new Date(base.getFullYear(), base.getMonth(), base.getDate() + n);
}

/** Toggle a global no-select cursor lock while dragging (mirrors the Kanban view). */
function setGanttDragSelectBlock(on: boolean): void {
    document.body.classList.toggle('gantt-drag-select-block', on);
}

type Row =
    | { kind: 'section'; label: string; y: number }
    | { kind: 'task'; task: GanttTask; y: number };

/** A press in progress: a candidate until it travels past the threshold. */
interface DragCandidate {
    task: GanttTask;
    mode: GanttDragMode;
    startX: number;
    /** false ⇒ press is outside any bar: it can only become a drag-less click. */
    draggable: boolean;
    /** Which inline editor a click (no drag) opens: 'label' (name column) or 'progress' (bar). */
    clickField: 'label' | 'progress' | null;
    active: boolean;
}

/** Live preview state surfaced to the render (drives the ghost bar + date tip). */
interface DragPreview {
    taskId: string;
    mode: GanttDragMode;
    dayDelta: number;
}

interface GanttViewProps {
    content: string;
    fileName: string;
    /** 마크다운 SSOT 쓰기 — 없으면 read-only(드래그 편집·자동 생성 비활성, split 미러). */
    onChange?: (md: string) => void;
    /** 모달(GanttPanel) 열림 — 메인 툴바 "자동 생성" 클릭을 App 이 토글. */
    ganttPanelOpen?: boolean;
    onCloseGanttPanel?: () => void;
}

export function GanttView({ content, fileName, onChange, ganttPanelOpen, onCloseGanttPanel }: GanttViewProps) {
    const data = useMemo(() => parseGantt(content, fileName), [content, fileName]);
    const editable = !!onChange;
    const svgRef = useRef<SVGSVGElement | null>(null);
    const dragRef = useRef<DragCandidate | null>(null);
    const [drag, setDrag] = useState<DragPreview | null>(null);
    const [edit, setEdit] = useState<{ taskId: string; field: 'label' | 'progress' } | null>(null);

    // 자동 생성 모달 — 빈 상태/렌더 상태 양쪽에서 동일하게 떠야 하므로 변수로 만들어 둔다.
    const panel = ganttPanelOpen && onChange ? (
        <GanttPanel
            content={content}
            onApply={(md, applyMode) => {
                // 교체=그대로, 이어붙이기=기존 본문 끝에 빈 줄 두고 추가(마크다운 SSOT).
                const next = applyMode === 'replace'
                    ? md
                    : (content.trim() ? `${content.replace(/\s+$/, '')}\n\n${md}` : md);
                onChange(next);
            }}
            onClose={() => onCloseGanttPanel?.()}
        />
    ) : null;

    const model = useMemo(() => {
        const { tasks, rangeStart, rangeEnd } = data;
        if (!rangeStart || !rangeEnd || tasks.length === 0) return null;

        // Pad the range by a day on each side so edge bars aren't flush to the frame.
        const start = addDays(rangeStart, -1);
        const end = addDays(rangeEnd, 1);
        const totalDays = diffDays(start, end) + 1;

        // Build rows: a section header (skipped for top-level '') then its tasks.
        const rows: Row[] = [];
        let y = 0;
        let prevSection: string | null = null;
        for (const task of tasks) {
            if (task.section !== prevSection) {
                prevSection = task.section;
                if (task.section) {
                    rows.push({ kind: 'section', label: task.section, y });
                    y += SECTION_H;
                }
            }
            rows.push({ kind: 'task', task, y });
            y += ROW_H;
        }

        const chartW = LABEL_W + totalDays * DAY_W;
        const chartH = HEADER_H + y;
        const today = midnight(new Date());
        const todayInRange = today.getTime() >= start.getTime() && today.getTime() <= end.getTime();
        const todayX = todayInRange ? LABEL_W + diffDays(start, today) * DAY_W : null;

        return { start, totalDays, rows, chartW, chartH, todayX, bodyH: y };
    }, [data]);

    // Global drag listeners (press → threshold → drag, else jump). Mirrors KanbanView.
    useEffect(() => {
        if (!editable) return;

        const reset = () => {
            dragRef.current = null;
            setDrag(null);
            setGanttDragSelectBlock(false);
        };

        const onMove = (e: MouseEvent) => {
            const cand = dragRef.current;
            if (!cand || !cand.draggable) return; // non-draggable press → jump only
            const dx = e.clientX - cand.startX;
            if (!cand.active && Math.abs(dx) < DRAG_THRESHOLD) return;
            cand.active = true;
            e.preventDefault();
            setDrag({ taskId: cand.task.id, mode: cand.mode, dayDelta: Math.round(dx / DAY_W) });
        };

        const onUp = (e: MouseEvent) => {
            const cand = dragRef.current;
            reset();
            if (!cand) return;
            if (!cand.active) {
                // A drag-less click opens the inline editor matching where it landed.
                if (cand.clickField) setEdit({ taskId: cand.task.id, field: cand.clickField });
                return;
            }
            e.preventDefault();
            const dayDelta = Math.round((e.clientX - cand.startX) / DAY_W);
            const next = applyGanttDrag(content, cand.task, cand.mode, dayDelta);
            if (next !== content) onChange?.(next);
        };

        window.addEventListener('mousemove', onMove, { capture: true });
        window.addEventListener('mouseup', onUp, { capture: true });
        window.addEventListener('blur', reset);
        return () => {
            window.removeEventListener('mousemove', onMove, { capture: true });
            window.removeEventListener('mouseup', onUp, { capture: true });
            window.removeEventListener('blur', reset);
            setGanttDragSelectBlock(false);
        };
    }, [content, editable, onChange]);

    /** Classify a press: which (if any) drag mode, based on where it lands on the bar. */
    const hitTest = useCallback((eff: GanttDragResult, bx: number, bw: number, clientX: number): { draggable: boolean; mode: GanttDragMode } => {
        const svgRect = svgRef.current?.getBoundingClientRect();
        if (!svgRect) return { draggable: false, mode: 'move' };
        const localX = clientX - svgRect.left; // SVG user-space x (rect.left already accounts for scroll)
        if (eff.isMilestone) {
            const cx = bx + DAY_W / 2;
            if (Math.abs(localX - cx) > MS_R + 2) return { draggable: false, mode: 'move' };
            // 다이아 오른쪽 절반을 끌면 resize-end(막대로 복원), 왼쪽/중앙은 move
            return { draggable: true, mode: localX > cx + 1 ? 'resize-end' : 'move' };
        }
        if (localX < bx - 2 || localX > bx + bw + 2) return { draggable: false, mode: 'move' };
        const edge = Math.min(EDGE_HIT, bw / 3); // shrink edge zones on short bars so a move stays possible
        if (localX <= bx + edge) return { draggable: true, mode: 'resize-start' };
        if (localX >= bx + bw - edge) return { draggable: true, mode: 'resize-end' };
        return { draggable: true, mode: 'move' };
    }, []);

    const onRowMouseDown = useCallback((task: GanttTask, eff: GanttDragResult, bx: number, bw: number) => (e: ReactMouseEvent<SVGGElement>) => {
        if (!editable || typeof task.mdLine !== 'number' || e.button !== 0) return;
        if (edit) return; // an editor is open — let it handle focus/commit, don't start a new press
        const { draggable, mode } = hitTest(eff, bx, bw, e.clientX);
        const svgRect = svgRef.current?.getBoundingClientRect();
        const localX = svgRect ? e.clientX - svgRect.left : 0;
        // Where a drag-less click lands decides which editor opens.
        const clickField: 'label' | 'progress' | null =
            localX < LABEL_W ? 'label' : (draggable && !eff.isMilestone ? 'progress' : null);
        e.preventDefault();
        if (draggable) setGanttDragSelectBlock(true);
        dragRef.current = { task, mode, startX: e.clientX, draggable, clickField, active: false };
    }, [editable, edit, hitTest]);

    const commitLabel = useCallback((task: GanttTask, label: string) => {
        const next = applyGanttLabel(content, task, label);
        if (next !== content) onChange?.(next);
        setEdit(null);
    }, [content, onChange]);

    const commitProgress = useCallback((task: GanttTask, progress: number) => {
        const next = applyGanttProgress(content, task, progress);
        if (next !== content) onChange?.(next);
        setEdit(null);
    }, [content, onChange]);

    if (!model) {
        return (
            <div className="gantt-view">
                <div className="gantt-empty">
                    <ChartBarStacked size={48} strokeWidth={1.25} />
                    <p className="gantt-empty-title">표시할 일정이 없습니다</p>
                    <p className="gantt-empty-hint">아래처럼 마커를 추가하면 간트로 표시됩니다</p>
                    <pre className="gantt-empty-example"><code>{`## 기획
- [ ] 요구사항 @start(2026-01-05) @due(2026-01-12) @progress(40)
- [ ] 출시     @start(2026-01-20)`}</code></pre>
                    <p className="gantt-empty-markers">
                        <code>@start</code> 시작일(필수) · <code>@due</code> 종료일(없으면 마일스톤) · <code>@progress</code> 진행률
                    </p>
                </div>
                {panel}
            </div>
        );
    }

    const { start, totalDays, rows, chartW, chartH, todayX, bodyH } = model;

    // Time-axis tick labels: daily for short ranges, weekly, then monthly.
    const showTick = (date: Date): boolean => {
        if (totalDays <= 21) return true;
        if (totalDays <= 70) return date.getDay() === 1; // Mondays
        return date.getDate() === 1;                     // first of month
    };
    const tickLabel = (date: Date): string =>
        totalDays > 70 ? `${date.getMonth() + 1}월` : `${date.getMonth() + 1}/${date.getDate()}`;

    return (
        <div className="gantt-view">
            <div className="gantt-scroll">
                <svg
                    ref={svgRef}
                    className={`gantt-svg${editable ? ' is-editable' : ''}${drag ? ' is-dragging' : ''}`}
                    width={chartW}
                    height={chartH}
                    role="img"
                    aria-label="간트 차트"
                >
                    {/* day grid + tick labels */}
                    {Array.from({ length: totalDays }, (_, d) => {
                        const date = addDays(start, d);
                        const x = LABEL_W + d * DAY_W;
                        const tick = showTick(date);
                        return (
                            <g key={d}>
                                <line
                                    className={tick ? 'gantt-grid gantt-grid--major' : 'gantt-grid'}
                                    x1={x}
                                    y1={HEADER_H}
                                    x2={x}
                                    y2={chartH}
                                />
                                {tick && (
                                    <text className="gantt-tick" x={x + 3} y={HEADER_H - 12}>
                                        {tickLabel(date)}
                                    </text>
                                )}
                            </g>
                        );
                    })}

                    {/* header separator + label-column divider */}
                    <line className="gantt-axis" x1={0} y1={HEADER_H} x2={chartW} y2={HEADER_H} />
                    <line className="gantt-axis" x1={LABEL_W} y1={0} x2={LABEL_W} y2={chartH} />

                    {/* rows */}
                    {rows.map((row, i) => {
                        const ry = HEADER_H + row.y;
                        if (row.kind === 'section') {
                            return (
                                <text key={i} className="gantt-section" x={10} y={ry + SECTION_H / 2 + 4}>
                                    {row.label}
                                </text>
                            );
                        }
                        const t = row.task;
                        const isDragging = drag?.taskId === t.id;
                        // While dragging, render the bar at its previewed position.
                        const eff: GanttDragResult = isDragging
                            ? previewGanttDrag(t, drag.mode, drag.dayDelta)
                            : { start: t.start, end: t.end, isMilestone: t.isMilestone };

                        const bx = LABEL_W + diffDays(start, eff.start) * DAY_W;
                        const days = diffDays(eff.start, eff.end) + 1;
                        const bw = Math.max(DAY_W * days, 6);
                        const cy = ry + ROW_H / 2;
                        const hasPct = !eff.isMilestone && t.progress > 0;
                        const maxTitle = hasPct ? 10 : 14;
                        const labelText = t.label.length > maxTitle ? `${t.label.slice(0, maxTitle - 1)}…` : t.label;

                        return (
                            <g
                                key={i}
                                className={`gantt-row${editable ? ' is-editable' : ''}${isDragging ? ' is-dragging' : ''}`}
                                onMouseDown={editable ? onRowMouseDown(t, eff, bx, bw) : undefined}
                                style={{ cursor: editable && t.mdLine ? 'grab' : (t.mdLine ? 'pointer' : 'default') }}
                            >
                                <title>
                                    {`${t.label}\n${ymd(eff.start)}${eff.isMilestone ? ' (마일스톤)' : ` → ${ymd(eff.end)}`}` +
                                        `${eff.isMilestone ? '' : `\n진행률 ${t.progress}%`}`}
                                </title>
                                {/* row hover background spanning the chart */}
                                <rect
                                    className="gantt-row-bg"
                                    x={0}
                                    y={ry}
                                    width={chartW}
                                    height={ROW_H}
                                />
                                <text className="gantt-task-label" x={18} y={cy + 4}>
                                    {labelText}
                                    {hasPct && <tspan className="gantt-task-pct"> ({t.progress}%)</tspan>}
                                </text>
                                <text className="gantt-task-meta" x={LABEL_W - 10} y={cy + 4} textAnchor="end">
                                    {ganttMeta(eff.start, eff.end, eff.isMilestone)}
                                </text>

                                {eff.isMilestone ? (
                                    // diamond centred on the start day
                                    <path
                                        className="gantt-milestone"
                                        d={diamond(bx + DAY_W / 2, cy, MS_R)}
                                        fill={t.color}
                                    />
                                ) : (() => {
                                    const by = ry + BAR_PAD;
                                    const bh = ROW_H - BAR_PAD * 2;
                                    const fillW = Math.round((bw * t.progress) / 100);
                                    return (
                                        <>
                                            <rect
                                                className="gantt-bar"
                                                x={bx}
                                                y={by}
                                                width={bw}
                                                height={bh}
                                                rx={4}
                                                fill={t.color}
                                            />
                                            {fillW > 0 && !isDragging && (
                                                <rect
                                                    className="gantt-bar-progress"
                                                    x={bx}
                                                    y={by}
                                                    width={fillW}
                                                    height={bh}
                                                    rx={4}
                                                    fill={t.color}
                                                />
                                            )}
                                        </>
                                    );
                                })()}

                                {/* live date tip while dragging */}
                                {isDragging && (
                                    <text
                                        className="gantt-drag-tip"
                                        x={eff.isMilestone ? bx + DAY_W / 2 : bx + bw / 2}
                                        y={ry + BAR_PAD - 3}
                                        textAnchor="middle"
                                    >
                                        {eff.isMilestone ? ymd(eff.start) : `${ymd(eff.start)} → ${ymd(eff.end)}`}
                                    </text>
                                )}
                            </g>
                        );
                    })}

                    {/* today line (drawn last so it sits on top) */}
                    {todayX !== null && (
                        <g>
                            <line
                                className="gantt-today"
                                x1={todayX}
                                y1={HEADER_H}
                                x2={todayX}
                                y2={HEADER_H + bodyH}
                            />
                            <text className="gantt-today-label" x={todayX + 4} y={HEADER_H + 12}>
                                오늘
                            </text>
                        </g>
                    )}

                    {/* inline editor (label / progress) — drawn last so it sits on top */}
                    {edit && (() => {
                        const row = rows.find((r) => r.kind === 'task' && r.task.id === edit.taskId);
                        if (!row || row.kind !== 'task') return null;
                        const t = row.task;
                        const ry = HEADER_H + row.y;
                        if (edit.field === 'label') {
                            return (
                                <foreignObject x={14} y={ry + 4} width={LABEL_W - 24} height={ROW_H - 8}>
                                    <GanttLabelInput
                                        initial={t.label}
                                        onCommit={(v) => commitLabel(t, v)}
                                        onCancel={() => setEdit(null)}
                                    />
                                </foreignObject>
                            );
                        }
                        // progress slider over the bar (clamped within the chart)
                        const bx = LABEL_W + diffDays(start, t.start) * DAY_W;
                        const px = Math.min(Math.max(bx, LABEL_W + 4), chartW - 174);
                        return (
                            <foreignObject x={px} y={ry + 3} width={170} height={ROW_H - 6}>
                                <GanttProgressInput
                                    initial={t.progress}
                                    onCommit={(v) => commitProgress(t, v)}
                                    onCancel={() => setEdit(null)}
                                />
                            </foreignObject>
                        );
                    })()}
                </svg>
            </div>
            {panel}
        </div>
    );
}

/** Inline name editor rendered inside a foreignObject over the label column. */
function GanttLabelInput({ initial, onCommit, onCancel }: {
    initial: string;
    onCommit: (value: string) => void;
    onCancel: () => void;
}) {
    const [value, setValue] = useState(initial);
    const ref = useRef<HTMLInputElement>(null);
    useEffect(() => { const el = ref.current; if (el) { el.focus(); el.select(); } }, []);
    return (
        <input
            ref={ref}
            className="gantt-edit-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => onCommit(value)}
            onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); onCommit(value); }
                else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
            }}
        />
    );
}

/** Inline progress slider (0–100) rendered inside a foreignObject over the bar. */
function GanttProgressInput({ initial, onCommit, onCancel }: {
    initial: number;
    onCommit: (value: number) => void;
    onCancel: () => void;
}) {
    const [value, setValue] = useState(initial);
    const ref = useRef<HTMLDivElement>(null);
    const latest = useRef(value);
    latest.current = value;
    useEffect(() => {
        // Commit when the user clicks outside the slider popover.
        const onDown = (e: PointerEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onCommit(latest.current);
        };
        document.addEventListener('pointerdown', onDown, true);
        return () => document.removeEventListener('pointerdown', onDown, true);
    }, [onCommit]);
    return (
        <div ref={ref} className="gantt-edit-progress">
            <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={value}
                autoFocus
                onChange={(e) => setValue(Number(e.target.value))}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); onCommit(value); }
                    else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
                }}
            />
            <span className="gantt-edit-progress-val">{value}%</span>
        </div>
    );
}

/** A diamond path centred at (cx, cy) with the given half-size. */
function diamond(cx: number, cy: number, r: number): string {
    return `M ${cx} ${cy - r} L ${cx + r} ${cy} L ${cx} ${cy + r} L ${cx - r} ${cy} Z`;
}

function ymd(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Slash-separated date, no zero-padding: 2026/5/11. */
function slashDate(d: Date): string {
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

/** Label-column date meta: "2026/5/11 ~ 5/13" — end-year dropped when it matches the start. */
function ganttMeta(start: Date, end: Date, isMilestone: boolean): string {
    if (isMilestone) return slashDate(start);
    const endStr = start.getFullYear() === end.getFullYear()
        ? `${end.getMonth() + 1}/${end.getDate()}`
        : slashDate(end);
    return `${slashDate(start)} ~ ${endStr}`;
}
