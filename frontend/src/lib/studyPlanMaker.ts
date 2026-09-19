import type { RequirementGroupProgress, RequirementProgress, StudyPlanSlot, StudyPlanVariant, StudyPathway } from "./types";

export type PlanSeason = "fall" | "spring";
export type PlanStatus = "done" | "in_progress" | "planned" | "open";

export type PlanCourse = {
  id: string;
  code: string | null;
  label: string;
  credits: number;
  options: string[];
  locked: boolean;
  status: PlanStatus;
  year: number | null;
  season: PlanSeason | null;
};

export type DraftPlan = {
  version: 2;
  variantId: string;
  courses: PlanCourse[];
};

export const PLAN_YEARS = [1, 2, 3, 4] as const;
export const PLAN_SEASONS: { id: PlanSeason; label: string }[] = [
  { id: "fall", label: "Fall" },
  { id: "spring", label: "Spring" },
];

const STORAGE_PREFIX = "ust-track:study-draft";

export function draftKey(plannerId: string, programCode: string, variantId: string): string {
  return `${STORAGE_PREFIX}:${plannerId}:${programCode}:${variantId}`;
}

function slotCredits(slot: StudyPlanSlot): number {
  return slot.credits?.min || 3;
}

function progressStatus(code: string | null, byCode: Map<string, PlanStatus>): PlanStatus {
  if (!code) return "open";
  return byCode.get(code) ?? "open";
}

export function collectProgressStatuses(progress: RequirementProgress | null): Map<string, PlanStatus> {
  const map = new Map<string, PlanStatus>();
  const walk = (group: RequirementGroupProgress) => {
    for (const item of group.items) {
      if (!item.course_code) continue;
      if (item.status === "done" || item.status === "in_progress") {
        map.set(item.course_code, item.status);
      }
    }
    group.children.forEach(walk);
  };
  progress?.requirements.forEach(walk);
  return map;
}

function remainingFromProgress(progress: RequirementProgress | null, taken: Set<string>): PlanCourse[] {
  const out: PlanCourse[] = [];
  const seen = new Set<string>();
  const walk = (group: RequirementGroupProgress) => {
    if (group.status === "done") return;
    if (group.kind === "electives" || group.kind === "elective_list" || group.kind === "area" || group.kind === "area_constraint") {
      return;
    }
    if (group.kind === "or_group") {
      const codes = group.items.map((item) => item.course_code).filter((code): code is string => Boolean(code));
      const alreadyPlaced = codes.some((code) => taken.has(code) || seen.has(code));
      if (!alreadyPlaced && codes.length) {
        codes.forEach((code) => seen.add(code));
        const shortName = group.name.length > 48 ? codes.join(" / ") : group.name;
        out.push({
          id: `or-${codes.join("-")}`,
          code: codes[0] ?? null,
          label: shortName,
          credits: group.min_credits && group.min_credits < 30 ? Math.round(group.min_credits) : 3,
          options: codes,
          locked: false,
          status: "open",
          year: null,
          season: null,
        });
      }
      group.children.forEach(walk);
      return;
    }
    for (const item of group.items) {
      if (!item.course_code || item.status !== "missing" || taken.has(item.course_code) || seen.has(item.course_code)) {
        continue;
      }
      seen.add(item.course_code);
      const note = item.note && item.note.length <= 48 ? item.note : null;
      const groupLabel = group.name.length <= 48 ? group.name : item.course_code;
      out.push({
        id: `need-${item.course_code}`,
        code: item.course_code,
        label: note || groupLabel,
        credits: 3,
        options: [],
        locked: false,
        status: "open",
        year: null,
        season: null,
      });
    }
    group.children.forEach(walk);
  };
  progress?.requirements.forEach(walk);
  return out;
}

export function seedFromPathway(variant: StudyPlanVariant | undefined, progress: RequirementProgress | null): PlanCourse[] {
  const byCode = collectProgressStatuses(progress);
  const placed: PlanCourse[] = [];
  const taken = new Set<string>();

  if (variant) {
    for (const year of variant.years) {
      for (const term of year.terms) {
        term.slots.forEach((slot, index) => {
          const matched = slot.matched_code;
          const code = matched ?? slot.codes[0] ?? null;
          const status = slot.status === "done" || slot.status === "in_progress" ? slot.status : progressStatus(code, byCode);
          const locked = status === "done" || status === "in_progress";
          if (code) taken.add(code);
          placed.push({
            id: `${year.year}-${term.season}-${index}-${slot.label}`,
            code,
            label: slot.label,
            credits: slotCredits(slot),
            options: slot.codes,
            locked,
            status: locked ? status : code ? "planned" : "open",
            year: year.year,
            season: term.season as PlanSeason,
          });
        });
      }
    }
  }

  const extras = remainingFromProgress(progress, taken);
  return [...placed, ...extras];
}

export function loadDraft(plannerId: string, programCode: string, variantId: string): DraftPlan | null {
  try {
    const raw = localStorage.getItem(draftKey(plannerId, programCode, variantId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftPlan;
    if (parsed?.version !== 2 || !Array.isArray(parsed.courses) || parsed.courses.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveDraft(plannerId: string, programCode: string, variantId: string, courses: PlanCourse[]): void {
  const draft: DraftPlan = { version: 2, variantId, courses };
  try {
    localStorage.setItem(draftKey(plannerId, programCode, variantId), JSON.stringify(draft));
  } catch {
    // private mode
  }
}

export function reconcileDraft(courses: PlanCourse[], progress: RequirementProgress | null): PlanCourse[] {
  const byCode = collectProgressStatuses(progress);
  const next = courses.map((course) => {
    const status = course.code ? (byCode.get(course.code) ?? course.status) : course.status;
    const locked = status === "done" || status === "in_progress";
    return { ...course, status: locked ? status : course.status === "done" ? "planned" : course.status, locked };
  });
  const taken = new Set(next.map((course) => course.code).filter((code): code is string => Boolean(code)));
  const existingIds = new Set(next.map((course) => course.id));
  const extras = remainingFromProgress(progress, taken).filter((course) => !existingIds.has(course.id));
  return [...next, ...extras];
}

export function emptyYears(): { year: number; label: string }[] {
  return PLAN_YEARS.map((year) => ({ year, label: `Year ${year}` }));
}

export function termCourses(courses: PlanCourse[], year: number, season: PlanSeason): PlanCourse[] {
  return courses.filter((course) => course.year === year && course.season === season);
}

export function trayCourses(courses: PlanCourse[]): PlanCourse[] {
  return courses.filter((course) => course.year == null || course.season == null);
}

export function termCredits(courses: PlanCourse[], year: number, season: PlanSeason): number {
  return termCourses(courses, year, season).reduce((sum, course) => sum + (course.credits || 0), 0);
}

export function moveCourse(
  courses: PlanCourse[],
  id: string,
  year: number | null,
  season: PlanSeason | null,
): PlanCourse[] {
  return courses.map((course) => {
    if (course.id !== id || course.locked) return course;
    return {
      ...course,
      year,
      season,
      status: year == null ? (course.code ? "open" : "open") : course.status === "open" && course.code ? "planned" : course.status,
    };
  });
}

export function setCourseCode(courses: PlanCourse[], id: string, code: string): PlanCourse[] {
  return courses.map((course) => {
    if (course.id !== id || course.locked) return course;
    return { ...course, code, status: course.year ? "planned" : "open" };
  });
}

export function suggestedVariant(data: StudyPathway | null): string {
  return data?.suggested_variant ?? data?.variants?.[0]?.id ?? "custom";
}
