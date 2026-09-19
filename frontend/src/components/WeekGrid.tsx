import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { courseHues, withCourseHues } from "../lib/courseColor";
import { DAY_LABELS, WEEKDAYS, addDays, formatShortDate, isoDate, toMinutes, type Weekday } from "../lib/time";
import type { ClassSelection, Meeting } from "../lib/types";

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
  preview: boolean;
};

type LaidOutBlock = Block & { col: number; cols: number };

export type GridSelection = { course_code: string; section_code: string };

export type PreviewSelection = {
  course_code: string;
  section_code: string;
  meetings: Meeting[];
};

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

function blockKey(block: Block): string {
  return `${block.day}|${block.course_code}|${block.section_code}|${block.start}|${block.end}`;
}

function selectionKey(courseCode: string, sectionCode: string): string {
  return `${courseCode}|${sectionCode}`;
}

function emptyDayBlocks(): Record<Weekday, Block[]> {
  return { Mo: [], Tu: [], We: [], Th: [], Fr: [] };
}

function pushMeetings(
  blocksByDay: Record<Weekday, Block[]>,
  item: { course_code: string; section_code: string; meetings: Meeting[] },
  columnDates: Date[],
  preview: boolean,
) {
  WEEKDAYS.forEach((day, i) => {
    const dateStr = isoDate(columnDates[i]);
    for (const m of item.meetings) {
      if (!isWeekday(m.weekday) || m.weekday !== day || !m.start_time || !m.end_time) continue;
      if (!activeOn(dateStr, m.start_date, m.end_date)) continue;
      blocksByDay[day].push({
        day,
        start: toMinutes(m.start_time),
        end: toMinutes(m.end_time),
        label: `${item.course_code} ${item.section_code}`,
        venue: m.venue,
        course_code: item.course_code,
        section_code: item.section_code,
        preview,
      });
    }
  });
}

function clashingBlockKeys(blocksByDay: Record<Weekday, Block[]>): Set<string> {
  const keys = new Set<string>();
  for (const day of WEEKDAYS) {
    const blocks = blocksByDay[day];
    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        const a = blocks[i];
        const b = blocks[j];
        if (a.course_code === b.course_code && a.section_code === b.section_code) continue;
        if (!timesOverlap(a, b)) continue;
        keys.add(blockKey(a));
        keys.add(blockKey(b));
      }
    }
  }
  return keys;
}

export function WeekGrid({
  selections,
  weekStart,
  selectedCourse,
  preview,
  onSelect,
}: {
  selections: ClassSelection[];
  weekStart: Date;
  selectedCourse?: string | null;
  preview?: PreviewSelection[] | null;
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
  const todayIso = isoDate(new Date());

  const blocksByDay = emptyDayBlocks();
  const onPlan = new Set(selections.map((selection) => selectionKey(selection.course_code, selection.section_code)));
  for (const selection of selections) {
    pushMeetings(blocksByDay, selection, columnDates, false);
  }
  for (const item of preview ?? []) {
    if (onPlan.has(selectionKey(item.course_code, item.section_code))) continue;
    pushMeetings(blocksByDay, item, columnDates, true);
  }

  const hues = useMemo(() => {
    const planHues = courseHues(selections.map((selection) => selection.course_code));
    return withCourseHues(
      planHues,
      (preview ?? []).map((item) => item.course_code),
    );
  }, [selections, preview]);
  const clashing = clashingBlockKeys(blocksByDay);
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
          {WEEKDAYS.map((day, i) => {
            const isToday = isoDate(columnDates[i]) === todayIso;
            return (
              <div key={day} className="px-1 py-2 text-center">
                <p className={`text-[11px] font-medium tracking-wide uppercase ${isToday ? "text-accent" : "text-muted"}`}>
                  {DAY_LABELS[day]}
                </p>
                <p
                  className={`mt-0.5 inline-flex items-center justify-center rounded-full px-2 py-0.5 font-mono text-[11px] tabular-nums ${
                    isToday ? "bg-accent font-medium text-accent-ink shadow-soft" : "text-muted"
                  }`}
                >
                  {formatShortDate(columnDates[i])}
                </p>
              </div>
            );
          })}
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
          {WEEKDAYS.map((day, dayIdx) => (
            <div
              key={day}
              className={`relative border-l border-line ${
                isoDate(columnDates[dayIdx]) === todayIso ? "bg-accent-soft/40" : ""
              }`}
            >
              {HOURS.map((h) => (
                <div
                  key={h}
                  className="absolute right-0 left-0 border-t border-line/70"
                  style={{ top: `${y(h * 60)}px` }}
                />
              ))}
              {laidOutByDay[day].map((b, i) => {
                const lit = !b.preview && selectedCourse != null && b.course_code === selectedCourse;
                const dimmed = !b.preview && selectedCourse != null && !lit;
                const clash = clashing.has(blockKey(b));
                const className =
                  "tt-block absolute overflow-hidden rounded-lg py-1 pr-1.5 pl-2 text-left text-[11px] leading-tight transition-transform hover:z-10 hover:-translate-y-px";
                const style = {
                  "--course-h": String(hues.get(b.course_code.toUpperCase()) ?? 234),
                  top: `${y(b.start)}px`,
                  height: `${Math.max((b.end - b.start) * pxPerMin, 22)}px`,
                  left: `calc(${(b.col / b.cols) * 100}% + 3px)`,
                  width: `calc(${100 / b.cols}% - 6px)`,
                } as CSSProperties;
                const body = (
                  <>
                    <p className="font-medium">{b.label}</p>
                    <p className="tabular-nums opacity-80">
                      {formatMinutes(b.start)}–{formatMinutes(b.end)}
                      {b.venue ? ` · ${b.venue}` : ""}
                    </p>
                  </>
                );
                const title = b.preview ? "Preview" : clash ? "Time clash" : undefined;
                const attrs = {
                  className,
                  style,
                  title,
                  "data-lit": lit || undefined,
                  "data-dim": dimmed || undefined,
                  "data-clash": clash || undefined,
                  "data-preview": b.preview || undefined,
                };
                if (b.preview || !onSelect) {
                  return (
                    <div key={`${b.preview ? "preview-" : ""}${b.course_code}-${b.section_code}-${i}`} {...attrs}>
                      {body}
                    </div>
                  );
                }
                return (
                  <button
                    key={`${b.course_code}-${b.section_code}-${i}`}
                    type="button"
                    {...attrs}
                    className={`${className} cursor-pointer`}
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
