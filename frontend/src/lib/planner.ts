import type { DegreeProfile } from "./types";

/** Shared demo planner that already has course history and sections in Supabase — only
 * used as a last-resort fallback before a real session has set the planner id below. */
export const DEMO_PLANNER_ID = "demo-student";

const PLANNER_ID_KEY = "ust-track:planner-id";

/** The logged-in user's planner id. Set by the auth provider on login/signup/session
 * restore, cleared on logout. Falls back to the shared demo planner only pre-auth. */
export function getPlannerId(): string {
  return localStorage.getItem(PLANNER_ID_KEY) || DEMO_PLANNER_ID;
}

export function setPlannerId(id: string) {
  localStorage.setItem(PLANNER_ID_KEY, id);
}

export function clearPlannerId() {
  localStorage.removeItem(PLANNER_ID_KEY);
}

const PATHWAY_KEY = "ust-track:degree-pathway";

export function getDegreePathwayId(): string {
  return localStorage.getItem(PATHWAY_KEY) || getPlannerId();
}

export function setDegreePathwayId(id: string) {
  localStorage.setItem(PATHWAY_KEY, id);
}

export function studentHeading(profile: DegreeProfile | null): { title: string; detail: string } | null {
  if (!profile?.declared_programs.length) return null;
  const major =
    profile.declared_programs.find((d) => d.role === "major") ?? profile.declared_programs[0];
  if (!major.code) return null;
  const extras = profile.declared_programs
    .filter((d) => d.role !== "major" && d.code)
    .map((d) => d.code);
  const year = profile.standing_year ? `Year ${profile.standing_year}` : null;
  const title = [year, [major.code, ...extras].join(" + ")].filter(Boolean).join(" · ");
  const bits = [
    major.name,
    major.intake_year != null ? `intake ${major.intake_year}` : null,
    profile.catalog_year ? `catalog ${profile.catalog_year}` : null,
  ].filter(Boolean);
  return { title, detail: bits.join(" · ") };
}
