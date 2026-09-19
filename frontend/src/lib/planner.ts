import type { DegreeProfile } from "./types";

/** Shared demo planner that already has course history and sections in Supabase. */
export const DEMO_PLANNER_ID = "demo-student";

export function getPlannerId(): string {
  return DEMO_PLANNER_ID;
}

const PATHWAY_KEY = "ust-track:degree-pathway";

export function getDegreePathwayId(): string {
  return localStorage.getItem(PATHWAY_KEY) || DEMO_PLANNER_ID;
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
