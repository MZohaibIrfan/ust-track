import type { DegreeProfile } from "./types";

export type DemoProfile = {
  id: string;
  name: string;
  initials: string;
  label: string;
  school: string;
};

export const DEMO_PROFILES: DemoProfile[] = [
  {
    id: "demo-y4-comp",
    name: "Faustina",
    initials: "F",
    label: "Year 4 · COMP + minor",
    school: "School of Engineering",
  },
  {
    id: "demo-y2-cosc",
    name: "Angle",
    initials: "A",
    label: "Year 2 · COSC + ELEC",
    school: "School of Engineering",
  },
  {
    id: "demo-y3-cosc",
    name: "Fangle",
    initials: "Fg",
    label: "Year 3 · COSC + ELEC + BIEN",
    school: "School of Engineering",
  },
  {
    id: "demo-y1-seng",
    name: "Zozo",
    initials: "Z",
    label: "Year 1 · SENG undeclared",
    school: "School of Engineering",
  },
];

/** Shared demo planner that already has course history and sections in Supabase — only
 * used as a last-resort fallback before a real session has set the planner id below. */
export const DEMO_PLANNER_ID = "demo-student";

const PLANNER_ID_KEY = "ust-track:planner-id";
const PATHWAY_KEY = "ust-track:degree-pathway";

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // private mode / tests
  }
}

export function getDemoProfile(id: string): DemoProfile | undefined {
  return DEMO_PROFILES.find((profile) => profile.id === id);
}

/** The logged-in user's planner id. Set by the auth provider on login/signup/session
 * restore, cleared on logout. Falls back to the shared demo planner only pre-auth. */
export function getPlannerId(): string {
  return readStorage(PLANNER_ID_KEY) || DEMO_PLANNER_ID;
}

export function setPlannerId(id: string) {
  writeStorage(PLANNER_ID_KEY, id);
}

export function clearPlannerId() {
  try {
    localStorage.removeItem(PLANNER_ID_KEY);
  } catch {
    // private mode / tests
  }
}

export function pathwayRoot(plannerId: string): string {
  return plannerId.split("::", 1)[0];
}

export function getDegreePathwayId(homeId = getPlannerId()): string {
  const stored = readStorage(`${PATHWAY_KEY}:${homeId}`);
  if (stored && (stored === homeId || stored.startsWith(`${homeId}::`))) return stored;
  return homeId;
}

export function setDegreePathwayId(id: string) {
  writeStorage(`${PATHWAY_KEY}:${pathwayRoot(id)}`, id);
}

export function studentHeading(profile: DegreeProfile | null): { title: string; detail: string } | null {
  if (!profile) return null;
  const demo = getDemoProfile(profile.planner_id);
  const declared = profile.declared_programs.filter((d) => d.code);
  if (declared.length === 0) {
    const year = profile.standing_year ? `Year ${profile.standing_year}` : null;
    return {
      title: demo?.label ?? ([year, "Undeclared"].filter(Boolean).join(" · ") || "Undeclared"),
      detail: demo?.name ?? (profile.catalog_year ? `catalog ${profile.catalog_year}` : ""),
    };
  }
  const major = declared.find((d) => d.role === "major") ?? declared[0];
  if (!major.code) return null;
  const extras = declared.filter((d) => d.role !== "major" && d.code).map((d) => d.code);
  const year = profile.standing_year ? `Year ${profile.standing_year}` : null;
  const title = [year, [major.code, ...extras].join(" + ")].filter(Boolean).join(" · ");
  const bits = [
    major.name,
    major.intake_year != null ? `intake ${major.intake_year}` : null,
    profile.catalog_year ? `catalog ${profile.catalog_year}` : null,
  ].filter(Boolean);
  return { title, detail: bits.join(" · ") };
}
