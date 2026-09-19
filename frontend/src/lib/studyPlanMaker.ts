import type {
  CourseRecord,
  RequirementGroupProgress,
  RequirementProgress,
  StudyPlanSlot,
  StudyPlanVariant,
  StudyPathway,
} from "./types";

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
export const MAX_PLAN_YEAR = 8;
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

export function catalogTermLabel(intakeYear: number | null | undefined, year: number, season: PlanSeason): string | null {
  if (!intakeYear) return null;
  const start = intakeYear + year - 1;
  return `${start}-${String(start + 1).slice(-2)} ${season === "fall" ? "Fall" : "Spring"}`;
}

function termOrder(year: number, season: PlanSeason): number {
  return year * 2 + (season === "spring" ? 1 : 0);
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

const COMP_4900 = "COMP4900";
const COMP_4900_LABEL = "Academic and Professional Development";

function isComp4900(course: PlanCourse): boolean {
  return (course.code || "").toUpperCase() === COMP_4900;
}

export function isBaseYear(year: number): boolean {
  return year >= 1 && year <= PLAN_YEARS[PLAN_YEARS.length - 1];
}

export function termVisible(
  year: number,
  season: PlanSeason,
  courses: PlanCourse[],
  termStatuses: Record<string, TermStatus> = {},
): boolean {
  if (isBaseYear(year)) return true;
  if (termStatuses[termStatusKey(year, season)]) return true;
  return courses.some((course) => course.year === year && course.season === season);
}

function progressHasComp4900(progress: RequirementProgress | null): boolean {
  let found = false;
  const walk = (group: RequirementGroupProgress) => {
    if (group.items.some((item) => item.course_code === COMP_4900)) found = true;
    group.children.forEach(walk);
  };
  progress?.requirements.forEach(walk);
  return found;
}

export function needsComp4900(progress: RequirementProgress | null, programCodes: string[] = []): boolean {
  if (programCodes.some((code) => code === "COMP" || code === "COSC")) return true;
  return progressHasComp4900(progress);
}

function currentOrderFromCourses(courses: PlanCourse[]): number {
  let bestInProgress = -1;
  let bestDone = -1;
  for (const course of courses) {
    if (course.year == null || course.season == null || isComp4900(course)) continue;
    const order = termOrder(course.year, course.season);
    if (course.status === "in_progress") bestInProgress = Math.max(bestInProgress, order);
    if (course.status === "done") bestDone = Math.max(bestDone, order);
  }
  if (bestInProgress >= 0) return bestInProgress;
  if (bestDone >= 0) return bestDone + 1;
  return termOrder(1, "fall");
}

function ensureComp4900(
  courses: PlanCourse[],
  termStatuses: Record<string, TermStatus> = {},
  current: number,
  enabled: boolean,
): PlanCourse[] {
  const without = courses.filter((course) => !isComp4900(course));
  if (!enabled) return without;
  const next = [...without];
  for (const year of planBoard(without, termStatuses)) {
    for (const season of year.seasons) {
      if (getTermStatus(termStatuses, year.year, season) !== "regular") continue;
      const order = termOrder(year.year, season);
      const status: PlanStatus = order < current ? "done" : order === current ? "in_progress" : "planned";
      next.push({
        id: `residency-${COMP_4900}-${year.year}-${season}`,
        code: COMP_4900,
        label: COMP_4900_LABEL,
        credits: 0,
        options: [],
        locked: true,
        status,
        year: year.year,
        season,
      });
    }
  }
  return next;
}

const TERM_LABEL_RE = /^(\d{4})-\d{2}\s+(Fall|Spring)\b/i;

function historyPlanStatus(status: string): PlanStatus | null {
  const normalized = status.toLowerCase();
  if (normalized === "completed" || normalized === "done" || normalized === "exempt" || normalized === "transferred") {
    return "done";
  }
  if (normalized === "in_progress") return "in_progress";
  return null;
}

export function parseTermLabel(label: string | null | undefined): { startYear: number; season: PlanSeason } | null {
  if (!label) return null;
  const match = TERM_LABEL_RE.exec(label.trim());
  if (!match) return null;
  return { startYear: Number(match[1]), season: match[2].toLowerCase() === "spring" ? "spring" : "fall" };
}

function planYearFromIntake(startYear: number, intakeYear: number): number {
  return Math.max(1, startYear - intakeYear + 1);
}

export function coursesFromHistory(
  history: CourseRecord[] | undefined,
  intakeYear: number | null,
  standingYear: number | null = null,
): PlanCourse[] {
  const out: PlanCourse[] = [];
  const seen = new Set<string>();
  for (const row of history ?? []) {
    const code = row.course_code;
    const status = historyPlanStatus(row.status);
    if (!code || !status || code === COMP_4900) continue;
    const parsed = parseTermLabel(row.term_label);
    let year: number | null = null;
    let season: PlanSeason | null = null;
    if (parsed && intakeYear != null) {
      year = planYearFromIntake(parsed.startYear, intakeYear);
      season = parsed.season;
    } else if (status === "in_progress" && standingYear) {
      year = standingYear;
      season = parsed?.season ?? "fall";
    }
    const id = year && season ? `hist-${code}-${year}-${season}` : `hist-${code}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      code,
      label: row.title || code,
      credits: row.credits ?? 3,
      options: [],
      locked: true,
      status,
      year,
      season,
    });
  }
  const seasonRank = (season: PlanSeason | null) => (season === "spring" ? 1 : 0);
  return out.sort((a, b) => {
    if ((a.year ?? 99) !== (b.year ?? 99)) return (a.year ?? 99) - (b.year ?? 99);
    if (seasonRank(a.season) !== seasonRank(b.season)) return seasonRank(a.season) - seasonRank(b.season);
    return (a.code || a.label).localeCompare(b.code || b.label);
  });
}

function currentTermOrder(
  history: CourseRecord[] | undefined,
  intakeYear: number | null,
  standingYear: number | null,
): number {
  let bestInProgress = -1;
  let bestDone = -1;
  for (const row of history ?? []) {
    const status = historyPlanStatus(row.status);
    const parsed = parseTermLabel(row.term_label);
    if (!status || !parsed || intakeYear == null) continue;
    const order = termOrder(planYearFromIntake(parsed.startYear, intakeYear), parsed.season);
    if (status === "in_progress") bestInProgress = Math.max(bestInProgress, order);
    if (status === "done") bestDone = Math.max(bestDone, order);
  }
  if (bestInProgress >= 0) return bestInProgress;
  if (bestDone >= 0) return bestDone + 1;
  if (standingYear) return termOrder(standingYear, "fall");
  return termOrder(1, "fall");
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
      const codes = group.items
        .filter((item) => item.course_code && item.status !== "excluded")
        .map((item) => item.course_code)
        .filter((code): code is string => Boolean(code));
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
      if (
        !item.course_code ||
        item.course_code === COMP_4900 ||
        item.status !== "missing" ||
        taken.has(item.course_code) ||
        seen.has(item.course_code)
      ) {
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

export function seedFromPathway(
  variant: StudyPlanVariant | undefined,
  progress: RequirementProgress | null,
  history?: CourseRecord[],
  intakeYear?: number | null,
  standingYear?: number | null,
  programCodes: string[] = [],
  termStatuses: Record<string, TermStatus> = {},
): PlanCourse[] {
  const byCode = collectProgressStatuses(progress);
  const historyCourses = coursesFromHistory(history, intakeYear ?? null, standingYear ?? null);
  const placed: PlanCourse[] = [...historyCourses];
  const taken = new Set(historyCourses.map((course) => course.code).filter((code): code is string => Boolean(code)));
  const current = currentTermOrder(history, intakeYear ?? null, standingYear ?? null);

  if (variant) {
    for (const year of variant.years) {
      for (const term of year.terms) {
        const season = term.season as PlanSeason;
        const past = termOrder(year.year, season) < current;
        term.slots.forEach((slot, index) => {
          const matched = slot.matched_code;
          const code = matched ?? slot.codes[0] ?? null;
          if (code && taken.has(code)) return;
          if (slot.codes.some((item) => taken.has(item))) return;
          if (past) return;

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
            season,
          });
        });
      }
    }
  }

  const extras = remainingFromProgress(progress, taken);
  return ensureComp4900(
    [...placed, ...extras],
    termStatuses,
    current,
    needsComp4900(progress, programCodes),
  );
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

const PATHWAY_SLOT_ID_RE = /^(\d+)-(fall|spring)-/i;

export function reconcileDraft(
  courses: PlanCourse[],
  progress: RequirementProgress | null,
  history?: CourseRecord[],
  intakeYear?: number | null,
  standingYear?: number | null,
  programCodes: string[] = [],
  termStatuses: Record<string, TermStatus> = {},
): PlanCourse[] {
  const byCode = collectProgressStatuses(progress);
  const historyCourses = coursesFromHistory(history, intakeYear ?? null, standingYear ?? null);
  const byHistCode = new Map(historyCourses.map((course) => [course.code as string, course]));
  const current = currentTermOrder(history, intakeYear ?? null, standingYear ?? null);

  const next: PlanCourse[] = [];
  const usedHist = new Set<string>();
  for (const course of courses) {
    if (isComp4900(course)) continue;
    const slotMatch = PATHWAY_SLOT_ID_RE.exec(course.id);
    if (slotMatch && !course.locked) {
      const order = termOrder(Number(slotMatch[1]), slotMatch[2].toLowerCase() as PlanSeason);
      if (order < current && !byHistCode.has(course.code || "")) continue;
    }
    const hist = course.code ? byHistCode.get(course.code) : undefined;
    if (hist) {
      if (usedHist.has(hist.id)) continue;
      usedHist.add(hist.id);
      next.push({
        ...course,
        code: hist.code,
        label: hist.label || course.label,
        credits: hist.credits || course.credits,
        locked: true,
        status: hist.status,
        year: hist.year,
        season: hist.season,
      });
      continue;
    }
    const status = course.code ? (byCode.get(course.code) ?? course.status) : course.status;
    const locked = status === "done" || status === "in_progress";
    next.push({
      ...course,
      status: locked ? status : course.status === "done" ? "planned" : course.status,
      locked,
    });
  }

  for (const hist of historyCourses) {
    if (!hist.code || usedHist.has(hist.id)) continue;
    next.push(hist);
    usedHist.add(hist.id);
  }

  const taken = new Set(next.map((course) => course.code).filter((code): code is string => Boolean(code)));
  const existingIds = new Set(next.map((course) => course.id));
  const extras = remainingFromProgress(progress, taken).filter((course) => !existingIds.has(course.id));
  return ensureComp4900(
    [...next, ...extras],
    termStatuses,
    current,
    needsComp4900(progress, programCodes) || courses.some(isComp4900),
  );
}

export function emptyYears(): { year: number; label: string }[] {
  return PLAN_YEARS.map((year) => ({ year, label: `Year ${year}` }));
}

export type PlanYearBoard = { year: number; label: string; seasons: PlanSeason[] };

export function planBoard(
  courses: PlanCourse[],
  termStatuses: Record<string, TermStatus> = {},
): PlanYearBoard[] {
  const byYear = new Map<number, Set<PlanSeason>>();
  for (const year of PLAN_YEARS) {
    byYear.set(year, new Set(PLAN_SEASONS.map((item) => item.id)));
  }
  for (const course of courses) {
    if (!course.year || !course.season) continue;
    const seasons = byYear.get(course.year) ?? new Set<PlanSeason>();
    seasons.add(course.season);
    byYear.set(course.year, seasons);
  }
  for (const key of Object.keys(termStatuses)) {
    const [rawYear, rawSeason] = key.split("-");
    const year = Number(rawYear);
    if (!Number.isFinite(year) || (rawSeason !== "fall" && rawSeason !== "spring")) continue;
    const seasons = byYear.get(year) ?? new Set<PlanSeason>();
    seasons.add(rawSeason);
    byYear.set(year, seasons);
  }
  return [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, seasons]) => ({
      year,
      label: `Year ${year}`,
      seasons: PLAN_SEASONS.map((item) => item.id).filter((season) => seasons.has(season)),
    }));
}

export function planYears(
  courses: PlanCourse[],
  termStatuses: Record<string, TermStatus> = {},
): { year: number; label: string }[] {
  return planBoard(courses, termStatuses).map(({ year, label }) => ({ year, label }));
}

export function nextAddableTerm(
  courses: PlanCourse[],
  termStatuses: Record<string, TermStatus> = {},
): { year: number; season: PlanSeason } | null {
  let year = PLAN_YEARS[PLAN_YEARS.length - 1] + 1;
  let season: PlanSeason = "fall";
  while (year <= MAX_PLAN_YEAR) {
    if (!termVisible(year, season, courses, termStatuses)) return { year, season };
    if (season === "fall") {
      season = "spring";
    } else {
      year += 1;
      season = "fall";
    }
  }
  return null;
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

function packDisplaced(
  courses: PlanCourse[],
  displaced: PlanCourse[],
  statuses: Record<string, TermStatus>,
  vacated: { year: number; season: PlanSeason },
): { courses: PlanCourse[]; leftover: PlanCourse[]; moved: TermMove[] } {
  const next = courses.map((course) => ({ ...course }));
  const byId = new Map(next.map((course) => [course.id, course]));
  const after = termOrder(vacated.year, vacated.season);
  const candidates: { year: number; season: PlanSeason }[] = [];
  for (const year of planBoard(courses, statuses)) {
    for (const season of year.seasons) {
      if (getTermStatus(statuses, year.year, season) !== "regular") continue;
      if (year.year === vacated.year && season === vacated.season) continue;
      candidates.push({ year: year.year, season });
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
  const current = currentOrderFromCourses(courses);
  const residency = courses.some(isComp4900);
  if (status === "exchange" || status === "leave") {
    const locked = sitting.filter((course) => course.locked && !isComp4900(course));
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
    const displaced = sitting.filter((course) => !course.locked && !isComp4900(course));
    let nextCourses = courses
      .filter((course) => !(isComp4900(course) && course.year === year && course.season === season))
      .map((course) =>
        displaced.some((item) => item.id === course.id)
          ? { ...course, year: null, season: null, status: "open" as PlanStatus }
          : course,
      );
    const nextStatuses = { ...termStatuses, [termStatusKey(year, season)]: status };
    let packed = packDisplaced(nextCourses, displaced, nextStatuses, { year, season });
    nextCourses = packed.courses;
    const moved = [...packed.moved];
    let deferral: TermStatusResult["deferral"] = null;
    const added: { year: number; season: PlanSeason }[] = [];
    while (packed.leftover.length) {
      const extra = nextAddableTerm(nextCourses, nextStatuses);
      if (!extra) break;
      nextStatuses[termStatusKey(extra.year, extra.season)] = "regular";
      added.push(extra);
      packed = packDisplaced(nextCourses, packed.leftover, nextStatuses, { year, season });
      nextCourses = packed.courses;
      moved.push(...packed.moved);
    }
    if (added.length) {
      const still = packed.leftover.map((course) => course.code ?? course.label);
      const first = added[0];
      deferral = {
        needed: true,
        year: first.year,
        reason: `Remaining courses don't fit in years 1–4 after ${termLabel(year, season)} is ${status}. ${termLabel(first.year, first.season)}${added.length > 1 ? `–${termLabel(added[added.length - 1].year, added[added.length - 1].season)}` : ""} ${added.length === 1 ? "was" : "were"} added.${still.length ? ` Still unplaced: ${still.join(", ")}.` : ""}`,
      };
    }
    return {
      courses: ensureComp4900(nextCourses, nextStatuses, current, residency),
      termStatuses: nextStatuses,
      moved,
      deferral,
    };
  }
  const nextStatuses = { ...termStatuses, [termStatusKey(year, season)]: "regular" as TermStatus };
  return {
    courses: ensureComp4900(courses, nextStatuses, current, residency),
    termStatuses: nextStatuses,
    moved: [],
    deferral: null,
  };
}

export type TermEditResult = {
  courses: PlanCourse[];
  termStatuses: Record<string, TermStatus>;
  year: number;
  season: PlanSeason;
  error?: string;
};

function withResidency(
  courses: PlanCourse[],
  termStatuses: Record<string, TermStatus>,
): PlanCourse[] {
  return ensureComp4900(courses, termStatuses, currentOrderFromCourses(courses), courses.some(isComp4900));
}

export function addTerm(
  courses: PlanCourse[],
  termStatuses: Record<string, TermStatus>,
  year?: number,
  season?: PlanSeason,
): TermEditResult {
  const target =
    year != null && season
      ? { year, season }
      : nextAddableTerm(courses, termStatuses);
  if (!target) {
    return {
      courses,
      termStatuses,
      year: year ?? 0,
      season: season ?? "fall",
      error: `Can't add another semester past Year ${MAX_PLAN_YEAR}.`,
    };
  }
  if (target.season !== "fall" && target.season !== "spring") {
    return { courses, termStatuses, year: target.year, season: "fall", error: "Season must be fall or spring." };
  }
  if (target.year < 1 || target.year > MAX_PLAN_YEAR) {
    return {
      courses,
      termStatuses,
      year: target.year,
      season: target.season,
      error: `Year must be between 1 and ${MAX_PLAN_YEAR}.`,
    };
  }
  if (termVisible(target.year, target.season, courses, termStatuses)) {
    return {
      courses,
      termStatuses,
      year: target.year,
      season: target.season,
      error: `${termLabel(target.year, target.season)} is already on the plan.`,
    };
  }
  const nextStatuses = { ...termStatuses, [termStatusKey(target.year, target.season)]: "regular" as TermStatus };
  return {
    courses: withResidency(courses, nextStatuses),
    termStatuses: nextStatuses,
    year: target.year,
    season: target.season,
  };
}

export function canRemoveTerm(
  courses: PlanCourse[],
  year: number,
  season: PlanSeason,
): boolean {
  if (isBaseYear(year)) return false;
  return !termCourses(courses, year, season).some((course) => !isComp4900(course));
}

export function removeTerm(
  courses: PlanCourse[],
  termStatuses: Record<string, TermStatus>,
  year: number,
  season: PlanSeason,
): TermEditResult {
  if (isBaseYear(year)) {
    return {
      courses,
      termStatuses,
      year,
      season,
      error: `${termLabel(year, season)} is part of the four-year plan and can't be removed.`,
    };
  }
  if (!termVisible(year, season, courses, termStatuses)) {
    return { courses, termStatuses, year, season, error: `${termLabel(year, season)} isn't on the plan.` };
  }
  const occupying = termCourses(courses, year, season).filter((course) => !isComp4900(course));
  if (occupying.length) {
    const names = occupying
      .slice(0, 4)
      .map((course) => course.code ?? course.label)
      .join(", ");
    return {
      courses,
      termStatuses,
      year,
      season,
      error: `Move ${names} off ${termLabel(year, season)} before removing it.`,
    };
  }
  const nextCourses = courses.filter((course) => !(isComp4900(course) && course.year === year && course.season === season));
  const nextStatuses = { ...termStatuses };
  delete nextStatuses[termStatusKey(year, season)];
  return {
    courses: withResidency(nextCourses, nextStatuses),
    termStatuses: nextStatuses,
    year,
    season,
  };
}

export function snapshotFromPayload(payload: {
  courses?: PlanCourse[];
  term_statuses?: Record<string, TermStatus>;
}): { courses: PlanCourse[]; termStatuses: Record<string, TermStatus> } | null {
  if (!payload.courses) return null;
  return { courses: payload.courses, termStatuses: payload.term_statuses ?? {} };
}

const STATUS_RANK: Record<PlanStatus, number> = { done: 0, in_progress: 1, planned: 2, open: 3 };

export function termCourses(courses: PlanCourse[], year: number, season: PlanSeason): PlanCourse[] {
  return courses
    .filter((course) => course.year === year && course.season === season)
    .sort((a, b) => {
      const aRes = isComp4900(a) ? 1 : 0;
      const bRes = isComp4900(b) ? 1 : 0;
      if (aRes !== bRes) return aRes - bRes;
      const byStatus = STATUS_RANK[a.status] - STATUS_RANK[b.status];
      if (byStatus) return byStatus;
      return (a.code || a.label).localeCompare(b.code || b.label);
    });
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
