import { Link } from "react-router-dom";
import type { CourseSuggestion, ExchangeOption } from "../lib/degreeDashboard";

type ProgramBar = {
  code: string;
  name: string;
  role: string;
  done: number;
  total: number;
  pct: number;
};

export function DegreeDashboard({
  title,
  detail,
  programs,
  selectedCode,
  onSelect,
  suggestions,
  exchanges,
}: {
  title: string;
  detail: string;
  programs: ProgramBar[];
  selectedCode: string | null;
  onSelect: (code: string) => void;
  suggestions: CourseSuggestion[];
  exchanges: ExchangeOption[];
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-line p-3">
      <div>
        <p className="text-[15px] font-semibold tracking-tight">{title}</p>
        {detail ? <p className="mt-0.5 text-[12px] text-muted">{detail}</p> : null}
      </div>

      {programs.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {programs.map((program) => {
            const active = selectedCode === program.code;
            return (
              <button
                key={program.code}
                type="button"
                onClick={() => onSelect(program.code)}
                className={`rounded-md border px-3 py-2 text-left ${
                  active ? "border-accent bg-accent-soft" : "border-line bg-surface-raised hover:bg-fill"
                }`}
              >
                <p className="text-[13px] font-medium">
                  <span className="font-mono">{program.code}</span>
                  <span className="ml-1.5 text-[12px] font-normal text-muted">{program.role.replaceAll("_", " ")}</span>
                </p>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-fill">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${program.pct}%` }} />
                </div>
                <p className="mt-1 font-mono text-[11px] text-muted">
                  {program.done} of {program.total} · {program.pct}%
                </p>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="rounded-md border border-line bg-surface-raised px-3 py-2 text-[13px] text-muted">
          No program declared yet. Browse the catalog to add one.
        </p>
      )}

      <div className="grid gap-2 lg:grid-cols-2">
        <section className="rounded-md border border-line bg-surface-raised p-3">
          <p className="text-[11px] font-medium tracking-wide text-muted uppercase">Course suggestions</p>
          {suggestions.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-2">
              {suggestions.map((item) => (
                <li key={item.id} className="text-[13px]">
                  <p className="font-medium">{item.codes.length ? <span className="font-mono">{item.title}</span> : item.title}</p>
                  <p className="mt-0.5 text-[12px] text-muted">{item.reason}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[13px] text-muted">Nothing obvious left in the open requirements.</p>
          )}
          <Link to="/timetable" className="mt-2 inline-block text-[12px] font-medium text-accent hover:underline">
            Open timetable →
          </Link>
        </section>

        <section className="rounded-md border border-line bg-surface-raised p-3">
          <p className="text-[11px] font-medium tracking-wide text-muted uppercase">Exchange options</p>
          <ul className="mt-2 flex flex-col gap-2">
            {exchanges.map((item) => (
              <li key={item.id} className="text-[13px]">
                <p className="font-medium">
                  {item.school}
                  <span className="ml-1.5 text-[12px] font-normal text-muted">
                    {item.city} · {item.term}
                  </span>
                </p>
                <p className="mt-0.5 text-[12px] text-muted">{item.fit}</p>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-muted">Confirm partners and credit transfer with SENG / OIA before you apply.</p>
        </section>
      </div>
    </div>
  );
}

export type { ProgramBar };
