import { RequirementGroup } from "./RequirementTree";
import { countStatuses, filterRequirements, type PathwayBucket, type PathwayView } from "../lib/pathway";
import { programTotals } from "../lib/degreeDashboard";
import type { RequirementProgress } from "../lib/types";

const LEGEND = [
  { mark: "✓", label: "Completed", className: "text-page-degree" },
  { mark: "◐", label: "In progress", className: "text-page-career" },
  { mark: "○", label: "Not yet", className: "text-muted" },
];

export function DegreeRequirements({
  programs,
  view,
  buckets,
  query,
  loading,
  emptyLabel,
}: {
  programs: RequirementProgress[];
  view: PathwayView;
  buckets: readonly PathwayBucket[];
  query: string;
  loading?: boolean;
  emptyLabel?: string;
}) {
  if (loading) {
    return <p className="px-4 py-2.5 text-[13px] text-muted">Loading requirements…</p>;
  }
  if (programs.length === 0) {
    return (
      <p className="px-4 py-2.5 text-[13px] text-muted">
        {emptyLabel ?? "Declare a program to see every requirement in one place."}
      </p>
    );
  }

  const combined = programs.reduce(
    (acc, program) => {
      const next = countStatuses(program.requirements);
      acc.done += next.done;
      acc.in_progress += next.in_progress;
      acc.missing += next.missing;
      return acc;
    },
    { done: 0, in_progress: 0, missing: 0 },
  );
  const total = combined.done + combined.in_progress + combined.missing;
  const pct = total > 0 ? Math.round((combined.done / total) * 100) : 0;

  return (
    <div className="flex flex-col gap-4 p-3">
      <div className="rounded-xl border border-line bg-surface-raised px-3 py-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-[13px] font-medium">All requirements</p>
            <p className="mt-0.5 text-[12px] text-muted">
              {combined.done} completed · {combined.in_progress} in progress · {combined.missing} remaining
            </p>
          </div>
          <p className="font-mono text-[12px] text-muted tabular-nums">{pct}%</p>
        </div>
        <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-fill">
          <div className="h-full bg-page-degree" style={{ width: `${pct}%` }} />
          {total > 0 ? (
            <div className="h-full bg-page-career" style={{ width: `${Math.round((combined.in_progress / total) * 100)}%` }} />
          ) : null}
        </div>
        <div className="mt-2 flex flex-wrap gap-3 text-[11px]">
          {LEGEND.map((item) => (
            <span key={item.label} className={`flex items-center gap-1 ${item.className}`}>
              <span className="font-mono">{item.mark}</span>
              {item.label}
            </span>
          ))}
        </div>
      </div>

      {programs.map((progress) => {
        const totals = programTotals(progress);
        const counts = countStatuses(progress.requirements);
        return (
          <section key={progress.code} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-end justify-between gap-2 px-1">
              <div>
                <h2 className="text-[13px] font-medium">
                  {progress.name}{" "}
                  <span className="font-mono text-[11px] font-normal text-muted">
                    {progress.code}
                    {progress.year ? ` · ${progress.year}` : ""}
                  </span>
                </h2>
                <p className="mt-0.5 text-[12px] text-muted">
                  {counts.done} completed · {counts.in_progress} in progress · {counts.missing} remaining
                </p>
              </div>
              <p className="font-mono text-[11px] text-muted tabular-nums">{totals.pct}%</p>
            </div>
            {(() => {
              const visible = filterRequirements(progress.requirements, view, buckets, query);
              return visible.length > 0 ? (
                visible.map((group, i) => (
                  <RequirementGroup key={`${progress.code}-${group.name}-${i}`} group={group} programCode={progress.code} />
                ))
              ) : (
                <p className="px-1 text-[13px] text-muted">
                  {progress.error ?? (view === "all" ? "No requirement data for this program yet." : "Nothing in this view.")}
                </p>
              );
            })()}
          </section>
        );
      })}
    </div>
  );
}
