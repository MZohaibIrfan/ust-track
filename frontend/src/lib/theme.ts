export type Theme = "light" | "dark";

const KEY = "ust-theme";

export function getTheme(): Theme {
  if (typeof document === "undefined") return "light";
  const attr = document.documentElement.dataset.theme;
  if (attr === "dark" || attr === "light") return attr;
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    // private mode
  }
  return "light";
}

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // private mode
  }
}
