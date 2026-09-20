import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ProgramGrid } from "../components/ProgramGrid";
import { apiGet, apiGetCached, apiPost, apiPut } from "../lib/api";
import { useAuth } from "../lib/auth";
import { roleFor } from "../lib/programCategories";
import { getPlannerId } from "../lib/planner";
import type { AcademicYear, CatalogProgram, CourseHit, DeclaredProgram, DegreeProfile } from "../lib/types";

type Step = "welcome" | "status" | "courses" | "interests" | "program" | "experience";
type Status = "new" | "undeclared_with_courses" | "declared" | "special_program";

const STATUS_OPTIONS: { id: Status; label: string; body: string }[] = [
  { id: "new", label: "I'm a new student", body: "Haven't started classes yet." },
  { id: "undeclared_with_courses", label: "I haven't declared a major", body: "But I've taken some courses." },
  { id: "declared", label: "I already have a major", body: "Let's set it up." },
  { id: "special_program", label: "I'm in a special program", body: "IIM, DDP, or similar." },
];

const COURSE_STATUS_OPTIONS = [
  { value: "completed", label: "Completed" },
  { value: "in_progress", label: "In progress" },
  { value: "planned", label: "Planned" },
];

const UNDECLARED: Status[] = ["new", "undeclared_with_courses"];

function nextStep(current: Step, status: Status | null): Step | "done" {
  if (current === "welcome") return "status";
  if (current === "status") return status === "new" ? "interests" : "courses";
  if (current === "courses") return status && UNDECLARED.includes(status) ? "interests" : "program";
  if (current === "interests") return "experience";
  if (current === "program") return "experience";
  return "done";
}

const PROGRESS_STAGES: Step[] = ["welcome", "status", "courses", "experience"];

function progressFor(step: Step): number {
  const normalized = step === "interests" || step === "program" ? "courses" : step;
  const index = PROGRESS_STAGES.indexOf(normalized as Step);
  return index < 0 ? 0 : (index + 1) / PROGRESS_STAGES.length;
}

function StepShell({
  eyebrow,
  title,
  subtitle,
  wide,
  progress,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  wide?: boolean;
  progress: number;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div
      className={`flex w-full flex-col gap-6 rounded-2xl border border-line bg-surface-raised p-7 shadow-soft-lg sm:p-9 ${
        wide ? "max-w-3xl" : "max-w-xl"
      }`}
    >
      <div className="h-1 w-full overflow-hidden rounded-full bg-fill">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>
      <div>
        <p className="text-[11px] font-semibold tracking-wide text-accent uppercase">{eyebrow}</p>
        <h1 className="mt-1.5 text-[24px] font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle ? <p className="mt-1.5 text-[13px] leading-5 text-muted">{subtitle}</p> : null}
      </div>
      {children}
      <div className="flex items-center justify-between border-t border-line pt-5">{footer}</div>
    </div>
  );
}

function SkipLink({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-[13px] text-muted hover:text-ink hover:underline">
      Skip
    </button>
  );
}

function PrimaryButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-xl bg-accent px-5 py-2.5 text-[13px] font-medium text-accent-ink shadow-soft transition-transform hover:-translate-y-0.5 disabled:pointer-events-none disabled:translate-y-0 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export function OnboardingPage() {
  const plannerId = getPlannerId();
  const { markOnboarded } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>("welcome");
  const [status, setStatus] = useState<Status | null>(null);
  const [finishing, setFinishing] = useState(false);

  const [years, setYears] = useState<AcademicYear[]>([]);
  const [entryYear, setEntryYear] = useState<number | null>(null);
  const [entryYearTouched, setEntryYearTouched] = useState(false);

  useEffect(() => {
    apiGetCached<AcademicYear[]>("/api/academic-years")
      .then(setYears)
      .catch(() => {});
  }, []);

  const latestYear = useMemo(
    () => (years.length > 0 ? years.reduce((a, b) => (a.start_year > b.start_year ? a : b)) : null),
    [years],
  );

  // "New student" obviously means this year's intake — fill it in so they don't have to think
  // about it, but leave it editable in case someone picks it by mistake.
  useEffect(() => {
    if (status === "new" && latestYear && !entryYearTouched) {
      setEntryYear(latestYear.start_year);
    }
  }, [status, latestYear, entryYearTouched]);

  const standingYear = useMemo(() => {
    if (!entryYear || !latestYear) return null;
    return Math.min(4, Math.max(1, latestYear.start_year - entryYear + 1));
  }, [entryYear, latestYear]);

  async function finish() {
    if (finishing) return;
    setFinishing(true);
    try {
      await markOnboarded();
    } finally {
      navigate("/");
    }
  }

  function advance() {
    if (step === "status" && entryYear) {
      apiPut("/api/degree/entry-year", { planner_id: plannerId, entry_year: entryYear }).catch(() => {
        // best-effort — the student can set this later from Degree
      });
    }
    const next = nextStep(step, status);
    if (next === "done") {
      finish();
    } else {
      setStep(next);
    }
  }

  return (
    <main className="flex h-full min-h-0 items-center justify-center overflow-y-auto bg-bg px-4 py-10">
      {step === "welcome" ? (
        <StepShell
          eyebrow="Welcome"
          progress={progressFor("welcome")}
          title="Your HKUST degree, planned your way."
          subtitle="Build your academic pathway, fit in the experiences you want, and stay on track to graduation."
          footer={
            <>
              <SkipLink onClick={finish} />
              <PrimaryButton onClick={() => setStep("status")}>Get started</PrimaryButton>
            </>
          }
        >
          <p className="text-[13px] leading-5 text-muted">
            This takes a couple of minutes. Nothing here is final — you can change your major,
            courses, or experiences any time from the app.
          </p>
        </StepShell>
      ) : null}

      {step === "status" ? (
        <StepShell
          eyebrow="Step 1"
          progress={progressFor("status")}
          title="Where are you in your HKUST journey?"
          footer={
            <>
              <SkipLink onClick={finish} />
              <PrimaryButton onClick={advance} disabled={!status || !entryYear}>
                Continue
              </PrimaryButton>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <div className="grid gap-2 sm:grid-cols-2">
              {STATUS_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setStatus(option.id)}
                  className={`rounded-xl border px-3.5 py-3 text-left text-[13px] shadow-soft transition-all ${
                    status === option.id
                      ? "border-accent bg-accent-soft"
                      : "border-line bg-surface-raised hover:-translate-y-0.5 hover:shadow-soft-lg"
                  }`}
                >
                  <p className="font-medium text-ink">{option.label}</p>
                  <p className="mt-0.5 text-[12px] text-muted">{option.body}</p>
                </button>
              ))}
            </div>

            {status ? (
              <label className="flex items-center gap-2 text-[13px]">
                <span className="text-muted">
                  {status === "new" ? "You're starting in" : "What year did you start at HKUST?"}
                </span>
                <select
                  value={entryYear ?? ""}
                  onChange={(e) => {
                    setEntryYearTouched(true);
                    setEntryYear(Number(e.target.value) || null);
                  }}
                  className="rounded-xl border border-line bg-surface-raised px-2 py-1 text-[13px] outline-none focus:border-accent"
                >
                  {entryYear == null ? <option value="">Select a year</option> : null}
                  {years.map((year) => (
                    <option key={year.start_year} value={year.start_year}>
                      {year.code}
                    </option>
                  ))}
                </select>
                {standingYear ? <span className="text-[12px] text-muted">Year {standingYear}</span> : null}
              </label>
            ) : null}
          </div>
        </StepShell>
      ) : null}

      {step === "courses" ? <CoursesStep plannerId={plannerId} onNext={advance} onSkip={advance} /> : null}

      {step === "interests" ? (
        <InterestsStep plannerId={plannerId} defaultYear={standingYear ?? 1} onNext={advance} onSkip={advance} />
      ) : null}

      {step === "program" ? <ProgramStep plannerId={plannerId} onNext={advance} onSkip={advance} /> : null}

      {step === "experience" ? <ExperienceStep plannerId={plannerId} onNext={finish} onSkip={finish} /> : null}
    </main>
  );
}

function CoursesStep({ plannerId, onNext, onSkip }: { plannerId: string; onNext: () => void; onSkip: () => void }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<CourseHit[]>([]);
  const [courseCode, setCourseCode] = useState<string | null>(null);
  const [status, setStatus] = useState("completed");
  const [added, setAdded] = useState<{ course_code: string; status: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
  }, [query]);

  async function addCourse() {
    if (!courseCode || saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await apiPost<{ ok?: boolean; error?: string }>("/api/plan/course", {
        planner_id: plannerId,
        course_code: courseCode,
        status,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setAdded((prev) => [...prev, { course_code: courseCode, status }]);
      setCourseCode(null);
      setQuery("");
      setHits([]);
    } catch {
      setError("Couldn't add that course.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <StepShell
      eyebrow="Step 2 · Starting point"
      progress={progressFor("courses")}
      title="Have you taken any courses yet?"
      subtitle="Search by code — mark each as completed, in progress, or planned."
      footer={
        <>
          <SkipLink onClick={onSkip} />
          <PrimaryButton onClick={onNext}>{added.length > 0 ? "Continue" : "Continue without adding"}</PrimaryButton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={onNext}
          className="self-start rounded-xl border border-dashed border-line px-3.5 py-2 text-left text-[13px] text-muted transition-colors hover:border-accent hover:text-accent"
        >
          I have no courses yet — skip this step
        </button>

        <div className="flex flex-wrap gap-2">
          <input
            value={courseCode ?? query}
            onChange={(e) => {
              setCourseCode(null);
              setQuery(e.target.value);
            }}
            placeholder="Course code or title, e.g. COMP2011"
            className="min-w-[14rem] flex-1 rounded-xl border border-line bg-surface-raised px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
          />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-xl border border-line bg-surface-raised px-2.5 py-1.5 text-[13px]"
          >
            {COURSE_STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={addCourse}
            disabled={!courseCode || saving}
            className="rounded-xl bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-ink disabled:opacity-40"
          >
            {saving ? "Adding…" : "Add"}
          </button>
        </div>

        {!courseCode && hits.length > 0 ? (
          <ul className="flex flex-col gap-1 rounded-xl border border-line bg-surface-raised p-1.5">
            {hits.slice(0, 6).map((hit) => (
              <li key={hit.course_code}>
                <button
                  type="button"
                  onClick={() => {
                    setCourseCode(hit.course_code);
                    setQuery(hit.course_code);
                    setHits([]);
                  }}
                  className="flex w-full items-baseline justify-between gap-2 rounded-xl px-2 py-1.5 text-left text-[13px] hover:bg-fill"
                >
                  <span className="font-mono">{hit.course_code}</span>
                  <span className="min-w-0 truncate text-[12px] text-muted">{hit.title}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {error ? <p className="text-[12px] text-accent">{error}</p> : null}

        {added.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {added.map((c, i) => (
              <li
                key={`${c.course_code}-${i}`}
                className="flex items-center justify-between rounded-xl border border-line bg-surface-raised px-2.5 py-1.5 text-[13px]"
              >
                <span className="font-mono">{c.course_code}</span>
                <span className="text-[12px] text-muted">{c.status.replaceAll("_", " ")}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </StepShell>
  );
}

function InterestsStep({
  plannerId,
  defaultYear,
  onNext,
  onSkip,
}: {
  plannerId: string;
  defaultYear: number;
  onNext: () => void;
  onSkip: () => void;
}) {
  const [year, setYear] = useState(defaultYear);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [suggestions, setSuggestions] = useState<CourseHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    apiGetCached<{ subjects: string[] }>("/api/catalog/nav")
      .then((nav) => setSubjects(nav.subjects))
      .catch(() => {});
  }, []);

  function toggleSubject(subject: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(subject)) next.delete(subject);
      else next.add(subject);
      return next;
    });
  }

  async function findSuggestions() {
    if (selected.size === 0) return;
    setLoading(true);
    setSearched(true);
    try {
      const results = await Promise.all(
        [...selected].map((subject) => apiGetCached<CourseHit[]>(`/api/courses?subject=${encodeURIComponent(subject)}`)),
      );
      const levelMatch = results.flat().filter((hit) => {
        const digit = hit.course_code.match(/(\d)/)?.[1];
        return digit ? Number(digit) === year : false;
      });
      setSuggestions(levelMatch.slice(0, 12));
    } catch {
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }

  async function addCourse(code: string) {
    try {
      await apiPost("/api/plan/course", { planner_id: plannerId, course_code: code, status: "planned" });
      setAdded((prev) => new Set(prev).add(code));
    } catch {
      // best-effort — the student can add it again later from Timetable
    }
  }

  return (
    <StepShell
      eyebrow="Step 3"
      progress={progressFor("interests")}
      title="What are you interested in?"
      subtitle="No major to declare yet — pick a few subjects and your year, and we'll suggest courses that fit. This doesn't lock you into anything."
      footer={
        <>
          <SkipLink onClick={onSkip} />
          <PrimaryButton onClick={onNext}>{added.size > 0 ? "Continue" : "Continue without adding"}</PrimaryButton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-2 text-[13px]">
          <span className="text-muted">Year of study this term</span>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="rounded-xl border border-line bg-surface-raised px-2 py-1 text-[13px]"
          >
            {[1, 2, 3, 4].map((y) => (
              <option key={y} value={y}>
                Year {y}
              </option>
            ))}
          </select>
        </label>

        <div>
          <p className="mb-1.5 text-[12px] text-muted">Subjects you're curious about</p>
          <div className="flex flex-wrap gap-1.5">
            {subjects.map((subject) => (
              <button
                key={subject}
                type="button"
                onClick={() => toggleSubject(subject)}
                className={`rounded-full border px-2.5 py-1 font-mono text-[12px] transition-colors ${
                  selected.has(subject) ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:bg-fill"
                }`}
              >
                {subject}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={findSuggestions}
          disabled={selected.size === 0 || loading}
          className="self-start rounded-xl bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-ink disabled:opacity-40"
        >
          {loading ? "Finding…" : "Suggest courses"}
        </button>

        {searched && !loading && suggestions.length === 0 ? (
          <p className="text-[12px] text-muted">No Year {year} courses found in those subjects — try another subject.</p>
        ) : null}

        {suggestions.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {suggestions.map((hit) => (
              <li
                key={hit.course_code}
                className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface-raised px-3 py-2 text-[13px]"
              >
                <span className="min-w-0">
                  <span className="font-mono">{hit.course_code}</span>{" "}
                  <span className="text-muted">{hit.title}</span>
                </span>
                {added.has(hit.course_code) ? (
                  <span className="shrink-0 text-[12px] text-accent">Added</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => addCourse(hit.course_code)}
                    className="shrink-0 rounded-xl border border-line px-2 py-1 text-[12px] hover:bg-fill"
                  >
                    Add to plan
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </StepShell>
  );
}

function ProgramStep({ plannerId, onNext, onSkip }: { plannerId: string; onNext: () => void; onSkip: () => void }) {
  const [programs, setPrograms] = useState<CatalogProgram[]>([]);
  const [declared, setDeclared] = useState<DeclaredProgram[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [declaredNow, setDeclaredNow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGetCached<CatalogProgram[]>("/api/programs")
      .then(setPrograms)
      .catch(() => setError("Couldn't load the program catalog."));
    apiGet<DegreeProfile>(`/api/degree/profile?planner_id=${plannerId}`)
      .then((profile) => setDeclared(profile.declared_programs))
      .catch(() => {});
  }, [plannerId]);

  const selectedProgram = programs.find((p) => p.code === selected) ?? null;

  async function declare() {
    if (!selectedProgram || saving) return;
    setSaving(true);
    setError(null);
    try {
      await apiPost("/api/degree/apply", {
        planner_id: plannerId,
        program_code: selectedProgram.code,
        role: roleFor(selectedProgram),
      });
      setDeclaredNow(true);
    } catch {
      setError("Couldn't declare that program.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <StepShell
      eyebrow="Step 3"
      progress={progressFor("program")}
      title="Declare a program"
      subtitle="Pick your major (or minor, extended major — whatever fits). You can change this any time from Degree."
      wide
      footer={
        <>
          <SkipLink onClick={onSkip} />
          <PrimaryButton onClick={onNext}>{declaredNow ? "Continue" : "Continue without declaring"}</PrimaryButton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <ProgramGrid programs={programs} declared={declared} selected={selected} onSelect={setSelected} />
        {error ? <p className="text-[12px] text-accent">{error}</p> : null}
        {selectedProgram ? (
          <button
            type="button"
            onClick={declare}
            disabled={saving || declaredNow}
            className="self-start rounded-xl bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-ink disabled:opacity-40"
          >
            {declaredNow ? "Declared" : saving ? "Declaring…" : `Declare ${roleFor(selectedProgram).replaceAll("_", " ")}`}
          </button>
        ) : null}
      </div>
    </StepShell>
  );
}

const KIND_OPTIONS = [
  { value: "internship", label: "Internship" },
  { value: "job", label: "Job" },
  { value: "project", label: "Project" },
];

function ExperienceStep({ plannerId, onNext, onSkip }: { plannerId: string; onNext: () => void; onSkip: () => void }) {
  const [title, setTitle] = useState("");
  const [organization, setOrganization] = useState("");
  const [kind, setKind] = useState("internship");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addedCount, setAddedCount] = useState(0);

  async function addExperience() {
    if (!title.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await apiPost("/api/career/experiences", {
        planner_id: plannerId,
        title,
        organization,
        kind,
        start_date: startDate || null,
        end_date: endDate || null,
        description: "",
      });
      setAddedCount((n) => n + 1);
      setTitle("");
      setOrganization("");
      setKind("internship");
      setStartDate("");
      setEndDate("");
    } catch {
      setError("Couldn't save that experience.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <StepShell
      eyebrow="Step 4"
      progress={progressFor("experience")}
      title="Add experiences"
      subtitle="Exchange, Co-op, internships, research — anything that shapes your timeline. Optional."
      footer={
        <>
          <SkipLink onClick={onSkip} />
          <PrimaryButton onClick={onNext}>{addedCount > 0 ? "Finish" : "Finish without adding"}</PrimaryButton>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (e.g. Software Engineering Intern)"
            className="min-w-[14rem] flex-1 rounded-xl border border-line bg-surface-raised px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
          />
          <input
            value={organization}
            onChange={(e) => setOrganization(e.target.value)}
            placeholder="Organization"
            className="min-w-[10rem] flex-1 rounded-xl border border-line bg-surface-raised px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
          />
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="rounded-xl border border-line bg-surface-raised px-2.5 py-1.5 text-[13px]"
          >
            {KIND_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="rounded-xl border border-line bg-surface-raised px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
          />
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="rounded-xl border border-line bg-surface-raised px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={addExperience}
            disabled={!title.trim() || saving}
            className="rounded-xl bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-ink disabled:opacity-40"
          >
            {saving ? "Adding…" : "Add another"}
          </button>
        </div>
        {error ? <p className="text-[12px] text-accent">{error}</p> : null}
        {addedCount > 0 ? <p className="text-[12px] text-muted">{addedCount} added.</p> : null}
      </div>
    </StepShell>
  );
}
