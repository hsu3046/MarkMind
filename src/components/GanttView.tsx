/**
 * Gantt view mode (#54) — read-only, self-rendered SVG.
 *
 * Markdown is the SSOT: parseGantt() pulls deterministic inline markers
 * (@start/@due/@progress) off the document tree. We render a classic gantt —
 * a left label column (sections + task names) and a right time axis with bars,
 * progress fill, milestone diamonds, and a "today" line. Clicking a bar jumps to
 * its source line in the editor. No external gantt library (the other views are
 * all self-built too); editing happens in the markdown, drag-edit is a follow-up.
 */

import { useMemo } from 'react';
import { ChartBarStacked } from 'lucide-react';
import { parseGantt } from '../lib/gantt-parser';
import type { GanttTask } from '../types/gantt';
import { GanttPanel } from './GanttPanel';
import './GanttView.css';

// ── layout constants ─────────────────────────────────────────────────────────
const LABEL_W = 220;   // left label column width
const HEADER_H = 40;   // time-axis header height
const ROW_H = 32;      // task row height
const SECTION_H = 30;  // section header row height
const DAY_W = 30;      // px per day
const BAR_PAD = 6;     // vertical padding inside a row for the bar

const MS_PER_DAY = 86_400_000;

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

type Row =
    | { kind: 'section'; label: string; y: number }
    | { kind: 'task'; task: GanttTask; y: number };

interface GanttViewProps {
    content: string;
    fileName: string;
    onJumpToSource: (line: number) => void;
    /** 마크다운 SSOT 쓰기 — AI 자동 생성 결과 반영(없으면 read-only). */
    onChange?: (md: string) => void;
    /** 모달(GanttPanel) 열림 — 메인 툴바 "자동 생성" 클릭을 App 이 토글. */
    ganttPanelOpen?: boolean;
    onCloseGanttPanel?: () => void;
}

export function GanttView({ content, fileName, onJumpToSource, onChange, ganttPanelOpen, onCloseGanttPanel }: GanttViewProps) {
    const data = useMemo(() => parseGantt(content, fileName), [content, fileName]);

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
                    className="gantt-svg"
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
                        const bx = LABEL_W + diffDays(start, t.start) * DAY_W;
                        const cy = ry + ROW_H / 2;
                        const labelText =
                            t.label.length > 26 ? `${t.label.slice(0, 25)}…` : t.label;

                        return (
                            <g
                                key={i}
                                className="gantt-row"
                                onClick={() => t.mdLine && onJumpToSource(t.mdLine)}
                                style={{ cursor: t.mdLine ? 'pointer' : 'default' }}
                            >
                                <title>
                                    {`${t.label}\n${ymd(t.start)}${t.isMilestone ? ' (마일스톤)' : ` → ${ymd(t.end)}`}` +
                                        `${t.isMilestone ? '' : `\n진행률 ${t.progress}%`}`}
                                </title>
                                {/* row hover background spanning the chart */}
                                <rect
                                    className="gantt-row-bg"
                                    x={0}
                                    y={ry}
                                    width={chartW}
                                    height={ROW_H}
                                />
                                <text className="gantt-task-label" x={20} y={cy + 4}>
                                    {labelText}
                                </text>

                                {t.isMilestone ? (
                                    // diamond centred on the start day
                                    <path
                                        className="gantt-milestone"
                                        d={diamond(bx + DAY_W / 2, cy, 8)}
                                        fill={t.color}
                                    />
                                ) : (
                                    <>
                                        {(() => {
                                            const days = diffDays(t.start, t.end) + 1;
                                            const bw = Math.max(DAY_W * days, 6);
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
                                                    {fillW > 0 && (
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
                                                    {t.progress > 0 && (
                                                        <text
                                                            className="gantt-bar-pct"
                                                            x={bx + bw + 6}
                                                            y={cy + 4}
                                                        >
                                                            {t.progress}%
                                                        </text>
                                                    )}
                                                </>
                                            );
                                        })()}
                                    </>
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
                </svg>
            </div>
            {panel}
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
