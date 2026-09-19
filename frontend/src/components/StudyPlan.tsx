import { useMemo, useState } from "react";
import {
  PLAN_SEASONS,
  TERM_STATUSES,
  addTerm,
  canRemoveTerm,
  catalogTermLabel,
  getTermStatus,
  nextAddableTerm,
  planBoard,
  moveCourse,
  removeTerm,
  setCourseCode,
  setTermStatus,
  termCredits,
  termCourses,
  termLabel,
  trayCourses,
  type PlanCourse,
  type PlanSeason,
  type TermStatus,
} from "../lib/studyPlanMaker";
import type { StudyPathway } from "../lib/types";

const MARK: Record<PlanCourse["status"], string> = {
  done: "✓",
  in_progress: "·",
  planned: "·",
  open: "○",
};

const MARK_COLOR: Record<PlanCourse["status"], string> = {
  done: "text-accent",
  in_progress: "text-ink",
  planned: "text-ink",
  open: "text-muted",
};

function CourseCard({
  course,
  selected,
  onSelect,
  onPick,
}: {
  course: PlanCourse;
  selected: boolean;
  onSelect: () => void;
  onPick?: (code: string) => void;
}) {
  const title = course.code ?? course.label;
  const canPick = Boolean(onPick && course.options.length > 1 && !course.locked);
  return (
    <div
      draggable={!course.locked}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", course.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      onClick={(event) => event.stopPropagation()}
      className={`rounded-md border px-2 py-1.5 text-left text-[13px] ${
        selected ? "border-accent bg-accent-soft" : course.locked ? "border-line bg-fill" : "border-line bg-bg"
      } ${course.locked ? "cursor-default" : "cursor-grab"}`}
    >
      <button
        type="button"
        onClick={() => {
          if (course.locked) return;
          onSelect();
        }}
        className="flex w-full items-start gap-2 text-left"
      >
        <span className={`mt-0.5 w-3 shrink-0 font-mono text-[11px] ${MARK_COLOR[course.status]}`}>{MARK[course.status]}</span>
        <span className="min-w-0 flex-1">
          <span className={course.code ? "font-mono" : ""}>{title}</span>
          {course.code && course.label !== course.code ? (
            <span className="mt-0.5 block text-[11px] text-muted">{course.label}</span>
          ) : null}
        </span>
        <span className="flex shrink-0 items-center gap-1 font-mono text-[11px] text-muted tabular-nums">
          {course.locked ? (
            <span className="text-muted" title={course.status === "in_progress" ? "In progress — locked" : "Taken — locked"} aria-label="Locked">
              <svg viewBox="0 0 12 12" className="size-3" fill="none" aria-hidden="true">
                <rect x="2.25" y="5.5" width="7.5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
                <path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            </span>
          ) : null}
          {course.credits}
        </span>
      </button>
      {canPick ? (
        <div className="mt-1.5 flex flex-wrap gap-1 pl-5">
          {course.options.slice(0, 6).map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => onPick?.(code)}
              className={`rounded border px-1.5 py-0.5 font-mono text-[11px] ${
                course.code === code ? "border-ink text-ink" : "border-line text-muted hover:text-ink"
              }`}
            >
              {code}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TermBoard({
  year,
  season,
  label,
  catalogLabel,
  courses,
  status,
  selectedId,
  dropActive,
  removable,
  onSelect,
  onDrop,
  onPick,
  onStatus,
  onRemove,
}: {
  year: number;
  season: PlanSeason;
  label: string;
  catalogLabel?: string | null;
  courses: PlanCourse[];
  status: TermStatus;
  selectedId: string | null;
  dropActive: boolean;
  removable: boolean;
  onSelect: (id: string) => void;
  onDrop: (year: number, season: PlanSeason, id?: string) => void;
  onPick: (id: string, code: string) => void;
  onStatus: (status: TermStatus) => void;
  onRemove: () => void;
}) {
  const credits = termCredits(courses, year, season);
  const heavy = credits > 18;
  const away = status !== "regular";
  return (
    <div
      onDragOver={(event) => {
        if (away) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event) => {
        if (away) return;
        event.preventDefault();
        onDrop(year, season, event.dataTransfer.getData("text/plain") || undefined);
      }}
      onClick={() => {
        if (!away && selectedId) onDrop(year, season, selectedId);
      }}
      className={`min-h-36 rounded-md border p-2 ${
        away ? "border-page-degree/40 bg-page-degree/5" : dropActive ? "border-accent bg-accent-soft" : "border-line bg-surface-raised"
      }`}
    >
      <p className="mb-2 flex items-baseline justify-between gap-2 text-[11px] font-medium tracking-wide text-muted uppercase">
        <span>
          {label}
          {catalogLabel ? <span className="ml-1.5 font-normal normal-case tracking-normal">{catalogLabel}</span> : null}
        </span>
        <span className="flex items-center gap-2">
          <select
            value={status}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onStatus(event.target.value as TermStatus)}
            className="rounded-md border border-line bg-bg px-1 py-0.5 font-sans text-[11px] font-medium normal-case tracking-normal text-ink outline-none"
          >
            {TERM_STATUSES.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          {removable ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onRemove();
              }}
              className="font-sans text-[11px] font-medium normal-case tracking-normal text-muted hover:text-ink"
            >
              Remove
            </button>
          ) : null}
          <span className={`font-mono font-normal tabular-nums ${heavy ? "text-accent" : ""}`}>
            {away ? status : `${credits} cr`}
          </span>
        </span>
      </p>
      {away ? (
        <p className="px-1 py-4 text-center text-[12px] text-muted">
          {status === "exchange"
            ? "Exchange term — HKUST courses were moved off this semester."
            : "Leave — courses were moved off this semester."}
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {termCourses(courses, year, season).map((course) => (
            <CourseCard
              key={course.id}
              course={course}
              selected={selectedId === course.id}
              onSelect={() => onSelect(course.id)}
              onPick={(code) => onPick(course.id, code)}
            />
          ))}
          {termCourses(courses, year, season).length === 0 ? (
            <p className="px-1 py-4 text-center text-[12px] text-muted">Drop a course here, or select one and click this term.</p>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function StudyPlan({
  data,
  courses,
  termStatuses,
  variantId,
  onVariantId,
  onCourses,
  onTermStatuses,
  onReset,
  note,
  intakeYear,
}: {
  data: StudyPathway | null;
  courses: PlanCourse[];
  termStatuses: Record<string, TermStatus>;
  variantId: string;
  onVariantId: (id: string) => void;
  onCourses: (courses: PlanCourse[]) => void;
  onTermStatuses: (statuses: Record<string, TermStatus>) => void;
  onReset: () => void;
  note?: string | null;
  intakeYear?: number | null;
}) {
  const variants = data?.variants ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [localNote, setLocalNote] = useState<string | null>(null);
  const variant = variants.find((item) => item.id === variantId) ?? variants[0];
  const tray = useMemo(() => trayCourses(courses), [courses]);
  const years = planBoard(courses, termStatuses).map((item) => ({
    ...item,
    current: Boolean(variant?.years.find((year) => year.year === item.year)?.current),
  }));
  const extra = nextAddableTerm(courses, termStatuses);
  const banner = note ?? localNote;

  function place(year: number | null, season: PlanSeason | null, id?: string | null) {
    const target = id || selectedId;
    if (!target) return;
    if (year != null && season && getTermStatus(termStatuses, year, season) !== "regular") return;
    onCourses(moveCourse(courses, target, year, season));
    setSelectedId(null);
    setDragging(false);
  }

  function changeStatus(year: number, season: PlanSeason, status: TermStatus) {
    const result = setTermStatus(courses, termStatuses, year, season, status);
    if (result.error) {
      setLocalNote(result.error);
      return;
    }
    onCourses(result.courses);
    onTermStatuses(result.termStatuses);
    setLocalNote(result.deferral?.reason ?? (result.moved.length ? `Moved ${result.moved.length} course${result.moved.length === 1 ? "" : "s"} off ${termLabel(year, season)}.` : null));
  }

  function addSemester() {
    const result = addTerm(courses, termStatuses);
    if (result.error) {
      setLocalNote(result.error);
      return;
    }
    onCourses(result.courses);
    onTermStatuses(result.termStatuses);
    setLocalNote(`Added ${termLabel(result.year, result.season)}.`);
  }

  function removeSemester(year: number, season: PlanSeason) {
    const result = removeTerm(courses, termStatuses, year, season);
    if (result.error) {
      setLocalNote(result.error);
      return;
    }
    onCourses(result.courses);
    onTermStatuses(result.termStatuses);
    setLocalNote(`Removed ${termLabel(year, season)}.`);
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-end gap-x-4 border-b border-line px-3">
        {(variants.length ? variants : [{ id: "custom", label: "My plan" }]).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onVariantId(item.id)}
            className={`-mb-px border-b-2 py-2 text-[13px] ${
              variantId === item.id ? "border-ink font-medium text-ink" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {item.label}
          </button>
        ))}
        <button type="button" onClick={onReset} className="ml-auto py-2 text-[12px] text-muted hover:text-ink">
          Reset to official
        </button>
      </div>

      {data?.year_note || data?.suggest_reason || banner ? (
        <div className="border-b border-line px-4 py-2 text-[12px] text-muted">
          {data?.suggest_reason ? <p>{data.suggest_reason}</p> : null}
          {data?.year_note ? <p className={data.suggest_reason ? "mt-0.5" : ""}>{data.year_note}</p> : null}
          {banner ? <p className={data?.suggest_reason || data?.year_note ? "mt-0.5 text-page-degree" : "text-page-degree"}>{banner}</p> : null}
        </div>
      ) : null}

      <div
        className="border-b border-line bg-fill px-3 py-2"
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }}
        onDrop={(event) => {
          event.preventDefault();
          const id = event.dataTransfer.getData("text/plain") || selectedId;
          place(null, null, id);
        }}
      >
        <p className="mb-1.5 text-[11px] font-medium tracking-wide text-muted uppercase">Unplaced</p>
        {tray.length > 0 ? (
          <div className="flex flex-col gap-1.5 sm:grid sm:grid-cols-2">
            {tray.map((course) => (
              <CourseCard
                key={course.id}
                course={course}
                selected={selectedId === course.id}
                onSelect={() => setSelectedId((current) => (current === course.id ? null : course.id))}
                onPick={(code) => onCourses(setCourseCode(courses, course.id, code))}
              />
            ))}
          </div>
        ) : (
          <p className="text-[12px] text-muted">Every open course is on a term. Drag one back here to unplace it.</p>
        )}
        <p className="mt-2 text-[11px] text-muted">
          {selectedId ? "Click a regular term to place the selected course, or drag it." : "Select or drag a course onto a term. Mark a semester Exchange or Leave to clear it. Add a semester if you need a fifth year."}
        </p>
      </div>

      <div
        className="@container flex flex-col gap-5 p-4"
        onDragStart={() => setDragging(true)}
        onDragEnd={() => setDragging(false)}
      >
        {years.map((year) => (
          <section key={year.year}>
            <h3 className="mb-2 text-[13px] font-medium">
              {year.label}
              {year.current ? <span className="ml-1.5 text-[11px] font-normal text-muted">now</span> : null}
            </h3>
            <div className="grid grid-cols-1 gap-3 @min-[32rem]:grid-cols-2">
              {year.seasons.map((season) => (
                <TermBoard
                  key={season}
                  year={year.year}
                  season={season}
                  label={PLAN_SEASONS.find((item) => item.id === season)?.label ?? season}
                  catalogLabel={catalogTermLabel(intakeYear, year.year, season)}
                  courses={courses}
                  status={getTermStatus(termStatuses, year.year, season)}
                  selectedId={selectedId}
                  dropActive={dragging || Boolean(selectedId)}
                  removable={canRemoveTerm(courses, year.year, season)}
                  onSelect={(id) => setSelectedId((current) => (current === id ? null : id))}
                  onDrop={(nextYear, nextSeason, id) => place(nextYear, nextSeason, id)}
                  onPick={(id, code) => onCourses(setCourseCode(courses, id, code))}
                  onStatus={(status) => changeStatus(year.year, season, status)}
                  onRemove={() => removeSemester(year.year, season)}
                />
              ))}
            </div>
          </section>
        ))}
        {extra ? (
          <button
            type="button"
            onClick={addSemester}
            className="rounded-md border border-dashed border-line px-3 py-2 text-left text-[13px] text-muted hover:border-ink hover:text-ink"
          >
            Add {termLabel(extra.year, extra.season)}
          </button>
        ) : null}
      </div>

      <div className="border-t border-line px-4 py-2.5 text-[11px] leading-4 text-muted">
        {(variant?.notes ?? []).map((noteText) => (
          <p key={noteText}>{noteText}</p>
        ))}
        {(data?.notes ?? []).map((noteText) => (
          <p key={noteText}>{noteText}</p>
        ))}
        {data?.source_url ? (
          <p className="mt-1">
            <a href={data.source_url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              {data.source_label ?? "Source"}
            </a>
          </p>
        ) : (
          <p>Draft stays on this device. Taken and in-progress courses stay locked. Exchange and leave terms cannot take HKUST courses.</p>
        )}
      </div>
    </div>
  );
}
