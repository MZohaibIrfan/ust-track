import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { apiGetCached, apiPost } from "../lib/api";
import { courseHue, courseHues } from "../lib/courseColor";
import { DAY_LABELS } from "../lib/time";
import type { CatalogSection, CourseDetail, Plan, RemovedPayload, SectionActionPayload } from "../lib/types";
import type { GridSelection } from "./WeekGrid";

function meetingLine(section: CatalogSection): string {
  const meeting = section.meetings[0];
  if (!meeting?.weekday || !meeting.start_time || !meeting.end_time) return "Time TBA";
  const day = DAY_LABELS[meeting.weekday] ?? meeting.weekday;
  const range = `${meeting.start_time.slice(0, 5)}–${meeting.end_time.slice(0, 5)}`;
  return meeting.venue ? `${day} ${range} · ${meeting.venue}` : `${day} ${range}`;
}

function eligibleAfterLecture(
  sections: CatalogSection[],
  kind: "tutorial" | "lab",
  mode: "aligned" | "any",
  lecture: CatalogSection,
): CatalogSection[] {
  const pool = sections.filter((s) => s.kind === kind);
  if (mode === "aligned" && lecture.number) {
    return pool.filter((s) => s.number === lecture.number);
  }
  return pool;
}

function PickList({
  label,
  sections,
  selected,
  busy,
  onPick,
}: {
  label: string;
  sections: CatalogSection[];
  selected: CatalogSection | null;
  busy: boolean;
  onPick: (section: CatalogSection) => void;
}) {
  return (
    <div className="mt-2 flex flex-col gap-1">
      <p className="text-[11px] font-medium tracking-wide text-muted uppercase">{label}</p>
      {sections.length === 0 ? (
        <p className="text-[12px] text-muted">No sections of this type.</p>
      ) : (
        sections.map((section) => {
          const active = selected?.section_code === section.section_code;
          return (
            <button
              key={section.section_code}
              type="button"
              disabled={busy}
              onClick={() => onPick(section)}
              className={`rounded-xl border px-2 py-1.5 text-left disabled:opacity-40 ${
                active ? "border-accent bg-surface-raised" : "border-line bg-bg hover:bg-fill"
              }`}
            >
              <p className="font-mono text-[12px]">{section.section_code}</p>
              <p className="text-[11px] text-muted">{meetingLine(section)}</p>
            </button>
          );
        })
      )}
    </div>
  );
}

export function CourseActions({
  plannerId,
  plan,
  selected,
  onClose,
  onChanged,
}: {
  plannerId: string;
  plan: Plan | null;
  selected: GridSelection;
  onClose: () => void;
  onChanged: (plan?: Plan) => void;
}) {
  const hues = useMemo(
    () => courseHues((plan?.class_selections ?? []).map((row) => row.course_code)),
    [plan],
  );
  const hue = hues.get(selected.course_code.toUpperCase()) ?? courseHue(selected.course_code);
  const [swapping, setSwapping] = useState(false);
  const [detail, setDetail] = useState<CourseDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lecture, setLecture] = useState<CatalogSection | null>(null);
  const [tutorial, setTutorial] = useState<CatalogSection | null>(null);
  const [lab, setLab] = useState<CatalogSection | null>(null);

  useEffect(() => {
    setSwapping(false);
    setDetail(null);
    setError(null);
    setLecture(null);
    setTutorial(null);
    setLab(null);
    void apiGetCached<CourseDetail>(`/api/course/${encodeURIComponent(selected.course_code)}`).then(setDetail).catch(
      () => {},
    );
  }, [selected.course_code, selected.section_code]);

  const offering = detail?.course_code === selected.course_code ? detail.offerings[0] : undefined;
  const current = offering?.sections.find((s) => s.section_code === selected.section_code);
  const lectureSwap = current?.kind === "lecture";
  const alternatives =
    offering && current
      ? offering.sections.filter((s) => s.kind === current.kind && s.section_code !== current.section_code)
      : [];

  useEffect(() => {
    if (!swapping || !lectureSwap || lecture || !current) return;
    if (alternatives.length === 0) setLecture(current);
  }, [swapping, lectureSwap, lecture, current, alternatives.length]);

  const tutorials =
    offering && lecture
      ? eligibleAfterLecture(offering.sections, "tutorial", offering.matching.tutorials, lecture)
      : [];
  const labs =
    offering && lecture ? eligibleAfterLecture(offering.sections, "lab", offering.matching.labs, lecture) : [];
  const needsTutorial = Boolean(lecture && offering?.sections.some((s) => s.kind === "tutorial"));
  const needsLab = Boolean(lecture && offering?.sections.some((s) => s.kind === "lab"));
  const canSwapLecture = Boolean(lecture && (!needsTutorial || tutorial) && (!needsLab || lab));

  async function dropCourse() {
    setBusy(true);
    setError(null);
    try {
      const result = await apiPost<RemovedPayload>("/api/timetable/drop", {
        planner_id: plannerId,
        course_code: selected.course_code,
      });
      onChanged(result.plan);
      onClose();
    } catch {
      setError("Couldn't drop that course.");
    } finally {
      setBusy(false);
    }
  }

  async function openSwap() {
    setBusy(true);
    setError(null);
    try {
      const next =
        detail ?? (await apiGetCached<CourseDetail>(`/api/course/${encodeURIComponent(selected.course_code)}`));
      setDetail(next);
      setLecture(null);
      setTutorial(null);
      setLab(null);
      setSwapping(true);
    } catch {
      setError("Couldn't load other sections.");
    } finally {
      setBusy(false);
    }
  }

  function pickLecture(next: CatalogSection) {
    setLecture(next);
    setTutorial(null);
    setLab(null);
    const hasFollowOn = Boolean(
      offering?.sections.some((s) => s.kind === "tutorial" || s.kind === "lab"),
    );
    if (!hasFollowOn) void commitSwap(next, []);
  }

  async function commitSwap(nextLecture: CatalogSection, extra: CatalogSection[]) {
    if (!offering || !current) return;
    setBusy(true);
    setError(null);
    try {
      const result = await apiPost<SectionActionPayload>("/api/timetable/swap", {
        planner_id: plannerId,
        course_code: selected.course_code,
        from_section: current.section_code,
        to_section: nextLecture.section_code,
        term_code: offering.term_code,
        also_sections: extra.map((s) => s.section_code),
      });
      if (result.error) {
        setError(result.error);
        onChanged(result.plan);
        return;
      }
      onChanged(result.plan);
      onClose();
    } catch {
      setError("Couldn't swap that section.");
    } finally {
      setBusy(false);
    }
  }

  async function swapSimple(next: CatalogSection) {
    await commitSwap(next, []);
  }

  async function swapLectureBundle() {
    if (!lecture) return;
    const extra = [tutorial, lab].filter((s): s is CatalogSection => !!s);
    await commitSwap(lecture, extra);
  }

  return (
    <div
      className="tt-block tt-action-bar shrink-0 border-b border-line px-3 py-2"
      style={{ "--course-h": String(hue) } as CSSProperties}
      data-lit="true"
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-mono text-[13px] font-medium">
          {selected.course_code} <span className="opacity-70">{selected.section_code}</span>
        </p>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={openSwap}
            className="rounded-xl border border-white/30 bg-white/15 px-2 py-1 text-[12px] font-medium hover:bg-white/25 disabled:opacity-40"
          >
            Swap section
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={dropCourse}
            className="rounded-xl border border-white/30 bg-white/15 px-2 py-1 text-[12px] font-medium hover:bg-white/25 disabled:opacity-40"
          >
            Drop
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-1.5 py-1 text-[12px] opacity-70 hover:bg-white/15 hover:opacity-100"
          >
            Close
          </button>
        </div>
      </div>
      {error ? <p className="mt-1.5 text-[12px] text-accent">{error}</p> : null}
      {swapping ? (
        lectureSwap ? (
          <div>
            <PickList
              label={current ? `Replace ${current.section_code}` : "Lecture"}
              sections={alternatives}
              selected={lecture}
              busy={busy}
              onPick={pickLecture}
            />
            {lecture && needsTutorial ? (
              <PickList
                label={offering?.matching.tutorials === "aligned" ? "Tutorial (matching)" : "Tutorial"}
                sections={tutorials}
                selected={tutorial}
                busy={busy}
                onPick={setTutorial}
              />
            ) : null}
            {lecture && needsLab ? (
              <PickList
                label={offering?.matching.labs === "aligned" ? "Lab (matching)" : "Lab"}
                sections={labs}
                selected={lab}
                busy={busy}
                onPick={setLab}
              />
            ) : null}
            {lecture && (needsTutorial || needsLab) ? (
              <button
                type="button"
                disabled={!canSwapLecture || busy}
                onClick={() => void swapLectureBundle()}
                className="mt-2 rounded-xl bg-accent px-2.5 py-1.5 text-[12px] font-medium text-accent-ink disabled:opacity-40"
              >
                {busy ? "Swapping…" : "Swap"}
              </button>
            ) : null}
          </div>
        ) : (
          <PickList
            label={current ? `Replace ${current.section_code}` : "Other sections"}
            sections={alternatives}
            selected={null}
            busy={busy}
            onPick={(section) => void swapSimple(section)}
          />
        )
      ) : null}
    </div>
  );
}
