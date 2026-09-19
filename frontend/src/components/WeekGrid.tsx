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

export function WeekGrid({ selections, weekStart }: { selections: ClassSelection[]; weekStart: Date }) {
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
        });
      }
    }
  });

  const totalPx = (END_MIN - START_MIN) * pxPerMin;

  return (
    <div ref={shellRef} className="h-full min-h-0 overflow-auto bg-surface-raised">
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
              {blocksByDay[day].map((b, i) => (
                <div
                  key={i}
                  className="absolute right-0.5 left-0.5 overflow-hidden rounded-[3px] bg-accent-soft py-0.5 pr-1 pl-1.5 text-[11px] leading-tight"
                  style={{
                    top: `${y(b.start)}px`,
                    height: `${Math.max((b.end - b.start) * pxPerMin, 20)}px`,
                    boxShadow: "inset 2px 0 0 var(--accent)",
                  }}
                >
                  <p className="font-medium">{b.label}</p>
                  <p className="text-muted tabular-nums">
                    {formatMinutes(b.start)}–{formatMinutes(b.end)}
                    {b.venue ? ` · ${b.venue}` : ""}
                  </p>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
