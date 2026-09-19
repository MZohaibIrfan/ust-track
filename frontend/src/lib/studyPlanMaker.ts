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

export type TermStatus = "regular" | "exchange" | "leave";

export type DraftPlan = {
  version: 2 | 3;
  variantId: string;
  courses: PlanCourse[];
  termStatuses?: Record<string, TermStatus>;
};

export const PLAN_YEARS = [1, 2, 3, 4] as const;
export const PLAN_SEASONS: { id: PlanSeason; label: string }[] = [
  { id: "fall", label: "Fall" },
  { id: "spring", label: "Spring" },
];
export const TERM_STATUSES: { id: TermStatus; label: string }[] = [
  { id: "regular", label: "Regular" },
  { id: "exchange", label: "Exchange" },
  { id: "leave", label: "Leave" },
];
export const MAX_TERM_CREDITS = 18;

export function termStatusKey(year: number, season: PlanSeason): string {
  return `${year}-${season}`;
}

export function getTermStatus(
  statuses: Record<string, TermStatus> | undefined,
  year: number,
  season: PlanSeason,
): TermStatus {
  return statuses?.[termStatusKey(year, season)] ?? "regular";
}

export function termLabel(year: number, season: PlanSeason): string {
  return `Year ${year} ${season === "fall" ? "Fall" : "Spring"}`;
}

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
    if ((parsed?.version !== 2 && parsed?.version !== 3) || !Array.isArray(parsed.courses) || parsed.courses.length === 0) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveDraft(
  plannerId: string,
  programCode: string,
  variantId: string,
  courses: PlanCourse[],
  termStatuses: Record<string, TermStatus> = {},
): void {
  const draft: DraftPlan = { version: 3, variantId, courses, termStatuses };
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

export function planYears(
  courses: PlanCourse[],
  termStatuses: Record<string, TermStatus> = {},
): { year: number; label: string }[] {
  const years = new Set<number>(PLAN_YEARS);
  for (const course of courses) {
    if (course.year) years.add(course.year);
  }
  for (const key of Object.keys(termStatuses)) {
    const year = Number(key.split("-", 1)[0]);
    if (Number.isFinite(year)) years.add(year);
  }
  return [...years].sort((a, b) => a - b).map((year) => ({ year, label: `Year ${year}` }));
}

export type TermMove = {
  id: string;
  code: string | null;
  label: string;
  from: string;
  to: string;
};

export type TermStatusResult = {
  courses: PlanCourse[];
  termStatuses: Record<string, TermStatus>;
  moved: TermMove[];
  deferral: { needed: boolean; year?: number; reason: string } | null;
  error?: string;
};

function termOrder(year: number, season: PlanSeason): number {
  return year * 2 + (season === "spring" ? 1 : 0);
}

function packDisplaced(
  courses: PlanCourse[],
  displaced: PlanCourse[],
  statuses: Record<string, TermStatus>,
  years: number[],
  vacated: { year: number; season: PlanSeason },
): { courses: PlanCourse[]; leftover: PlanCourse[]; moved: TermMove[] } {
  const next = courses.map((course) => ({ ...course }));
  const byId = new Map(next.map((course) => [course.id, course]));
  const after = termOrder(vacated.year, vacated.season);
  const candidates: { year: number; season: PlanSeason }[] = [];
  for (const year of years) {
    for (const season of PLAN_SEASONS.map((item) => item.id)) {
      if (getTermStatus(statuses, year, season) !== "regular") continue;
      if (year === vacated.year && season === vacated.season) continue;
      candidates.push({ year, season });
    }
  }
  const slots = [
    ...candidates.filter((term) => termOrder(term.year, term.season) > after),
    ...candidates.filter((term) => termOrder(term.year, term.season) <= after),
  ];

  const moved: TermMove[] = [];
  const leftover: PlanCourse[] = [];
  for (const course of displaced) {
    const target = byId.get(course.id);
    if (!target) continue;
    const need = target.credits || 0;
    const slot = slots.find((term) => termCredits(next, term.year, term.season) + need <= MAX_TERM_CREDITS);
    if (!slot) {
      leftover.push(course);
      continue;
    }
    target.year = slot.year;
    target.season = slot.season;
    if (target.code) target.status = "planned";
    moved.push({
      id: target.id,
      code: target.code,
      label: target.label,
      from: termLabel(vacated.year, vacated.season),
      to: termLabel(slot.year, slot.season),
    });
  }
  return { courses: next, leftover, moved };
}

export function setTermStatus(
  courses: PlanCourse[],
  termStatuses: Record<string, TermStatus>,
  year: number,
  season: PlanSeason,
  status: TermStatus,
): TermStatusResult {
  const sitting = termCourses(courses, year, season);
  if (status === "exchange" || status === "leave") {
    const locked = sitting.filter((course) => course.locked);
    if (locked.length) {
      const names = locked
        .slice(0, 4)
        .map((course) => course.code ?? course.label)
        .join(", ");
      return {
        courses,
        termStatuses,
        moved: [],
        deferral: null,
        error: `${termLabel(year, season)} already has taken or in-progress courses (${names}). Pick a future term.`,
      };
    }
    const displaced = sitting.filter((course) => !course.locked);
    let nextCourses = courses.map((course) =>
      displaced.some((item) => item.id === course.id)
        ? { ...course, year: null, season: null, status: "open" as PlanStatus }
        : course,
    );
    const nextStatuses = { ...termStatuses, [termStatusKey(year, season)]: status };
    let years = planYears(nextCourses, nextStatuses).map((item) => item.year);
    let packed = packDisplaced(nextCourses, displaced, nextStatuses, years, { year, season });
    nextCourses = packed.courses;
    const moved = [...packed.moved];
    let deferral: TermStatusResult["deferral"] = null;
    if (packed.leftover.length) {
      const extra = Math.max(5, (years[years.length - 1] ?? 4) + 1);
      nextStatuses[termStatusKey(extra, "fall")] = nextStatuses[termStatusKey(extra, "fall")] ?? "regular";
      nextStatuses[termStatusKey(extra, "spring")] = nextStatuses[termStatusKey(extra, "spring")] ?? "regular";
      years = planYears(nextCourses, nextStatuses).map((item) => item.year);
      packed = packDisplaced(nextCourses, packed.leftover, nextStatuses, years, { year, season });
      nextCourses = packed.courses;
      moved.push(...packed.moved);
      const still = packed.leftover.map((course) => course.code ?? course.label);
      deferral = {
        needed: true,
        year: extra,
        reason: `Remaining courses don't fit in years 1–4 after ${termLabel(year, season)} is ${status}. Year ${extra} was added.${still.length ? ` Still unplaced: ${still.join(", ")}.` : ""}`,
      };
    }
    return { courses: nextCourses, termStatuses: nextStatuses, moved, deferral };
  }
  return {
    courses,
    termStatuses: { ...termStatuses, [termStatusKey(year, season)]: "regular" },
    moved: [],
    deferral: null,
  };
}

export function snapshotFromPayload(payload: {
  courses?: PlanCourse[];
  term_statuses?: Record<string, TermStatus>;
}): { courses: PlanCourse[]; termStatuses: Record<string, TermStatus> } | null {
  if (!payload.courses) return null;
  return { courses: payload.courses, termStatuses: payload.term_statuses ?? {} };
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
