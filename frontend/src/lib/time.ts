export const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const DAY_LABELS: Record<string, string> = {
  Mo: "Mon",
  Tu: "Tue",
  We: "Wed",
  Th: "Thu",
  Fr: "Fri",
  Sa: "Sat",
  Su: "Sun",
};

/** "09:00:00" -> minutes since midnight */
export function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** "09:00:00" -> "09:00" */
export function shortTime(time: string): string {
  return time.slice(0, 5);
}

/** Local-date-only comparisons and formatting for the timetable — no hardcoded dates or ranges. */

export function parseISODate(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function isoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** Monday of the week containing `date` (Sunday counts as the end of the prior week). */
export function mondayOf(date: Date): Date {
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(date, diff);
}

export function clampDate(date: Date, min: Date | null, max: Date | null): Date {
  if (min && date < min) return min;
  if (max && date > max) return max;
  return date;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function formatShortDate(date: Date): string {
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

export function formatWeekRange(weekStart: Date): string {
  const end = addDays(weekStart, 4);
  const sameMonth = weekStart.getMonth() === end.getMonth();
  const startLabel = sameMonth ? `${MONTHS[weekStart.getMonth()]} ${weekStart.getDate()}` : formatShortDate(weekStart);
  return `${startLabel}–${formatShortDate(end)}, ${end.getFullYear()}`;
}
