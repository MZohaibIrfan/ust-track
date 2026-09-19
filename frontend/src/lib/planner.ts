/** Shared demo planner that already has course history and sections in Supabase. */
export const DEMO_PLANNER_ID = "demo-student";

/** Identity used for plan/degree fetches — the catalog lives in Supabase. */
export function getPlannerId(): string {
  return DEMO_PLANNER_ID;
}
