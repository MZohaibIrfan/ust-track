import { useEffect, useRef, useState } from "react";
import { DAY_LABELS, WEEKDAYS, addDays, formatShortDate, isoDate, toMinutes, type Weekday } from "../lib/time";
import type { ClassSelection } from "../lib/types";

const START_MIN = 8 * 60;
const END_MIN = 20 * 60;
const HEADER_PX = 40;
const HOURS = Array.from({ length: (END_MIN - START_MIN) / 60 + 1 }, (_, i) => 8 + i);

type Block = {
  day: Weekday;
  start: number;
  end: number;
  label: string;
  venue: string;
  course_code: string;
  section_code: string;
};

type LaidOutBlock = Block & { col: number; cols: number };

export type GridSelection = { course_code: string; section_code: string };

function isWeekday(value: string | null): value is Weekday {
  return !!value && (WEEKDAYS as readonly string[]).includes(value);
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function activeOn(date: string, startDate: string | null, endDate: string | null): boolean {
  if (startDate && date < startDate) return false;
  if (endDate && date > endDate) return false;
  return true;
}

function timesOverlap(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

function layoutDay(blocks: Block[]): LaidOutBlock[] {
  if (blocks.length === 0) return [];

  const sorted = [...blocks].sort(
    (a, b) => a.start - b.start || a.end - b.end || a.label.localeCompare(b.label),
  );
  const placed: { block: Block; col: number }[] = [];
  const active: { block: Block; col: number }[] = [];

  for (const block of sorted) {
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i].block.end <= block.start) active.splice(i, 1);
    }
    const used = new Set(active.map((item) => item.col));
    let col = 0;
    while (used.has(col)) col += 1;
    const item = { block, col };
    placed.push(item);
    active.push(item);
  }

  const parent = placed.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      if (!timesOverlap(placed[i].block, placed[j].block)) continue;
      const a = find(i);
      const b = find(j);
      if (a !== b) parent[a] = b;
    }
  }

  const clusterWidth = new Map<number, number>();
  for (let i = 0; i < placed.length; i++) {
    const root = find(i);
    clusterWidth.set(root, Math.max(clusterWidth.get(root) ?? 0, placed[i].col + 1));
  }

  return placed.map((item, i) => ({
    ...item.block,
    col: item.col,
    cols: clusterWidth.get(find(i)) ?? 1,
  }));
}

function clashingCourseCodes(blocksByDay: Record<Weekday, Block[]>): Set<string> {
  const codes = new Set<string>();
  for (const day of WEEKDAYS) {
    const blocks = blocksByDay[day];
    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        const a = blocks[i];
        const b = blocks[j];
        if (a.course_code === b.course_code && a.section_code === b.section_code) continue;
        if (!timesOverlap(a, b)) continue;
        codes.add(a.course_code);
        codes.add(b.course_code);
      }
    }
  }
  return codes;
}

export function WeekGrid({
  selections,
  weekStart,
  selectedCourse,
  onSelect,
}: {
  selections: ClassSelection[];
  weekStart: Date;
  selectedCourse?: string | null;
  onSelect?: (selection: GridSelection | null) => void;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const [pxPerMin, setPxPerMin] = useState(0.7);

  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const fit = () => {
      const available = el.clientHeight - HEADER_PX;
      setPxPerMin(Math.max(0.55, available / (END_MIN - START_MIN)));
    };
    fit();
    const obs = new ResizeObserver(fit);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const y = (minutes: number) => (minutes - START_MIN) * pxPerMin;
  const columnDates = WEEKDAYS.map((_, i) => addDays(weekStart, i));

  const blocksByDay: Record<Weekday, Block[]> = { Mo: [], Tu: [], We: [], Th: [], Fr: [] };
  WEEKDAYS.forEach((day, i) => {
    const dateStr = isoDate(columnDates[i]);
    for (const selection of selections) {
      for (const m of selection.meetings) {
        if (!isWeekday(m.weekday) || m.weekday !== day || !m.start_time || !m.end_time) continue;
        if (!activeOn(dateStr, m.start_date, m.end_date)) continue;
        blocksByDay[day].push({
          day,
          start: toMinutes(m.start_time),
          end: toMinutes(m.end_time),
          label: `${selection.course_code} ${selection.section_code}`,
          venue: m.venue,
          course_code: selection.course_code,
          section_code: selection.section_code,
        });
      }
    }
  });

  const clashing = clashingCourseCodes(blocksByDay);
  const laidOutByDay: Record<Weekday, LaidOutBlock[]> = {
    Mo: layoutDay(blocksByDay.Mo),
    Tu: layoutDay(blocksByDay.Tu),
    We: layoutDay(blocksByDay.We),
    Th: layoutDay(blocksByDay.Th),
    Fr: layoutDay(blocksByDay.Fr),
  };
  const totalPx = (END_MIN - START_MIN) * pxPerMin;

  return (
    <div
      ref={shellRef}
      className="h-full min-h-0 overflow-auto bg-surface-raised"
      onClick={() => onSelect?.(null)}
    >
      <div className="min-w-[640px]">
        <div className="sticky top-0 z-10 grid grid-cols-[2.75rem_repeat(5,1fr)] border-b border-line bg-surface-raised">
          <div />
          {WEEKDAYS.map((day, i) => (
            <div key={day} className="px-1 py-1.5 text-center">
              <p className="text-[11px] font-medium tracking-wide text-muted uppercase">{DAY_LABELS[day]}</p>
              <p className="font-mono text-[11px] text-muted tabular-nums">{formatShortDate(columnDates[i])}</p>
            </div>
          ))}
        </div>
        <div className="relative grid grid-cols-[2.75rem_repeat(5,1fr)]" style={{ height: `${totalPx}px` }}>
          <div className="relative">
            {HOURS.map((h) => (
              <span
                key={h}
                className={`absolute right-1 font-mono text-[10px] text-muted tabular-nums ${h === 8 ? "top-0.5" : "-translate-y-1/2"}`}
                style={{ top: h === 8 ? undefined : `${y(h * 60)}px` }}
              >
                {String(h).padStart(2, "0")}:00
              </span>
            ))}
          </div>
          {WEEKDAYS.map((day) => (
            <div key={day} className="relative border-l border-line">
              {HOURS.map((h) => (
                <div
                  key={h}
                  className="absolute right-0 left-0 border-t border-line/70"
                  style={{ top: `${y(h * 60)}px` }}
                />
              ))}
              {laidOutByDay[day].map((b, i) => {
                const lit = selectedCourse != null && b.course_code === selectedCourse;
                const dimmed = selectedCourse != null && !lit;
                const clash = clashing.has(b.course_code);
                const className = `absolute overflow-hidden rounded-[3px] py-0.5 pr-1 pl-1.5 text-left text-[11px] leading-tight ${
                  clash && lit
                    ? "bg-danger text-danger-ink"
                    : clash && dimmed
                      ? "bg-danger-soft/50 text-muted"
                      : clash
                        ? "bg-danger-soft text-danger"
                        : lit
                          ? "bg-accent text-accent-ink"
                          : dimmed
                            ? "bg-accent-soft/50 text-muted"
                            : "bg-accent-soft"
                }`;
                const style = {
                  top: `${y(b.start)}px`,
                  height: `${Math.max((b.end - b.start) * pxPerMin, 20)}px`,
                  left: `calc(${(b.col / b.cols) * 100}% + 2px)`,
                  width: `calc(${100 / b.cols}% - 4px)`,
                  boxShadow: clash
                    ? lit
                      ? "inset 2px 0 0 var(--danger-ink)"
                      : "inset 2px 0 0 var(--danger)"
                    : lit
                      ? "inset 2px 0 0 var(--accent-ink)"
                      : "inset 2px 0 0 var(--accent)",
                };
                const body = (
                  <>
                    <p className="font-medium">{b.label}</p>
                    <p className={lit ? "tabular-nums opacity-80" : clash ? "tabular-nums opacity-80" : "text-muted tabular-nums"}>
                      {formatMinutes(b.start)}–{formatMinutes(b.end)}
                      {b.venue ? ` · ${b.venue}` : ""}
                    </p>
                  </>
                );
                const title = clash ? "Time clash" : undefined;
                if (!onSelect) {
                  return (
                    <div key={`${b.course_code}-${b.section_code}-${i}`} className={className} style={style} title={title}>
                      {body}
                    </div>
                  );
                }
                return (
                  <button
                    key={`${b.course_code}-${b.section_code}-${i}`}
                    type="button"
                    className={`${className} cursor-pointer`}
                    style={style}
                    title={title}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect({ course_code: b.course_code, section_code: b.section_code });
                    }}
                  >
                    {body}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
