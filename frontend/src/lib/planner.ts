const KEY = "ust-track:planner-id";

/** Browser-issued planner id — not an ITSC account, just a local identity for this browser. */
export function getPlannerId(): string {
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}
