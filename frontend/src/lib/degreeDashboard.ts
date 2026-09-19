import type { RequirementGroupProgress, RequirementProgress, StudyPathway } from "./types";

export type CourseSuggestion = {
  id: string;
  codes: string[];
  title: string;
  reason: string;
  bucket: "core" | "elective" | "plan";
};

export type ExchangeOption = {
  id: string;
  school: string;
  city: string;
  term: string;
  fit: string;
};

/** Placeholder exchange destinations until SENG / OIA listings are wired up. */
export const DUMMY_EXCHANGE_OPTIONS: ExchangeOption[] = [
  {
    id: "nus",
    school: "National University of Singapore",
    city: "Singapore",
    term: "Year 3 Fall",
    fit: "CS courses usually map to COMP electives. Apply through SENG / OIA.",
  },
  {
    id: "waterloo",
    school: "University of Waterloo",
    city: "Waterloo",
    term: "Year 3 Spring",
    fit: "Strong CS match. Plan around COMP 4900 residency in regular HKUST terms.",
  },
  {
    id: "kaist",
    school: "KAIST",
    city: "Daejeon",
    term: "Year 3 Fall",
    fit: "Engineering-heavy catalog. Good for systems and AI electives.",
  },
  {
    id: "epfl",
    school: "EPFL",
    city: "Lausanne",
    term: "Year 3 Spring",
    fit: "Confirm credit transfer before you go. Typical load is 4–5 courses.",
  },
];

function bucketFor(kind: string): CourseSuggestion["bucket"] {
  if (kind === "electives" || kind === "elective_list" || kind === "area" || kind === "area_constraint") {
    return "elective";
  }
  return "core";
}

function walkMissing(group: RequirementGroupProgress, out: CourseSuggestion[]): void {
  if (group.status === "done") return;
  const bucket = bucketFor(group.kind);
  if (group.kind === "or_group") {
    const codes = group.items
      .filter((item) => item.course_code && item.status === "missing")
      .map((item) => item.course_code!);
    if (codes.length) {
      out.push({
        id: `or-${codes.join("-")}`,
        codes,
        title: codes.slice(0, 3).join(" / ") + (codes.length > 3 ? " / …" : ""),
        reason: "Take one of these to close the requirement.",
        bucket,
      });
    }
    return;
  }

  if ((group.kind === "elective_list" || group.kind === "area_constraint") && group.status !== "done") {
    const remaining = group.of > 0 ? Math.max(0, group.of - group.done) : 0;
    out.push({
      id: `elective-${group.name}`,
      codes: [],
      title: group.name.split("(")[0]?.split("[")[0]?.trim() || group.name,
      reason:
        remaining > 0
          ? `${remaining} course${remaining === 1 ? "" : "s"} still needed in this bucket.`
          : "Still open — pick a course that matches this rule.",
      bucket: "elective",
    });
  }

  for (const item of group.items) {
    if (item.course_code && item.status === "missing") {
      out.push({
        id: `course-${item.course_code}`,
        codes: [item.course_code],
        title: item.course_code,
        reason: group.name,
        bucket,
      });
    }
  }

  for (const child of group.children) {
    walkMissing(child, out);
  }
}

export function suggestCourses(progress: RequirementProgress | null, studyPlan?: StudyPathway | null): CourseSuggestion[] {
  const out: CourseSuggestion[] = [];
  if (progress) {
    for (const group of progress.requirements) {
      walkMissing(group, out);
    }
  }

  const currentYear = studyPlan?.variants
    ?.flatMap((variant) => variant.years)
    .find((year) => year.current);
  if (currentYear) {
    for (const term of currentYear.terms) {
      for (const slot of term.slots) {
        if (slot.status !== "open" && slot.status !== "planned") continue;
        const codes = slot.matched_code ? [slot.matched_code] : slot.codes;
        out.push({
          id: `plan-${term.season}-${slot.label}`,
          codes,
          title: codes[0] ?? slot.label,
          reason: `On the ${term.label} study-plan slot.`,
          bucket: "plan",
        });
      }
    }
  }

  const seen = new Set<string>();
  const unique: CourseSuggestion[] = [];
  for (const item of out) {
    const key = item.codes.join("|") || item.title;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
    if (unique.length >= 6) break;
  }
  return unique;
}

export function programTotals(progress: RequirementProgress | null): { done: number; total: number; pct: number } {
  if (!progress) return { done: 0, total: 0, pct: 0 };
  let done = 0;
  let missing = 0;
  let inProgress = 0;
  const walk = (group: RequirementGroupProgress) => {
    for (const item of group.items) {
      if (item.status === "done") done += 1;
      if (item.status === "missing") missing += 1;
      if (item.status === "in_progress") inProgress += 1;
    }
    group.children.forEach(walk);
  };
  progress.requirements.forEach(walk);
  const total = done + missing + inProgress;
  return { done, total, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
}
