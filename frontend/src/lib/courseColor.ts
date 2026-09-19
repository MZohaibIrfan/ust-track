/** Distinct hues that stay readable as calendar fills in light and dark. */
const HUES = [234, 172, 199, 350, 262, 145, 18, 292, 210, 40, 320, 95];

function hashCode(code: string): number {
  let hash = 0;
  const key = code.trim().toUpperCase();
  for (let i = 0; i < key.length; i++) {
    hash = Math.imul(31, hash) + key.charCodeAt(i);
  }
  return Math.abs(hash);
}

export function courseHue(code: string): number {
  return HUES[hashCode(code) % HUES.length];
}

/** Prefer the hashed hue, then walk the palette so courses on the same plan do not collide. */
export function courseHues(codes: Iterable<string>): Map<string, number> {
  return withCourseHues(new Map(), codes);
}

/** Assign hues for extra codes without moving ones already on the map. */
export function withCourseHues(base: Map<string, number>, codes: Iterable<string>): Map<string, number> {
  const map = new Map(base);
  const used = new Set<number>();
  for (const hue of map.values()) {
    const slot = HUES.indexOf(hue);
    if (slot >= 0) used.add(slot);
  }
  const unique = [...new Set([...codes].map((code) => code.trim().toUpperCase()).filter(Boolean))].sort();
  for (const code of unique) {
    if (map.has(code)) continue;
    let slot = hashCode(code) % HUES.length;
    for (let i = 0; i < HUES.length && used.has(slot); i++) {
      slot = (slot + 1) % HUES.length;
    }
    used.add(slot);
    map.set(code, HUES[slot]);
  }
  return map;
}
