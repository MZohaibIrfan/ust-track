import { useEffect, useMemo, useState, type ReactNode } from "react";
import { apiGetCached, apiPost } from "../lib/api";
import { DAY_LABELS } from "../lib/time";
import type {
  CatalogOffering,
  CatalogSection,
  CommonCoreLabel,
  CourseDetail,
  CourseHit,
  Plan,
  SectionActionPayload,
} from "../lib/types";

type View =
  | { name: "home" }
  | { name: "common-core" }
  | { name: "courses"; title: string }
  | { name: "course"; code: string; title: string };

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

function Chevron() {
  return <span className="text-[12px] text-muted">›</span>;
}

function RowButton({
  children,
  onClick,
  onPointerEnter,
  mono,
}: {
  children: ReactNode;
  onClick: () => void;
  onPointerEnter?: () => void;
  mono?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onPointerEnter={onPointerEnter}
      className={`flex w-full items-center justify-between gap-2 rounded-md border border-line bg-surface-raised px-2.5 py-2 text-left text-[13px] hover:bg-fill ${
        mono ? "font-mono" : ""
      }`}
    >
      <span className="min-w-0 truncate">{children}</span>
      <Chevron />
    </button>
  );
}

export function CatalogPanel({
  plannerId,
  plan,
  onApplied,
}: {
  plannerId: string;
  plan: Plan | null;
  onApplied: (plan?: Plan) => void;
}) {
  const [view, setView] = useState<View>({ name: "home" });
  const [subjects, setSubjects] = useState<string[]>([]);
  const [labels, setLabels] = useState<CommonCoreLabel[]>([]);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<CourseHit[]>([]);
  const [detail, setDetail] = useState<CourseDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listTitle, setListTitle] = useState<string | null>(null);
  const [lecture, setLecture] = useState<CatalogSection | null>(null);
  const [tutorial, setTutorial] = useState<CatalogSection | null>(null);
  const [lab, setLab] = useState<CatalogSection | null>(null);
  const [adding, setAdding] = useState(false);

  const selectedCodes = useMemo(
    () => new Set((plan?.class_selections ?? []).map((s) => `${s.course_code}|${s.section_code}`)),
    [plan],
  );

  useEffect(() => {
    apiGetCached<{ subjects: string[]; common_core: CommonCoreLabel[] }>("/api/catalog/nav")
      .then((nav) => {
        setSubjects(nav.subjects);
        setLabels(nav.common_core);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (view.name !== "home") return;
    const q = query.trim();
    if (!q) {
      setHits([]);
      return;
    }
    const handle = window.setTimeout(() => {
      apiGetCached<CourseHit[]>(`/api/search?q=${encodeURIComponent(q)}`, 60_000)
        .then(setHits)
        .catch(() => setHits([]));
    }, 150);
    return () => window.clearTimeout(handle);
  }, [query, view]);

  async function openSubject(subject: string) {
    setBusy(true);
    setError(null);
    try {
      setHits(await apiGetCached<CourseHit[]>(`/api/courses?subject=${encodeURIComponent(subject)}`));
      setListTitle(subject);
      setView({ name: "courses", title: subject });
    } catch {
      setError("Couldn't load courses.");
    } finally {
      setBusy(false);
    }
  }

  async function openCommonCore(label: CommonCoreLabel) {
    setBusy(true);
    setError(null);
    try {
      setHits(await apiGetCached<CourseHit[]>(`/api/courses?common_core=${encodeURIComponent(label.id)}`));
      const title = `${label.area} · ${label.family}`;
      setListTitle(title);
      setView({ name: "courses", title });
    } catch {
      setError("Couldn't load common core courses.");
    } finally {
      setBusy(false);
    }
  }

  async function openCourse(code: string, title?: string | null) {
    if (view.name === "home") setListTitle(null);
    setBusy(true);
    setError(null);
    setLecture(null);
    setTutorial(null);
    setLab(null);
    try {
      const next = await apiGetCached<CourseDetail>(`/api/course/${encodeURIComponent(code)}`);
      setDetail(next);
      setView({ name: "course", code, title: title || next.title || code });
    } catch {
      setError("Couldn't load that course.");
    } finally {
      setBusy(false);
    }
  }

  function goHome() {
    setView({ name: "home" });
    setListTitle(null);
    setDetail(null);
    setLecture(null);
    setTutorial(null);
    setLab(null);
    if (!query.trim()) setHits([]);
  }

  function goBack() {
    if (view.name === "course" && listTitle) {
      setView({ name: "courses", title: listTitle });
      setDetail(null);
      setLecture(null);
      setTutorial(null);
      setLab(null);
      return;
    }
    if (view.name === "courses") {
      setView(listTitle?.includes("·") ? { name: "common-core" } : { name: "home" });
      if (!listTitle?.includes("·")) setListTitle(null);
      return;
    }
    goHome();
  }

  const offering: CatalogOffering | undefined = detail?.offerings[0];
  const lectures = offering?.sections.filter((s) => s.kind === "lecture") ?? [];
  const tutorials =
    offering && lecture
      ? eligibleAfterLecture(offering.sections, "tutorial", offering.matching.tutorials, lecture)
      : [];
  const labs =
    offering && lecture ? eligibleAfterLecture(offering.sections, "lab", offering.matching.labs, lecture) : [];

  const needsTutorial = Boolean(lecture && offering && offering.sections.some((s) => s.kind === "tutorial"));
  const needsLab = Boolean(lecture && offering && offering.sections.some((s) => s.kind === "lab"));
  const canAdd = Boolean(lecture && (!needsTutorial || tutorial) && (!needsLab || lab));

  const labelsByFamily = useMemo(() => {
    const grouped = new Map<string, CommonCoreLabel[]>();
    for (const label of labels) {
      const list = grouped.get(label.family) ?? [];
      list.push(label);
      grouped.set(label.family, list);
    }
    return [...grouped.entries()];
  }, [labels]);

  async function addChosen() {
    if (!detail || !offering || !lecture || adding) return;
    const chosen = [lecture, tutorial, lab].filter((s): s is CatalogSection => !!s);
    setAdding(true);
    setError(null);
    try {
      const result = await apiPost<SectionActionPayload>("/api/timetable/apply", {
        planner_id: plannerId,
        course_code: detail.course_code,
        section_codes: chosen.map((section) => section.section_code),
        term_code: offering.term_code,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      onApplied(result.plan);
    } catch (err) {
      const message = err instanceof Error ? err.message.trim() : "";
      let shown = "Couldn't add those sections.";
      if (message && !message.startsWith("<")) {
        try {
          const parsed = JSON.parse(message) as { detail?: unknown; error?: unknown };
          if (typeof parsed.detail === "string") shown = parsed.detail;
          else if (typeof parsed.error === "string") shown = parsed.error;
          else if (message.length < 180) shown = message;
        } catch {
          if (message.length < 180) shown = message;
        }
      }
      setError(shown);
    } finally {
      setAdding(false);
    }
  }

  const heading =
    view.name === "home"
      ? "Catalog"
      : view.name === "common-core"
        ? "Common Core"
        : view.name === "courses"
          ? view.title
          : detail
            ? detail.course_code
            : "Course";

  return (
    <section className="flex h-64 min-h-0 shrink-0 flex-col border-b border-line bg-surface-raised lg:h-auto lg:w-64 lg:border-r lg:border-b-0">
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-2.5 py-2">
        {view.name !== "home" ? (
          <button
            type="button"
            onClick={goBack}
            className="rounded-md px-1.5 py-0.5 text-[12px] text-muted hover:bg-fill hover:text-ink"
          >
            Back
          </button>
        ) : null}
        <h2 className="min-w-0 truncate text-[13px] font-medium">{heading}</h2>
      </header>

      {view.name === "home" || view.name === "common-core" ? (
        <div className="shrink-0 border-b border-line p-2">
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (view.name !== "home") setView({ name: "home" });
            }}
            placeholder="Search code or name…"
            className="w-full rounded-md border border-line bg-bg px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
          />
        </div>
      ) : null}

      {error ? <p className="border-b border-line px-2.5 py-1.5 text-[12px] text-accent">{error}</p> : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {busy ? <p className="px-1 text-[12px] text-muted">Loading…</p> : null}

        {view.name === "home" && query.trim() ? (
          <ul className="flex flex-col gap-1">
            {hits.length === 0 && !busy ? (
              <li className="px-1 text-[12px] text-muted">No courses match that search.</li>
            ) : (
              hits.map((hit) => (
                <li key={hit.course_code}>
                  <RowButton
                    mono
                    onClick={() => openCourse(hit.course_code, hit.title)}
                    onPointerEnter={() => {
                      void apiGetCached<CourseDetail>(`/api/course/${encodeURIComponent(hit.course_code)}`);
                    }}
                  >
                    <span>
                      {hit.course_code}
                      <span className="mt-0.5 block truncate font-sans text-[12px] font-normal text-muted">
                        {hit.title}
                      </span>
                    </span>
                  </RowButton>
                </li>
              ))
            )}
          </ul>
        ) : null}

        {view.name === "home" && !query.trim() ? (
          <div className="flex flex-col gap-2">
            <RowButton onClick={() => setView({ name: "common-core" })}>Common Core</RowButton>
            <div className="grid grid-cols-2 gap-1.5">
              {subjects.map((subject) => (
                <button
                  key={subject}
                  type="button"
                  onClick={() => openSubject(subject)}
                  className="flex items-center justify-between rounded-md border border-line bg-bg px-2 py-1.5 text-left font-mono text-[12px] hover:bg-fill"
                >
                  {subject}
                  <Chevron />
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {view.name === "common-core" ? (
          <div className="flex flex-col gap-3">
            {labelsByFamily.map(([family, familyLabels]) => (
              <div key={family}>
                <p className="mb-1.5 px-0.5 text-[11px] font-medium tracking-wide text-muted uppercase">
                  {family === "36" ? "36-credit" : `${family} intake`}
                </p>
                <div className="flex flex-col gap-1">
                  {familyLabels.map((label) => (
                    <RowButton key={label.id} onClick={() => openCommonCore(label)}>
                      <span>
                        {label.area}
                        <span className="mt-0.5 block truncate text-[11px] font-normal text-muted">{label.group}</span>
                      </span>
                    </RowButton>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {view.name === "courses" ? (
          <ul className="flex flex-col gap-1">
            {hits.length === 0 && !busy ? (
              <li className="px-1 text-[12px] text-muted">No courses in this list.</li>
            ) : (
              hits.map((hit) => (
                <li key={hit.course_code}>
                  <RowButton
                    mono
                    onClick={() => openCourse(hit.course_code, hit.title)}
                    onPointerEnter={() => {
                      void apiGetCached<CourseDetail>(`/api/course/${encodeURIComponent(hit.course_code)}`);
                    }}
                  >
                    <span>
                      {hit.course_code}
                      <span className="mt-0.5 block truncate font-sans text-[12px] font-normal text-muted">
                        {hit.title}
                      </span>
                    </span>
                  </RowButton>
                </li>
              ))
            )}
          </ul>
        ) : null}

        {view.name === "course" && detail ? (
          <CoursePicker
            detail={detail}
            offering={offering}
            lectures={lectures}
            tutorials={lecture ? tutorials : []}
            labs={lecture ? labs : []}
            lecture={lecture}
            tutorial={tutorial}
            lab={lab}
            onLecture={(s) => {
              setLecture(s);
              setTutorial(null);
              setLab(null);
            }}
            onTutorial={setTutorial}
            onLab={setLab}
            selectedCodes={selectedCodes}
            canAdd={canAdd}
            adding={adding}
            onAdd={addChosen}
          />
        ) : null}
      </div>
    </section>
  );
}

function CoursePicker({
  detail,
  offering,
  lectures,
  tutorials,
  labs,
  lecture,
  tutorial,
  lab,
  onLecture,
  onTutorial,
  onLab,
  selectedCodes,
  canAdd,
  adding,
  onAdd,
}: {
  detail: CourseDetail;
  offering: CatalogOffering | undefined;
  lectures: CatalogSection[];
  tutorials: CatalogSection[];
  labs: CatalogSection[];
  lecture: CatalogSection | null;
  tutorial: CatalogSection | null;
  lab: CatalogSection | null;
  onLecture: (s: CatalogSection) => void;
  onTutorial: (s: CatalogSection) => void;
  onLab: (s: CatalogSection) => void;
  selectedCodes: Set<string>;
  canAdd: boolean;
  adding: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-[13px] font-medium">{detail.title ?? detail.course_code}</p>
        <p className="text-[12px] text-muted">
          {detail.credits != null ? `${detail.credits} credits` : ""}
          {offering ? ` · ${offering.term_label}` : " · No offering"}
        </p>
      </div>

      {!offering ? (
        <p className="text-[12px] text-muted">This course has no class sections this term.</p>
      ) : (
        <>
          <SectionGroup
            label="Lecture"
            sections={lectures}
            selected={lecture}
            courseCode={detail.course_code}
            selectedCodes={selectedCodes}
            onPick={onLecture}
          />
          {lecture && tutorials.length > 0 ? (
            <SectionGroup
              label={offering.matching.tutorials === "aligned" ? "Tutorial (matching)" : "Tutorial"}
              sections={tutorials}
              selected={tutorial}
              courseCode={detail.course_code}
              selectedCodes={selectedCodes}
              onPick={onTutorial}
            />
          ) : null}
          {lecture && labs.length > 0 ? (
            <SectionGroup
              label={offering.matching.labs === "aligned" ? "Lab (matching)" : "Lab"}
              sections={labs}
              selected={lab}
              courseCode={detail.course_code}
              selectedCodes={selectedCodes}
              onPick={onLab}
            />
          ) : null}
          <button
            type="button"
            disabled={!canAdd || adding}
            onClick={onAdd}
            className="rounded-md bg-ink px-2.5 py-1.5 text-[12px] font-medium text-bg disabled:opacity-40"
          >
            {adding ? "Adding…" : "Add to timetable"}
          </button>
        </>
      )}
    </div>
  );
}

function SectionGroup({
  label,
  sections,
  selected,
  courseCode,
  selectedCodes,
  onPick,
}: {
  label: string;
  sections: CatalogSection[];
  selected: CatalogSection | null;
  courseCode: string;
  selectedCodes: Set<string>;
  onPick: (section: CatalogSection) => void;
}) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium tracking-wide text-muted uppercase">{label}</p>
      <ul className="flex flex-col gap-1">
        {sections.map((section) => {
          const key = `${courseCode}|${section.section_code}`;
          const active = selected?.section_code === section.section_code;
          return (
            <li key={section.section_code}>
              <button
                type="button"
                onClick={() => onPick(section)}
                className={`w-full rounded-md border px-2 py-1.5 text-left ${
                  active ? "border-accent bg-accent-soft" : "border-line bg-bg hover:bg-fill"
                }`}
              >
                <p className="flex items-baseline justify-between gap-2 font-mono text-[12px]">
                  {section.section_code}
                  {selectedCodes.has(key) ? <span className="font-sans text-[11px] text-accent">On plan</span> : null}
                </p>
                <p className="mt-0.5 text-[11px] leading-4 text-muted">{meetingLine(section)}</p>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
