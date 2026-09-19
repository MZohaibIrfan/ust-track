import { useEffect, useState } from "react";
import { apiGet } from "../lib/api";
import { usePlanner } from "../lib/PlannerContext";
import type { AcademicHistoryRow, AcademicHistoryStatus, CourseRecord, DegreeProfile } from "../lib/types";

const LEGEND: { status: AcademicHistoryStatus; label: string }[] = [
  { status: "taken", label: "Taken" },
  { status: "transferred", label: "Transferred" },
  { status: "in_progress", label: "In progress" },
];

function formatUnits(units: number): string {
  return units.toFixed(2);
}

function StatusIcon({ status }: { status: AcademicHistoryStatus }) {
  const label = LEGEND.find((item) => item.status === status)?.label ?? status;
  if (status === "taken") {
    return (
      <span className="inline-flex text-[#16a34a]" title={label} aria-label={label}>
        <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.4" />
          <path
            d="M5.1 8.15 7.05 10.1 10.9 5.9"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  if (status === "transferred") {
    return (
      <span className="inline-flex text-[#0d9488]" title={label} aria-label={label}>
        <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden="true">
          <path
            d="M10.4 4.4 6.2 8l4.2 3.6"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M6.4 8h5.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  return (
    <span className="inline-flex text-[#d97706]" title={label} aria-label={label}>
      <svg viewBox="0 0 16 16" className="size-4" fill="currentColor" aria-hidden="true">
        <path d="M8 2.2 13.8 8 8 13.8 2.2 8 8 2.2Z" />
      </svg>
    </span>
  );
}

function historyStatus(status: string): AcademicHistoryStatus | null {
  if (status === "completed" || status === "done" || status === "exempt") return "taken";
  if (status === "transferred") return "transferred";
  if (status === "in_progress") return "in_progress";
  return null;
}

function toHistoryRows(courses: CourseRecord[]): AcademicHistoryRow[] {
  const rows: AcademicHistoryRow[] = [];
  for (const course of courses) {
    if (!course.course_code) continue;
    const status = historyStatus(course.status);
    if (!status) continue;
    rows.push({
      course_code: course.course_code,
      title: course.title || course.course_code,
      term: course.term_label || "—",
      grade: null,
      units: course.credits ?? 0,
      status,
    });
  }
  rows.sort((a, b) => a.term.localeCompare(b.term) || a.course_code.localeCompare(b.course_code));
  return rows;
}

export function HistoryPage() {
  const { plannerId } = usePlanner();
  const [rows, setRows] = useState<AcademicHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiGet<DegreeProfile>(`/api/degree/profile?planner_id=${plannerId}`)
      .then((profile) => {
        if (!cancelled) setRows(toHistoryRows(profile.courses));
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [plannerId]);

  return (
    <main className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-baseline gap-2 border-b border-line px-3 py-2">
        <h1 className="text-[15px] font-semibold tracking-tight">History</h1>
        <span className="text-[11px] text-muted">{loading ? "Loading…" : `${rows.length} courses`}</span>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        <div
          className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-b border-line px-4 py-3"
          aria-label="Status legend"
        >
          {LEGEND.map((item) => (
            <span key={item.status} className="inline-flex items-center gap-1.5 text-[12px] text-muted">
              <StatusIcon status={item.status} />
              {item.label}
            </span>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] table-fixed border-collapse text-left text-[13px]">
            <colgroup>
              <col className="w-[7.5rem]" />
              <col />
              <col className="w-[8.5rem]" />
              <col className="w-[4.5rem]" />
              <col className="w-[4.5rem]" />
              <col className="w-[4.5rem]" />
            </colgroup>
            <thead>
              <tr className="border-b border-line bg-fill text-[12px] font-medium text-muted">
                <th className="px-3 py-2 font-medium">Course</th>
                <th className="px-3 py-2 font-medium">Description</th>
                <th className="px-3 py-2 font-medium">Term</th>
                <th className="px-3 py-2 font-medium">Grade</th>
                <th className="px-3 py-2 text-right font-medium">Units</th>
                <th className="px-3 py-2 text-center font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-[13px] text-muted">
                    No courses on record yet.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={`${row.course_code}-${row.term}`} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-2 font-mono text-[12px] text-accent">{row.course_code}</td>
                    <td className="px-3 py-2 text-ink">{row.title}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-ink">{row.term}</td>
                    <td className="px-3 py-2 font-mono text-[12px] text-ink">{row.grade ?? "—"}</td>
                    <td className="px-3 py-2 text-right font-mono text-[12px] tabular-nums text-ink">
                      {formatUnits(row.units)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <StatusIcon status={row.status} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
