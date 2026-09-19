import type { RequirementGroupProgress, RequirementItemProgress } from "./types";

export type PathwayView = "remaining" | "this_term" | "done" | "all";
export type PathwayBucket = "required" | "fundamentals" | "electives" | "notes";

export type PathwayScope = "cores" | "electives" | "notes" | "all";

export const PATHWAY_VIEWS: { id: PathwayView; label: string }[] = [
  { id: "remaining", label: "Remaining" },
  { id: "this_term", label: "This term" },
  { id: "done", label: "Done" },
  { id: "all", label: "All" },
];

export const PATHWAY_SCOPES: { id: PathwayScope; label: string; buckets: PathwayBucket[] }[] = [
  { id: "cores", label: "Cores", buckets: ["required", "fundamentals"] },
  { id: "electives", label: "Electives", buckets: ["electives"] },
  { id: "notes", label: "Notes", buckets: ["notes"] },
  { id: "all", label: "All sections", buckets: ["required", "fundamentals", "electives", "notes"] },
];

const BUCKET_KINDS: Record<PathwayBucket, string[]> = {
  required: ["required"],
  fundamentals: ["engineering_fundamentals"],
  electives: ["electives"],
  notes: ["remarks", "advisory_pathway"],
};

export const DEFAULT_SCOPE: PathwayScope = "cores";

function itemMatchesQuery(item: RequirementItemProgress, query: string): boolean {
  if (!query) return true;
  const hay = `${item.course_code ?? ""} ${item.note ?? ""}`.toLowerCase();
  return hay.includes(query);
}

function orGroupHasPath(group: RequirementGroupProgress): boolean {
  return group.kind === "or_group" && group.items.some((i) => i.status === "done" || i.status === "in_progress");
}

function keepItem(item: RequirementItemProgress, group: RequirementGroupProgress, view: PathwayView): boolean {
  if (view === "all") return true;
  if (item.status === "info") return view !== "done" && view !== "this_term";
  if (view === "this_term") return item.status === "in_progress";
  if (view === "done") return item.status === "done";
  if (orGroupHasPath(group)) return item.status === "in_progress";
  return item.status === "missing" || item.status === "in_progress";
}

function filterGroup(
  group: RequirementGroupProgress,
  view: PathwayView,
  query: string,
): RequirementGroupProgress | null {
  if (view === "remaining" && orGroupHasPath(group) && !group.items.some((i) => i.status === "in_progress")) {
    return null;
  }

  const children = group.children
    .map((child) => filterGroup(child, view, query))
    .filter((child): child is RequirementGroupProgress => child !== null);

  const items = group.items.filter((item) => keepItem(item, group, view) && itemMatchesQuery(item, query));
  const hasCourse = items.some((item) => item.status !== "info");
  if (!hasCourse && children.length === 0) {
    if (query) return null;
    if (view !== "all") return null;
  }

  return { ...group, items, children };
}

export function filterRequirements(
  groups: RequirementGroupProgress[],
  view: PathwayView,
  buckets: readonly PathwayBucket[],
  query: string,
): RequirementGroupProgress[] {
  const allowed = new Set(buckets.flatMap((b) => BUCKET_KINDS[b]));
  const q = query.trim().toLowerCase();
  return groups
    .filter((g) => allowed.has(g.kind))
    .map((g) => filterGroup(g, view, q))
    .filter((g): g is RequirementGroupProgress => g !== null);
}

export function countStatuses(groups: RequirementGroupProgress[]): { missing: number; in_progress: number; done: number } {
  const totals = { missing: 0, in_progress: 0, done: 0 };
  const walk = (group: RequirementGroupProgress) => {
    for (const item of group.items) {
      if (item.status === "missing") totals.missing += 1;
      if (item.status === "in_progress") totals.in_progress += 1;
      if (item.status === "done") totals.done += 1;
    }
    group.children.forEach(walk);
  };
  groups.forEach(walk);
  return totals;
}
