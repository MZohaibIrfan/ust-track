import { useMemo, useState } from "react";
import { useCollapsed } from "../lib/collapse";
import { CATEGORIES, categoryColorClasses, categoryFor, roleFor } from "../lib/programCategories";
import type { CatalogProgram, DeclaredProgram } from "../lib/types";
import { CollapseButton } from "./CollapseButton";

export { roleFor };

export function ProgramsPanel({
  programs,
  declared,
  selected,
  onSelect,
  onClose,
}: {
  programs: CatalogProgram[];
  declared: DeclaredProgram[];
  selected: string | null;
  onSelect: (code: string) => void;
  onClose?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useCollapsed("ust-track:programs-collapsed");
  const drawer = Boolean(onClose);
  const hideBody = !drawer && collapsed;
  const declaredCodes = useMemo(
    () => new Set(declared.map((d) => d.code).filter((code): code is string => !!code)),
    [declared],
  );

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = programs.filter((program) => {
      if (!program.has_requirements) return false;
      if (!q) return true;
      const category = categoryFor(program);
      const categoryLabel =
        CATEGORIES.find((item) => item.id === category)?.label.toLowerCase() ?? category.replaceAll("_", " ");
      return (
        program.code.toLowerCase().includes(q) ||
        program.name.toLowerCase().includes(q) ||
        category === q ||
        categoryLabel.includes(q)
      );
    });
    const byCategory = new Map<string, CatalogProgram[]>();
    for (const program of filtered) {
      const key = categoryFor(program);
      const list = byCategory.get(key) ?? [];
      list.push(program);
      byCategory.set(key, list);
    }
    for (const list of byCategory.values()) {
      list.sort((a, b) => a.code.localeCompare(b.code));
    }
    const known = CATEGORIES.map((category) => ({
      ...category,
      programs: byCategory.get(category.id) ?? [],
    }));
    const extra = [...byCategory.entries()]
      .filter(([id]) => !CATEGORIES.some((category) => category.id === id))
      .map(([id, list]) => ({
        id,
        label: id.replaceAll("_", " "),
        programs: list,
      }));
    return [...known, ...extra].filter((group) => group.programs.length > 0);
  }, [programs, query]);

  const visibleCount = grouped.reduce((sum, group) => sum + group.programs.length, 0);

  return (
    <section
      className={`flex min-h-0 shrink-0 flex-col overflow-hidden bg-surface-raised transition-[width,height] duration-200 ease-in-out ${
        drawer
          ? "h-full w-full"
          : `rounded-2xl border border-line shadow-soft ${hideBody ? "h-9 lg:h-auto lg:w-9" : "h-56 lg:h-auto lg:w-64"}`
      }`}
    >
      <header
        className={`flex shrink-0 items-center gap-2 border-b border-line py-2.5 ${
          hideBody ? "justify-center px-0" : "px-3"
        }`}
      >
        {hideBody ? null : (
          <h2 className="min-w-0 truncate text-[13px] font-semibold">{drawer ? "Browse catalog" : "Programs"}</h2>
        )}
        {hideBody ? null : (
          <span className="ml-auto rounded-full bg-fill px-1.5 py-0.5 font-mono text-[11px] text-muted">
            {visibleCount}
          </span>
        )}
        {drawer ? (
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-1.5 py-0.5 text-[12px] text-muted hover:bg-fill hover:text-ink"
          >
            Close
          </button>
        ) : (
          <CollapseButton
            collapsed={collapsed}
            onClick={() => setCollapsed(!collapsed)}
            side="left"
            label={collapsed ? "Expand programs" : "Collapse programs"}
          />
        )}
      </header>
      <div
        className={`flex min-h-0 flex-1 flex-col overflow-hidden transition-opacity duration-150 ${
          hideBody ? "pointer-events-none opacity-0 lg:w-64" : drawer ? "opacity-100" : "opacity-100 lg:w-64"
        }`}
      >
        <div className="shrink-0 border-b border-line p-2.5">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search major or minor…"
            className="w-full rounded-xl border border-line bg-bg px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
        {grouped.length === 0 ? (
          <p className="px-1 text-[12px] text-muted">No programs match that search.</p>
        ) : (
          <div className="flex flex-col gap-3.5">
            {grouped.map((group) => {
              const colors = categoryColorClasses(group.id);
              return (
                <div key={group.id}>
                  <p className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] font-medium tracking-wide text-muted uppercase">
                    <span className={`h-1.5 w-1.5 rounded-full ${colors.dot}`} />
                    {group.label}
                    <span className="ml-0.5 font-mono font-normal tabular-nums">{group.programs.length}</span>
                  </p>
                  <ul className="flex flex-col gap-1">
                    {group.programs.map((program) => {
                      const active = selected === program.code;
                      const isDeclared = declaredCodes.has(program.code);
                      return (
                        <li key={program.code}>
                          <button
                            type="button"
                            onClick={() => onSelect(program.code)}
                            className={`flex w-full items-start justify-between gap-2 rounded-xl border px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                              active
                                ? `${colors.border} ${colors.bg}`
                                : "border-transparent bg-bg hover:bg-fill"
                            }`}
                          >
                            <span className="min-w-0">
                              <span className="block font-mono text-[12px]">{program.code}</span>
                              <span className="mt-0.5 block truncate text-[12px] text-muted">{program.name}</span>
                            </span>
                            {isDeclared ? (
                              <span className={`shrink-0 text-[11px] font-medium ${colors.text}`}>Declared</span>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
        </div>
      </div>
    </section>
  );
}
