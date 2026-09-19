import type { RequirementGroupProgress, RequirementItemProgress, RequirementProgress } from "./types";

export type SharedCourse = {
  code: string;
  title: string | null;
  status: RequirementItemProgress["status"];
  programs: string[];
};

const STATUS_RANK: Record<string, number> = {
  done: 3,
  in_progress: 2,
  missing: 1,
  excluded: 0,
  info: 0,
};

function walkItems(group: RequirementGroupProgress, visit: (item: RequirementItemProgress) => void) {
  for (const item of group.items) visit(item);
  for (const child of group.children) walkItems(child, visit);
}

export function collectProgramCourses(progress: RequirementProgress): Map<string, RequirementItemProgress> {
  const byCode = new Map<string, RequirementItemProgress>();
  const visit = (item: RequirementItemProgress) => {
    const code = item.course_code;
    if (!code) return;
    const prev = byCode.get(code);
    if (!prev || (STATUS_RANK[item.status] ?? 0) > (STATUS_RANK[prev.status] ?? 0)) {
      byCode.set(code, item);
    }
  };
  for (const group of progress.requirements) walkItems(group, visit);
  return byCode;
}

/** course_code → every declared program that lists it. */
export function doubleCountMap(programs: RequirementProgress[]): Record<string, string[]> {
  const byCode: Record<string, Set<string>> = {};
  for (const program of programs) {
    for (const code of collectProgramCourses(program).keys()) {
      (byCode[code] ??= new Set()).add(program.code);
    }
  }
  const out: Record<string, string[]> = {};
  for (const [code, listed] of Object.entries(byCode)) {
    if (listed.size > 1) out[code] = [...listed].sort();
  }
  return out;
}

export function sharedCourses(programs: RequirementProgress[]): SharedCourse[] {
  const map = doubleCountMap(programs);
  const labels = new Map(programs.map((program) => [program.code, program.code]));
  const out: SharedCourse[] = [];
  for (const [code, listed] of Object.entries(map)) {
    let title: string | null = null;
    let status: RequirementItemProgress["status"] = "missing";
    for (const program of programs) {
      const item = collectProgramCourses(program).get(code);
      if (!item) continue;
      if (!title && item.note) title = item.note;
      if ((STATUS_RANK[item.status] ?? 0) > (STATUS_RANK[status] ?? 0)) status = item.status;
    }
    if (status !== "done") continue;
    out.push({
      code,
      title,
      status,
      programs: listed.map((item) => labels.get(item) ?? item),
    });
  }
  out.sort((a, b) => (STATUS_RANK[b.status] ?? 0) - (STATUS_RANK[a.status] ?? 0) || a.code.localeCompare(b.code));
  return out;
}
