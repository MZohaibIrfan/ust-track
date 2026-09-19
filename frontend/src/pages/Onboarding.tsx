import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ProgramsPanel, roleFor } from "../components/ProgramsPanel";
import { apiGet, apiGetCached, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { getPlannerId } from "../lib/planner";
import type { CatalogProgram, CourseHit, DeclaredProgram, DegreeProfile } from "../lib/types";

type Step = "welcome" | "status" | "courses" | "program" | "experience";
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

function nextStep(current: Step, status: Status | null): Step | "done" {
  if (current === "welcome") return "status";
  if (current === "status") return status === "new" ? "program" : "courses";
  if (current === "courses") return "program";
  if (current === "program") return "experience";
  return "done";
}

function StepShell({
  eyebrow,
  title,
  subtitle,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="flex w-full max-w-xl flex-col gap-5">
      <div>
        <p className="text-[11px] font-medium tracking-wide text-muted uppercase">{eyebrow}</p>
        <h1 className="mt-1 text-[20px] font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle ? <p className="mt-1 text-[13px] text-muted">{subtitle}</p> : null}
      </div>
      {children}
      <div className="flex items-center justify-between border-t border-line pt-4">{footer}</div>
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
      className="rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-bg disabled:opacity-40"
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
    const next = nextStep(step, status);
    if (next === "done") {
      finish();
    } else {
      setStep(next);
    }
  }

  return (
    <main className="flex h-full min-h-0 flex-col items-center overflow-y-auto bg-bg px-4 py-10">
      {step === "welcome" ? (
        <StepShell
          eyebrow="Welcome"
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
          title="Where are you in your HKUST journey?"
          footer={
            <>
              <SkipLink onClick={finish} />
              <PrimaryButton onClick={advance} disabled={!status}>
                Continue
              </PrimaryButton>
            </>
          }
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {STATUS_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setStatus(option.id)}
                className={`rounded-md border px-3 py-2.5 text-left text-[13px] transition-colors ${
                  status === option.id ? "border-accent bg-accent-soft" : "border-line bg-surface-raised hover:bg-fill"
                }`}
              >
                <p className="font-medium text-ink">{option.label}</p>
                <p className="mt-0.5 text-[12px] text-muted">{option.body}</p>
              </button>
            ))}
          </div>
        </StepShell>
      ) : null}

      {step === "courses" ? <CoursesStep plannerId={plannerId} onNext={advance} onSkip={advance} /> : null}

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
      eyebrow="Step 2"
      title="Add courses you've already taken"
      subtitle="Search by code — mark each as completed, in progress, or planned."
      footer={
        <>
          <SkipLink onClick={onSkip} />
          <PrimaryButton onClick={onNext}>{added.length > 0 ? "Continue" : "Continue without adding"}</PrimaryButton>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <input
            value={courseCode ?? query}
            onChange={(e) => {
              setCourseCode(null);
              setQuery(e.target.value);
            }}
            placeholder="Course code or title, e.g. COMP2011"
            className="min-w-[14rem] flex-1 rounded-md border border-line bg-surface-raised px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
          />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-md border border-line bg-surface-raised px-2.5 py-1.5 text-[13px]"
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
            className="rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-bg disabled:opacity-40"
          >
            {saving ? "Adding…" : "Add"}
          </button>
        </div>

        {!courseCode && hits.length > 0 ? (
          <ul className="flex flex-col gap-1 rounded-md border border-line bg-surface-raised p-1.5">
            {hits.slice(0, 6).map((hit) => (
              <li key={hit.course_code}>
                <button
                  type="button"
                  onClick={() => {
                    setCourseCode(hit.course_code);
                    setQuery(hit.course_code);
                    setHits([]);
                  }}
                  className="flex w-full items-baseline justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-fill"
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
                className="flex items-center justify-between rounded-md border border-line bg-surface-raised px-2.5 py-1.5 text-[13px]"
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
      title="Declare a program"
      subtitle="Pick your major (or minor, extended major — whatever fits). You can change this any time from Degree."
      footer={
        <>
          <SkipLink onClick={onSkip} />
          <PrimaryButton onClick={onNext}>{declaredNow ? "Continue" : "Continue without declaring"}</PrimaryButton>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <div className="h-72 overflow-hidden rounded-md border border-line">
          <ProgramsPanel programs={programs} declared={declared} selected={selected} onSelect={setSelected} />
        </div>
        {error ? <p className="text-[12px] text-accent">{error}</p> : null}
        {selectedProgram ? (
          <button
            type="button"
            onClick={declare}
            disabled={saving || declaredNow}
            className="self-start rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-bg disabled:opacity-40"
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
            className="min-w-[14rem] flex-1 rounded-md border border-line bg-surface-raised px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
          />
          <input
            value={organization}
            onChange={(e) => setOrganization(e.target.value)}
            placeholder="Organization"
            className="min-w-[10rem] flex-1 rounded-md border border-line bg-surface-raised px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
          />
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="rounded-md border border-line bg-surface-raised px-2.5 py-1.5 text-[13px]"
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
            className="rounded-md border border-line bg-surface-raised px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
          />
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="rounded-md border border-line bg-surface-raised px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={addExperience}
            disabled={!title.trim() || saving}
            className="rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-bg disabled:opacity-40"
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
