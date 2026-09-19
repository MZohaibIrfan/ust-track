import { useState } from "react";
import { getTheme, setTheme, type Theme } from "../lib/theme";

export function ThemeToggle() {
  const [theme, setThemeState] = useState<Theme>(() => getTheme());

  function choose(next: Theme) {
    setTheme(next);
    setThemeState(next);
  }

  return (
    <div className="inline-flex rounded-md border border-line bg-bg p-0.5 text-[12px]">
      <button
        type="button"
        onClick={() => choose("light")}
        className={`rounded-[5px] px-2 py-0.5 transition-colors ${
          theme === "light" ? "bg-surface-raised font-medium text-ink" : "text-muted hover:text-ink"
        }`}
      >
        Light
      </button>
      <button
        type="button"
        onClick={() => choose("dark")}
        className={`rounded-[5px] px-2 py-0.5 transition-colors ${
          theme === "dark" ? "bg-surface-raised font-medium text-ink" : "text-muted hover:text-ink"
        }`}
      >
        Dark
      </button>
    </div>
  );
}
