import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { WeekGrid } from "../components/WeekGrid";
import { apiGet } from "../lib/api";
import { getPlannerId, studentHeading } from "../lib/planner";
import { formatWeekRange, mondayOf } from "../lib/time";
import type { DegreeProfile, Plan } from "../lib/types";

const tools = [
  {
    href: "/timetable",
    color: "var(--page-timetable)",
    label: "Timetable",
    body: "Add or drop real class sections.",
  },
  {
    href: "/degree",
    color: "var(--page-degree)",
    label: "Degree",
    body: "See what's done and what's still missing.",
  },
  {
    href: "/career",
    color: "var(--page-career)",
    label: "Career",
    body: "Co-op against the degree plan.",
    soon: true,
  },
];

export function OverviewPage() {
  const weekStart = useMemo(() => mondayOf(new Date()), []);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [profile, setProfile] = useState<DegreeProfile | null>(null);

  useEffect(() => {
    const id = getPlannerId();
    apiGet<Plan>(`/api/plan?planner_id=${id}`).then(setPlan).catch(() => {
      // backend may not be running yet
    });
    apiGet<DegreeProfile>(`/api/degree/profile?planner_id=${id}`).then(setProfile).catch(() => {
      // backend may not be running yet
    });
  }, []);

  const identity = studentHeading(profile);

  return (
    <main className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-baseline justify-between gap-2 border-b border-line px-3 py-2">
        <div className="min-w-0">
          <h1 className="text-[15px] font-semibold tracking-tight">Overview</h1>
          {identity ? (
            <p className="mt-0.5 truncate text-[12px] text-muted">
              <span className="font-medium text-ink">{identity.title}</span>
              {identity.detail ? <span> · {identity.detail}</span> : null}
            </p>
          ) : null}
        </div>
        <p className="font-mono text-[12px] text-muted tabular-nums">{formatWeekRange(weekStart)}</p>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="min-h-0 min-w-0 flex-1 border-b border-line lg:border-r lg:border-b-0">
          <WeekGrid selections={plan?.class_selections ?? []} weekStart={weekStart} />
        </div>
        <aside className="flex w-full shrink-0 flex-col lg:w-64">
          {tools.map((tool) => (
            <Link
              key={tool.href}
              to={tool.href}
              className="flex items-start gap-2.5 border-b border-line px-3 py-2.5 hover:bg-fill"
            >
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-[2px]" style={{ background: tool.color }} aria-hidden />
              <span className="min-w-0">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-[13px] font-medium">{tool.label}</span>
                  <span className="text-[12px] text-muted">{tool.soon ? "Soon" : "Open"}</span>
                </span>
                <span className="mt-0.5 block text-[12px] leading-5 text-muted">{tool.body}</span>
              </span>
            </Link>
          ))}
        </aside>
      </div>
    </main>
  );
}
