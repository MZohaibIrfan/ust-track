import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../lib/api";
import { DEMO_PLANNER_ID } from "../lib/planner";
import type { CourseRecord, DegreeProfile } from "../lib/types";

const GROUPS: { status: string; label: string }[] = [
  { status: "completed", label: "Completed" },
  { status: "in_progress", label: "In progress" },
  { status: "planned", label: "Planned" },
];

export function HistoryPage() {
  const [courses, setCourses] = useState<CourseRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<DegreeProfile>(`/api/degree/profile?planner_id=${DEMO_PLANNER_ID}`)
      .then((profile) => setCourses(profile.courses))
      .catch(() => setError("Couldn't load course history."));
  }, []);

  const grouped = useMemo(() => {
    const byStatus = new Map<string, CourseRecord[]>();
    for (const course of courses ?? []) {
      const list = byStatus.get(course.status) ?? [];
      list.push(course);
      byStatus.set(course.status, list);
    }
    const known = GROUPS.map((group) => ({
      ...group,
      courses: byStatus.get(group.status) ?? [],
    }));
    const extra = [...byStatus.entries()]
      .filter(([status]) => !GROUPS.some((group) => group.status === status))
      .map(([status, list]) => ({
        status,
        label: status.replaceAll("_", " "),
        courses: list,
      }));
    return [...known, ...extra].filter((group) => group.courses.length > 0);
  }, [courses]);

  return (
    <main className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-baseline gap-2 border-b border-line px-3 py-2">
        <h1 className="text-[15px] font-semibold tracking-tight">History</h1>
        <span className="font-mono text-[11px] text-muted">Demo · {DEMO_PLANNER_ID}</span>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {error ? <p className="px-4 py-2.5 text-[13px] text-accent">{error}</p> : null}
        {courses === null && !error ? (
          <p className="px-4 py-2.5 text-[13px] text-muted">Loading course history…</p>
        ) : null}
        {courses && courses.length === 0 ? (
          <p className="px-4 py-2.5 text-[13px] text-muted">No courses recorded yet.</p>
        ) : null}
        {grouped.map((group) => (
          <section key={group.status}>
            <h2 className="border-b border-line px-4 py-2 text-[12px] font-medium text-muted">
              {group.label}
              <span className="ml-2 font-mono tabular-nums">{group.courses.length}</span>
            </h2>
            <ul>
              {group.courses.map((course) => (
                <li
                  key={`${course.course_code}-${course.status}`}
                  className="border-b border-line px-4 py-1.5 font-mono text-[13px] last:border-b-0"
                >
                  {course.course_code}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
