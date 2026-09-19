import { useEffect, useState } from "react";

function readCollapsed(key: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(key);
    if (stored === "1") return true;
    if (stored === "0") return false;
  } catch {
    // private mode
  }
  return fallback;
}

/** Persisted collapse/expand state for a side panel, keyed by localStorage key. */
export function useCollapsed(key: string, fallback = false): [boolean, (next: boolean) => void] {
  const [collapsed, setCollapsed] = useState(() => readCollapsed(key, fallback));

  useEffect(() => {
    try {
      localStorage.setItem(key, collapsed ? "1" : "0");
    } catch {
      // private mode
    }
  }, [key, collapsed]);

  return [collapsed, setCollapsed];
}
