import { useEffect, useMemo, useRef, useState } from "react";
import {
  PLAN_SEASONS,
  emptyYears,
  loadDraft,
  moveCourse,
  reconcileDraft,
  saveDraft,
  seedFromPathway,
  setCourseCode,
  suggestedVariant,
  termCredits,
  termCourses,
  trayCourses,
  type PlanCourse,
  type PlanSeason,
} from "../lib/studyPlanMaker";
import type { RequirementProgress, StudyPathway } from "../lib/types";

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
        selected ? "border-accent bg-accent-soft" : "border-line bg-bg"
      } ${course.locked ? "cursor-default" : "cursor-grab"}`}
    >
      <button type="button" onClick={onSelect} className="flex w-full items-start gap-2 text-left">
        <span className={`mt-0.5 w-3 shrink-0 font-mono text-[11px] ${MARK_COLOR[course.status]}`}>{MARK[course.status]}</span>
        <span className="min-w-0 flex-1">
          <span className={course.code ? "font-mono" : ""}>{title}</span>
          {course.code && course.label !== course.code ? (
            <span className="mt-0.5 block text-[11px] text-muted">{course.label}</span>
          ) : null}
        </span>
        <span className="shrink-0 font-mono text-[11px] text-muted tabular-nums">{course.credits}</span>
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
  courses,
  selectedId,
  dropActive,
  onSelect,
  onDrop,
  onPick,
}: {
  year: number;
  season: PlanSeason;
  label: string;
  courses: PlanCourse[];
  selectedId: string | null;
  dropActive: boolean;
  onSelect: (id: string) => void;
  onDrop: (year: number, season: PlanSeason, id?: string) => void;
  onPick: (id: string, code: string) => void;
}) {
  const credits = termCredits(courses, year, season);
  const heavy = credits > 18;
  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop(year, season, event.dataTransfer.getData("text/plain") || undefined);
      }}
      onClick={() => {
        if (selectedId) onDrop(year, season, selectedId);
      }}
      className={`min-h-36 rounded-md border p-2 ${
        dropActive ? "border-accent bg-accent-soft" : "border-line bg-surface-raised"
      }`}
    >
      <p className="mb-2 flex items-baseline justify-between text-[11px] font-medium tracking-wide text-muted uppercase">
        <span>{label}</span>
        <span className={`font-mono font-normal tabular-nums ${heavy ? "text-accent" : ""}`}>{credits} cr</span>
      </p>
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
    </div>
  );
}

export function StudyPlan({
  data,
  progress,
  plannerId,
}: {
  data: StudyPathway | null;
  progress: RequirementProgress | null;
  plannerId: string;
}) {
  const variants = data?.variants ?? [];
  const programCode = data?.program_code ?? progress?.code ?? "PLAN";
  const [variantId, setVariantId] = useState(suggestedVariant(data));
  const [courses, setCourses] = useState<PlanCourse[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const skipSave = useRef(true);

  const variant = variants.find((item) => item.id === variantId) ?? variants[0];

  useEffect(() => {
    setVariantId(suggestedVariant(data));
  }, [data?.suggested_variant, data?.program_code]);

  useEffect(() => {
    const saved = loadDraft(plannerId, programCode, variantId);
    const seeded = saved?.courses ?? seedFromPathway(variant, progress);
    skipSave.current = true;
    setCourses(reconcileDraft(seeded, progress));
    setSelectedId(null);
    // seed once per planner / program / variant
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plannerId, programCode, variantId, data?.program_code]);

  useEffect(() => {
    if (!progress) return;
    setCourses((current) => (current.length ? reconcileDraft(current, progress) : current));
  }, [progress]);

  useEffect(() => {
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    if (courses.length === 0) return;
    saveDraft(plannerId, programCode, variantId, courses);
  }, [courses, plannerId, programCode, variantId]);

  const tray = useMemo(() => trayCourses(courses), [courses]);
  const years = variant?.years.map((year) => ({ year: year.year, label: year.label, current: year.current })) ?? emptyYears().map((year) => ({ ...year, current: false }));

  function place(year: number | null, season: PlanSeason | null, id?: string | null) {
    const target = id || selectedId;
    if (!target) return;
    setCourses((current) => moveCourse(current, target, year, season));
    setSelectedId(null);
    setDragging(false);
  }

  function resetOfficial() {
    setCourses(seedFromPathway(variant, progress));
    setSelectedId(null);
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-end gap-x-4 border-b border-line px-3">
        {(variants.length ? variants : [{ id: "custom", label: "My plan" }]).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setVariantId(item.id)}
            className={`-mb-px border-b-2 py-2 text-[13px] ${
              variantId === item.id ? "border-ink font-medium text-ink" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {item.label}
          </button>
        ))}
        <button type="button" onClick={resetOfficial} className="ml-auto py-2 text-[12px] text-muted hover:text-ink">
          Reset to official
        </button>
      </div>

      {data?.year_note || data?.suggest_reason ? (
        <div className="border-b border-line px-4 py-2 text-[12px] text-muted">
          {data.suggest_reason ? <p>{data.suggest_reason}</p> : null}
          {data.year_note ? <p className={data.suggest_reason ? "mt-0.5" : ""}>{data.year_note}</p> : null}
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
                onPick={(code) => setCourses((current) => setCourseCode(current, course.id, code))}
              />
            ))}
          </div>
        ) : (
          <p className="text-[12px] text-muted">Every open course is on a term. Drag one back here to unplace it.</p>
        )}
        <p className="mt-2 text-[11px] text-muted">
          {selectedId ? "Click a term to place the selected course, or drag it." : "Select or drag a course onto a term."}
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
              {PLAN_SEASONS.map((season) => (
                <TermBoard
                  key={season.id}
                  year={year.year}
                  season={season.id}
                  label={season.label}
                  courses={courses}
                  selectedId={selectedId}
                  dropActive={dragging || Boolean(selectedId)}
                  onSelect={(id) => setSelectedId((current) => (current === id ? null : id))}
                  onDrop={(nextYear, nextSeason, id) => place(nextYear, nextSeason, id)}
                  onPick={(id, code) => setCourses((current) => setCourseCode(current, id, code))}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="border-t border-line px-4 py-2.5 text-[11px] leading-4 text-muted">
        {(variant?.notes ?? []).map((note) => (
          <p key={note}>{note}</p>
        ))}
        {(data?.notes ?? []).map((note) => (
          <p key={note}>{note}</p>
        ))}
        {data?.source_url ? (
          <p className="mt-1">
            <a href={data.source_url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              {data.source_label ?? "Source"}
            </a>
          </p>
        ) : (
          <p>Draft stays on this device. Taken and in-progress courses stay locked to the term they already occupy.</p>
        )}
      </div>
    </div>
  );
}
