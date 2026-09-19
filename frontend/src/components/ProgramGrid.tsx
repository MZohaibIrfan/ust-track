import { useMemo, useState } from "react";
import { CATEGORIES, categoryColorClasses, categoryFor } from "../lib/programCategories";
import type { CatalogProgram, DeclaredProgram } from "../lib/types";

function FilterPill({
  label,
  active,
  dotClass,
  onClick,
}: {
  label: string;
  active: boolean;
  dotClass?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-all ${
        active
          ? "border-transparent bg-ink text-bg shadow-soft"
          : "border-line bg-surface-raised text-muted hover:border-ink/20 hover:text-ink"
      }`}
    >
      {dotClass ? <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} /> : null}
      {label}
    </button>
  );
}

export function ProgramGrid({
  programs,
  declared,
  selected,
  onSelect,
}: {
  programs: CatalogProgram[];
  declared: DeclaredProgram[];
  selected: string | null;
  onSelect: (code: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");

  const declaredCodes = useMemo(
    () => new Set(declared.map((d) => d.code).filter((code): code is string => !!code)),
    [declared],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return programs.filter((p) => {
      if (!p.has_requirements) return false;
      if (category !== "all" && categoryFor(p) !== category) return false;
      if (!q) return true;
      return p.code.toLowerCase().includes(q) || p.name.toLowerCase().includes(q);
    });
  }, [programs, query, category]);

  return (
    <div className="flex flex-col gap-3">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search major, minor, extended major…"
        className="w-full rounded-xl border border-line bg-surface-raised px-3.5 py-2.5 text-[13px] shadow-soft outline-none transition-shadow focus:border-accent focus:shadow-soft-lg"
      />

      <div className="flex flex-wrap gap-1.5">
        <FilterPill label="All" active={category === "all"} onClick={() => setCategory("all")} />
        {CATEGORIES.map((c) => (
          <FilterPill
            key={c.id}
            label={c.label}
            active={category === c.id}
            dotClass={categoryColorClasses(c.id).dot}
            onClick={() => setCategory(c.id)}
          />
        ))}
      </div>

      <div className="grid max-h-[24rem] grid-cols-1 gap-2.5 overflow-y-auto p-0.5 pr-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.length === 0 ? (
          <p className="col-span-full py-8 text-center text-[13px] text-muted">No programs match that search.</p>
        ) : (
          filtered.map((program) => {
            const active = selected === program.code;
            const isDeclared = declaredCodes.has(program.code);
            const colors = categoryColorClasses(categoryFor(program));
            return (
              <button
                key={program.code}
                type="button"
                onClick={() => onSelect(program.code)}
                className={`group relative flex flex-col items-start gap-1.5 overflow-hidden rounded-2xl border p-3.5 pl-4 text-left transition-all ${
                  active
                    ? `${colors.border} ${colors.bg} shadow-soft-lg`
                    : "border-line bg-surface-raised shadow-soft hover:-translate-y-0.5 hover:shadow-soft-lg"
                }`}
              >
                <span className={`absolute inset-y-0 left-0 w-1 ${colors.dot}`} />
                <div className="flex w-full items-center justify-between gap-2">
                  <span className={`rounded-full px-2 py-0.5 font-mono text-[11px] font-medium ${colors.bg} ${colors.text}`}>
                    {program.code}
                  </span>
                  {isDeclared ? (
                    <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent">
                      Declared
                    </span>
                  ) : null}
                </div>
                <p className="text-[13px] leading-5 font-medium text-ink">{program.name}</p>
                <p className="text-[11px] text-muted">{program.school}</p>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
