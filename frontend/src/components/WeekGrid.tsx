import { DAY_LABELS, WEEKDAYS, addDays, formatShortDate, isoDate, toMinutes, type Weekday } from "../lib/time";
import type { ClassSelection } from "../lib/types";

const START_MIN = 8 * 60;
const END_MIN = 20 * 60;
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

/** A meeting is active on `date` if that date falls inside its own term window — meetings with no
 * recorded date range are treated as always active rather than hidden. */
function activeOn(date: string, startDate: string | null, endDate: string | null): boolean {
  if (startDate && date < startDate) return false;
  if (endDate && date > endDate) return false;
  return true;
}

export function WeekGrid({ selections, weekStart }: { selections: ClassSelection[]; weekStart: Date }) {
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

  const totalMin = END_MIN - START_MIN;

  return (
    <div className="overflow-x-auto border border-line bg-surface">
      <div className="min-w-[640px]">
        <div className="grid grid-cols-[3rem_repeat(5,1fr)] border-b border-line">
          <div />
          {WEEKDAYS.map((day, i) => (
            <div key={day} className="px-2 py-2 text-center">
              <p className="font-mono text-xs tracking-wide text-muted uppercase">{DAY_LABELS[day]}</p>
              <p className="font-mono text-xs text-muted">{formatShortDate(columnDates[i])}</p>
            </div>
          ))}
        </div>
        <div
          className="relative grid grid-cols-[3rem_repeat(5,1fr)]"
          style={{ height: `${totalMin}px` }}
        >
          <div className="relative">
            {HOURS.map((h) => (
              <span
                key={h}
                className="absolute right-1 -translate-y-1/2 font-mono text-[10px] text-muted"
                style={{ top: `${h * 60 - START_MIN}px` }}
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
                  className="absolute right-0 left-0 border-t border-line/60"
                  style={{ top: `${h * 60 - START_MIN}px` }}
                />
              ))}
              {blocksByDay[day].map((b, i) => (
                <div
                  key={i}
                  className="absolute right-0.5 left-0.5 overflow-hidden rounded-sm border border-accent/30 bg-accent-soft px-1.5 py-1 text-[11px] leading-tight"
                  style={{ top: `${b.start - START_MIN}px`, height: `${Math.max(b.end - b.start, 24)}px` }}
                >
                  <p className="font-mono font-medium">{b.label}</p>
                  <p className="text-muted">
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
