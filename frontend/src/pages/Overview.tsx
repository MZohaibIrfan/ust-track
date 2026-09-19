import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../lib/api";
import { getPlannerId, studentHeading } from "../lib/planner";
import { countStatuses } from "../lib/pathway";
import { DAY_LABELS, WEEKDAYS, parseISODate, shortTime, toMinutes } from "../lib/time";
import type {
  ClassSelection,
  ConflictEntry,
  DegreeProfile,
  Plan,
  RequirementProgress,
  Term,
} from "../lib/types";

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

type UpcomingClass = {
  key: string;
  course_code: string;
  section_code: string;
  weekday: string;
  start_time: string;
  end_time: string;
  venue: string;
};

function currentTermLabel(terms: Term[]): string | null {
  if (terms.length === 0) return null;
  const today = new Date();
  const withinTerm = terms.find((t) => {
    if (!t.start_date || !t.end_date) return false;
    return parseISODate(t.start_date) <= today && today <= parseISODate(t.end_date);
  });
  if (withinTerm) return withinTerm.label;
  const upcoming = terms
    .filter((t) => t.start_date && parseISODate(t.start_date) > today)
    .sort((a, b) => parseISODate(a.start_date!).getTime() - parseISODate(b.start_date!).getTime());
  return (upcoming[0] ?? terms[0]).label;
}

function upcomingClasses(selections: ClassSelection[], limit: number): UpcomingClass[] {
  const now = new Date();
  const todayIdx = WEEKDAYS.indexOf(["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][now.getDay()] as (typeof WEEKDAYS)[number]);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const all: UpcomingClass[] = [];
  for (const sel of selections) {
    for (const m of sel.meetings) {
      if (!m.weekday || !m.start_time || !m.end_time) continue;
      all.push({
        key: `${sel.section_id}-${m.weekday}-${m.start_time}`,
        course_code: sel.course_code,
        section_code: sel.section_code,
        weekday: m.weekday,
        start_time: m.start_time,
        end_time: m.end_time,
        venue: m.venue,
      });
    }
  }

  all.sort((a, b) => {
    const dayA = WEEKDAYS.indexOf(a.weekday as (typeof WEEKDAYS)[number]);
    const dayB = WEEKDAYS.indexOf(b.weekday as (typeof WEEKDAYS)[number]);
    return dayA - dayB || toMinutes(a.start_time) - toMinutes(b.start_time);
  });

  const upcoming = all.filter((c) => {
    const dayIdx = WEEKDAYS.indexOf(c.weekday as (typeof WEEKDAYS)[number]);
    if (dayIdx < 0 || todayIdx < 0) return true;
    if (dayIdx > todayIdx) return true;
    if (dayIdx === todayIdx) return toMinutes(c.start_time) >= nowMinutes;
    return false;
  });

  const list = upcoming.length > 0 ? upcoming : all;
  return list.slice(0, limit);
}

export function OverviewPage() {
  const plannerId = getPlannerId();

  const [profile, setProfile] = useState<DegreeProfile | null>(null);
  const [progressByCode, setProgressByCode] = useState<Record<string, RequirementProgress>>({});
  const [plan, setPlan] = useState<Plan | null>(null);
  const [conflicts, setConflicts] = useState<ConflictEntry[]>([]);
  const [terms, setTerms] = useState<Term[]>([]);

  useEffect(() => {
    apiGet<DegreeProfile>(`/api/degree/profile?planner_id=${plannerId}`)
      .then(async (p) => {
        setProfile(p);
        const declared = p.declared_programs.filter((d): d is { code: string; role: string; intake_year: number | null } => !!d.code);
        const entries = await Promise.all(
          declared.map(async (d) => {
            const progress = await apiGet<RequirementProgress>(
              `/api/degree/progress?planner_id=${plannerId}&program_code=${d.code}`,
            );
            return [d.code, progress] as const;
          }),
        );
        setProgressByCode(Object.fromEntries(entries));
      })
      .catch(() => {
        // backend may not be running yet
      });

    apiGet<Plan>(`/api/plan?planner_id=${plannerId}`).then(setPlan).catch(() => {});
    apiGet<{ planner_id: string; conflicts: ConflictEntry[] }>(`/api/plan/conflicts?planner_id=${plannerId}`)
      .then((r) => setConflicts(r.conflicts))
      .catch(() => {});
    apiGet<Term[]>("/api/term").then(setTerms).catch(() => {});
  }, [plannerId]);

  const identity = studentHeading(profile);
  const termLabel = useMemo(() => currentTermLabel(terms), [terms]);
  const upcoming = useMemo(() => upcomingClasses(plan?.class_selections ?? [], 4), [plan]);

  const programBars = useMemo(
    () =>
      profile?.declared_programs
        .filter((d) => d.code && progressByCode[d.code])
        .map((d) => {
          const progress = progressByCode[d.code!];
          const totals = countStatuses(progress.requirements);
          const total = totals.done + totals.in_progress + totals.missing;
          const pct = total > 0 ? Math.round((totals.done / total) * 100) : 0;
          return { code: d.code!, name: progress.name, role: d.role, done: totals.done, total, pct };
        }) ?? [],
    [profile, progressByCode],
  );

  return (
    <main className="flex h-full min-h-0 flex-col overflow-y-auto">
      <header className="shrink-0 border-b border-line px-4 py-3">
        <h1 className="text-[17px] font-semibold tracking-tight">
          {termLabel ? `Hello — ${termLabel}` : "Hello"}
        </h1>
        <p className="mt-0.5 text-[12px] text-muted">
          {identity ? `${identity.title}${identity.detail ? ` · ${identity.detail}` : ""}` : "No program declared yet."}
        </p>
      </header>

      <div className="grid gap-3 p-4 md:grid-cols-3">
        <section className="flex flex-col gap-2 rounded-md border border-line bg-surface-raised p-3">
          <p className="text-[11px] font-medium tracking-wide text-muted uppercase">Pathway</p>
          {profile && profile.declared_programs.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {profile.declared_programs.map((d) => (
                <li key={`${d.code}-${d.role}`} className="text-[13px]">
                  <span className="font-mono">{d.code}</span>{" "}
                  <span className="text-muted">· {d.role.replaceAll("_", " ")}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted">No program declared yet.</p>
          )}
          <Link to="/degree" className="mt-auto pt-1 text-[12px] font-medium text-accent hover:underline">
            Open degree planner →
          </Link>
        </section>

        <section className="flex flex-col gap-2 rounded-md border border-line bg-surface-raised p-3">
          <p className="text-[11px] font-medium tracking-wide text-muted uppercase">This week</p>
          {upcoming.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {upcoming.map((c) => (
                <li key={c.key} className="flex items-baseline justify-between gap-2 text-[13px]">
                  <span className="font-mono">
                    {c.course_code} {c.section_code}
                  </span>
                  <span className="shrink-0 text-[12px] text-muted tabular-nums">
                    {DAY_LABELS[c.weekday] ?? c.weekday} {shortTime(c.start_time)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted">No classes on the calendar yet.</p>
          )}
          <Link to="/timetable" className="mt-auto pt-1 text-[12px] font-medium text-accent hover:underline">
            Open timetable →
          </Link>
        </section>

        <section className="flex flex-col gap-2 rounded-md border border-line bg-surface-raised p-3">
          <p className="text-[11px] font-medium tracking-wide text-muted uppercase">Requirements</p>
          {programBars.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {programBars.map((b) => (
                <li key={b.code} className="text-[13px]">
                  <span className="font-mono">{b.code}</span>{" "}
                  <span className="text-muted">
                    · {b.done} of {b.total} met
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted">Declare a program to see progress.</p>
          )}
          <Link to="/degree" className="mt-auto pt-1 text-[12px] font-medium text-accent hover:underline">
            See full breakdown →
          </Link>
        </section>
      </div>

      {programBars.length > 0 ? (
        <div className="grid gap-3 px-4 pb-4 md:grid-cols-3">
          {programBars.map((b) => (
            <div key={b.code} className="flex flex-col gap-1.5 rounded-md border border-line p-3">
              <p className="text-[13px] font-medium">{b.name}</p>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-fill">
                <div className="h-full rounded-full bg-accent" style={{ width: `${b.pct}%` }} />
              </div>
              <p className="font-mono text-[11px] text-muted">
                {b.done} of {b.total} · {b.pct}%
              </p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-2 px-4 pb-4">
        <p className="text-[11px] font-medium tracking-wide text-muted uppercase">Alerts</p>
        {conflicts.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {conflicts.map((c, i) => (
              <li
                key={i}
                className="rounded-md border border-line bg-surface-raised px-3 py-2 text-[13px] text-accent"
              >
                Schedule conflict: {c.a} {c.a_section} overlaps {c.b} {c.b_section} on {DAY_LABELS[c.weekday] ?? c.weekday}.
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted">No scheduling conflicts detected.</p>
        )}
      </div>

      <div className="mt-auto flex flex-col border-t border-line sm:flex-row">
        {tools.map((tool) => (
          <Link
            key={tool.href}
            to={tool.href}
            className="flex flex-1 items-start gap-2.5 border-b border-line px-4 py-2.5 hover:bg-fill sm:border-r sm:border-b-0 sm:last:border-r-0"
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
      </div>
    </main>
  );
}
