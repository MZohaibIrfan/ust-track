import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { AgentMarkdown } from "../components/AgentMarkdown";
import { AgentPanel } from "../components/AgentPanel";
import { ChatHistoryFooter, ChatTabs } from "../components/ChatTabs";
import { CareerIcon } from "../components/NavIcons";
import { PageHeader } from "../components/PageHeader";
import { API_BASE, apiDelete, apiGet, apiPost, apiPostStream } from "../lib/api";
import { usePlanner } from "../lib/PlannerContext";
import type {
  CourseMatch,
  CvEducationDefaults,
  CvGenerationSummary,
  Experience,
  ExperienceSelectionResult,
  JobMatchResult,
} from "../lib/types";

function Icon({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? "size-4"}
    >
      {children}
    </svg>
  );
}

const KIND_META: Record<string, { label: string; orgLabel: string; icon: ReactNode }> = {
  internship: {
    label: "Internship",
    orgLabel: "Organization",
    icon: (
      <Icon>
        <rect x="2" y="7" width="20" height="14" rx="2" />
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
      </Icon>
    ),
  },
  project: {
    label: "Project",
    orgLabel: "Tech stack (e.g. Python, React)",
    icon: (
      <Icon>
        <path d="m12 2 9 5-9 5-9-5 9-5Z" />
        <path d="m3 12 9 5 9-5M3 17l9 5 9-5" />
      </Icon>
    ),
  },
  extracurricular: {
    label: "Extracurricular",
    orgLabel: "Club / organization",
    icon: (
      <Icon>
        <circle cx="12" cy="8" r="5" />
        <path d="M8.5 13.5 6 22l6-3 6 3-2.5-8.5" />
      </Icon>
    ),
  },
  research: {
    label: "Research",
    orgLabel: "Lab / supervisor",
    icon: (
      <Icon>
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" />
      </Icon>
    ),
  },
};

// Same order the CV builder lays sections out in — Experience, Research,
// Projects, Extracurricular — so the page reads the same way the CV will.
const SECTION_ORDER: { kind: string; title: string }[] = [
  { kind: "internship", title: "Internship Experience" },
  { kind: "research", title: "Research Experience" },
  { kind: "project", title: "Projects" },
  { kind: "extracurricular", title: "Extracurricular Activities" },
];

type CareerSubpage = "experience" | "cv";

const CAREER_SUBPAGES: { id: CareerSubpage; to: string; label: string }[] = [
  { id: "experience", to: "/career", label: "Experience" },
  { id: "cv", to: "/career/cv", label: "CV Generator" },
];

const TrashIcon = () => (
  <Icon className="size-3.5">
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0-1 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 6h12Z" />
  </Icon>
);

const SendIcon = () => (
  <Icon className="size-3.5">
    <path d="m22 2-7 20-4-9-9-4Z" />
    <path d="M22 2 11 13" />
  </Icon>
);

const SparkleIcon = () => (
  <Icon className="size-3.5">
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
  </Icon>
);

const CheckIcon = () => (
  <Icon className="size-3.5">
    <path d="M20 6 9 17l-5-5" />
  </Icon>
);

const WarningIcon = () => (
  <Icon className="size-3.5">
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4M12 17h.01" />
  </Icon>
);

const STARTERS = [
  "Here's a job posting — what should I take?",
  "What have I already logged?",
  "I did a data analyst internship last summer, can you log it?",
];

function formatRange(start: string | null, end: string | null): string {
  if (!start && !end) return "";
  return `${start ?? "?"} – ${end ?? "present"}`;
}

function ExperienceCard({
  exp,
  removingId,
  onRemove,
}: {
  exp: Experience;
  removingId: string | null;
  onRemove: (id: string) => void;
}) {
  const meta = KIND_META[exp.kind] ?? KIND_META.internship;
  return (
    <li className="group flex items-start gap-2.5 rounded-2xl border border-line bg-bg px-3.5 py-3 shadow-soft transition-all hover:-translate-y-0.5 hover:border-page-career/40 hover:shadow-soft-lg">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-xl bg-page-career/15 text-page-career">
        {meta.icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[13px] font-medium">
            {exp.title}
            {exp.organization ? <span className="font-normal text-muted"> · {exp.organization}</span> : null}
          </p>
          <button
            onClick={() => onRemove(exp.id)}
            disabled={removingId === exp.id}
            className="shrink-0 rounded p-1 text-muted opacity-0 transition-opacity hover:bg-fill hover:text-accent group-hover:opacity-100 disabled:opacity-40"
            aria-label="Remove experience"
          >
            <TrashIcon />
          </button>
        </div>
        <p className="text-[11px] text-muted">
          {exp.location}
          {exp.location && formatRange(exp.start_date, exp.end_date) ? " · " : ""}
          {formatRange(exp.start_date, exp.end_date)}
        </p>
        {exp.description ? (
          <p className="mt-1 whitespace-pre-wrap text-[12px] leading-5 text-ink">{exp.description}</p>
        ) : null}
      </div>
    </li>
  );
}

function ScoreBar({ score, max }: { score: number; max: number }) {
  const pct = Math.max(6, Math.min(100, (score / max) * 100));
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-fill">
      <div className="h-full rounded-full bg-page-career transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

function CourseMatchCard({ course, maxScore }: { course: CourseMatch; maxScore: number }) {
  return (
    <div className="group rounded-xl border border-line bg-bg px-3 py-2.5 text-[13px] shadow-soft transition-colors hover:border-page-career/50">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono font-medium">
          {course.course_code} <span className="font-sans font-normal text-muted">· {course.credits} cr</span>
        </p>
        {course.in_major ? (
          <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-accent">
            <SparkleIcon /> In your major
          </span>
        ) : course.status === "completed" ? (
          <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted">
            <CheckIcon /> Completed
          </span>
        ) : null}
      </div>
      <p className="mt-0.5 text-[12px] text-muted">{course.title}</p>
      <div className="mt-2">
        <ScoreBar score={course.score} max={maxScore} />
      </div>
      {course.matched_terms.length > 0 ? (
        <p className="mt-1.5 flex flex-wrap gap-1">
          {course.matched_terms.map((term) => (
            <span key={term} className="rounded bg-fill px-1.5 py-0.5 text-[11px] text-ink">
              {term}
            </span>
          ))}
        </p>
      ) : null}
      {course.prereq_gap ? (
        <p className="mt-1.5 flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
          <WarningIcon /> May need a prerequisite you haven't completed yet
        </p>
      ) : null}
    </div>
  );
}

function JobMatchCard({ data }: { data: JobMatchResult }) {
  if (data.error) {
    return <p className="rounded-xl border border-line bg-bg px-3 py-2 text-[13px] text-muted">{data.error}</p>;
  }
  const allCourses = [...data.already_relevant, ...data.recommended];
  const maxScore = Math.max(1, ...allCourses.map((c) => c.score));

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface-raised px-3.5 py-3.5 shadow-soft">
      {data.matched_keywords.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1 border-b border-line pb-2.5">
          <span className="text-[11px] font-medium text-muted">Picked up on:</span>
          {data.matched_keywords.slice(0, 10).map((k) => (
            <span
              key={k}
              className="rounded-full border border-page-career/30 bg-page-career/10 px-2 py-0.5 text-[11px] text-page-career"
            >
              {k}
            </span>
          ))}
        </div>
      ) : null}
      <div>
        <p className="mb-1.5 text-[11px] font-medium text-muted">Recommended next</p>
        {data.recommended.length === 0 ? (
          <p className="text-[12px] text-muted">No close matches in the catalog for this one.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {data.recommended.map((c) => (
              <CourseMatchCard key={c.course_code} course={c} maxScore={maxScore} />
            ))}
          </div>
        )}
      </div>
      {data.already_relevant.length > 0 ? (
        <div>
          <p className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-muted">
            <CheckIcon /> Already covered by courses you've taken
          </p>
          <div className="flex flex-col gap-1.5">
            {data.already_relevant.map((c) => (
              <CourseMatchCard key={c.course_code} course={c} maxScore={maxScore} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CvSelectionCard({ data, onApply }: { data: ExperienceSelectionResult; onApply: (ids: string[]) => void }) {
  if (data.error) {
    return <p className="rounded-xl border border-line bg-bg px-3 py-2 text-[13px] text-muted">{data.error}</p>;
  }
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-line bg-surface-raised px-3.5 py-3 shadow-soft">
      <p className="text-[11px] font-medium text-muted">For your CV, based on this role:</p>
      {data.selected.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {data.selected.map((exp) => (
            <div key={exp.id} className="rounded-xl border border-accent/30 bg-accent-soft px-2.5 py-1.5 text-[12px]">
              <span className="font-medium text-accent">{exp.title}</span>
              {exp.matched_terms.length > 0 ? (
                <span className="text-muted"> · {exp.matched_terms.join(", ")}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[12px] text-muted">Nothing logged matched this role's keywords.</p>
      )}
      {data.not_selected.length > 0 ? (
        <p className="text-[11px] text-muted">
          No overlap: {data.not_selected.map((e) => e.title).join(", ")}
        </p>
      ) : null}
      <button
        onClick={() => onApply(data.selected.map((e) => e.id))}
        className="self-start rounded-xl bg-ink px-2.5 py-1 text-[12px] font-medium text-bg hover:bg-ink/90"
      >
        Use this selection for my CV
      </button>
    </div>
  );
}

type ChatMessage = { role: "user" | "assistant"; content: string };
type Segment =
  | { kind: "text"; text: string }
  | { kind: "job_match"; data: JobMatchResult }
  | { kind: "experience_added"; data: { ok: boolean; title: string } }
  | { kind: "experience_removed"; data: { ok: boolean; removed: boolean } }
  | { kind: "cv_selection"; data: ExperienceSelectionResult };

const MARKER_RE = /<<(JOB_MATCH|EXPERIENCE_ADDED|EXPERIENCE_REMOVED|CV_SELECTION):([A-Za-z0-9+/=]+)>>/g;

function parseSegments(content: string): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  MARKER_RE.lastIndex = 0;
  while ((match = MARKER_RE.exec(content))) {
    if (match.index > lastIndex) {
      segments.push({ kind: "text", text: content.slice(lastIndex, match.index) });
    }
    try {
      const data = JSON.parse(atob(match[2]));
      if (match[1] === "JOB_MATCH") segments.push({ kind: "job_match", data });
      else if (match[1] === "EXPERIENCE_ADDED") segments.push({ kind: "experience_added", data });
      else if (match[1] === "CV_SELECTION") segments.push({ kind: "cv_selection", data });
      else segments.push({ kind: "experience_removed", data });
    } catch {
      // malformed marker — skip it rather than breaking the whole message
    }
    lastIndex = MARKER_RE.lastIndex;
  }
  if (lastIndex < content.length) {
    segments.push({ kind: "text", text: content.slice(lastIndex) });
  }
  return segments.filter((s) => s.kind !== "text" || s.text.trim() !== "");
}

function TypingDots() {
  return (
    <div className="mr-auto flex max-w-[90%] items-center gap-1 rounded-xl bg-bg px-3 py-2.5">
      <span className="size-1.5 animate-bounce rounded-full bg-muted [animation-delay:-0.3s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-muted [animation-delay:-0.15s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-muted" />
    </div>
  );
}

function ChatBubble({
  message,
  pending,
  onApplySelection,
}: {
  message: ChatMessage;
  pending: boolean;
  onApplySelection: (ids: string[]) => void;
}) {
  if (message.role === "user") {
    return (
      <div className="ml-auto max-w-[90%] rounded-xl bg-accent px-3 py-2 text-[13px] text-accent-ink whitespace-pre-wrap">
        {message.content}
      </div>
    );
  }

  const segments = parseSegments(message.content);
  if (segments.length === 0) {
    return pending ? <TypingDots /> : null;
  }

  return (
    <div className="mr-auto flex max-w-[90%] flex-col gap-2">
      {segments.map((seg, i) => {
        if (seg.kind === "text") {
          return <AgentMarkdown key={i}>{seg.text}</AgentMarkdown>;
        }
        if (seg.kind === "job_match") {
          return <JobMatchCard key={i} data={seg.data} />;
        }
        if (seg.kind === "cv_selection") {
          return <CvSelectionCard key={i} data={seg.data} onApply={onApplySelection} />;
        }
        if (seg.kind === "experience_added") {
          return (
            <p
              key={i}
              className="flex items-center gap-1.5 rounded-xl border border-accent/30 bg-accent-soft px-3 py-2 text-[12px] text-accent"
            >
              <CheckIcon /> Logged: {seg.data.title}
            </p>
          );
        }
        return (
          <p key={i} className="flex items-center gap-1.5 rounded-xl border border-line bg-bg px-3 py-2 text-[12px] text-muted">
            <TrashIcon /> Removed
          </p>
        );
      })}
    </div>
  );
}

export function CareerPage() {
  const { plannerId } = usePlanner();
  const routerLocation = useLocation();
  const navigate = useNavigate();
  const subpage: CareerSubpage = routerLocation.pathname === "/career/cv" ? "cv" : "experience";
  const [experiences, setExperiences] = useState<Experience[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [organization, setOrganization] = useState("");
  const [location, setLocation] = useState("");
  const [kind, setKind] = useState("internship");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const [cvPanelTab, setCvPanelTab] = useState<"build" | "history">("build");
  const [cvName, setCvName] = useState("");
  const [cvFullName, setCvFullName] = useState("");
  const [cvEmail, setCvEmail] = useState("");
  const [cvPhone, setCvPhone] = useState("");
  const [cvLinkedin, setCvLinkedin] = useState("");
  const [cvGithub, setCvGithub] = useState("");
  const [cvWebsite, setCvWebsite] = useState("");
  const [eduInstitution, setEduInstitution] = useState("");
  const [eduLocation, setEduLocation] = useState("");
  const [eduDegreeLine, setEduDegreeLine] = useState("");
  const [eduDates, setEduDates] = useState("");
  const [eduLoaded, setEduLoaded] = useState(false);
  const [cvSkills, setCvSkills] = useState("");
  const [cvGenerating, setCvGenerating] = useState(false);
  const [cvError, setCvError] = useState<string | null>(null);
  const [cvTexUrl, setCvTexUrl] = useState<string | null>(null);
  const [cvPdfUrl, setCvPdfUrl] = useState<string | null>(null);
  const [selectedExpIds, setSelectedExpIds] = useState<Set<string>>(new Set());
  const [cvHistory, setCvHistory] = useState<CvGenerationSummary[]>([]);
  const [cvHistoryLoading, setCvHistoryLoading] = useState(false);
  const [cvHistoryBusyId, setCvHistoryBusyId] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [historyMessages, setHistoryMessages] = useState<ChatMessage[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [panelTab, setPanelTab] = useState<"chat" | "history">("chat");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function refreshExperiences() {
    try {
      const result = await apiGet<{ experiences: Experience[] }>(
        `/api/career/experiences?planner_id=${plannerId}`,
      );
      setExperiences(result.experiences);
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    setMessages([]);
    setInput("");
    setShowForm(false);
    setError(null);
    setChatError(null);
    setLoading(true);
    setExperiences([]);
    setHistoryLoaded(false);
    setHistoryMessages([]);
    apiGet<{ experiences: Experience[] }>(`/api/career/experiences?planner_id=${plannerId}`)
      .then((result) => {
        if (!cancelled) setExperiences(result.experiences);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't reach the server.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    // The Chat tab always starts fresh (see send()'s comment) — this only
    // feeds the read-only History tab, so past chats don't come back.
    apiGet<{ messages: ChatMessage[] }>(`/api/career/chat?planner_id=${plannerId}`)
      .then((res) => {
        if (!cancelled) setHistoryMessages(res.messages);
      })
      .catch(() => {
        // backend may not be running yet — history just starts empty
      })
      .finally(() => {
        if (!cancelled) setHistoryLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [plannerId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, panelTab]);

  // Keep the CV checklist in sync with the real experience list: newly seen
  // entries default to included, removed ones drop out. Ids the user has
  // deliberately unchecked (still present, just not selected) stay unchecked.
  const seenExpIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const currentIds = experiences.map((e) => e.id);
    const currentSet = new Set(currentIds);
    setSelectedExpIds((prev) => {
      const next = new Set(prev);
      for (const id of currentIds) {
        if (!seenExpIdsRef.current.has(id)) next.add(id);
      }
      return new Set([...next].filter((id) => currentSet.has(id)));
    });
    seenExpIdsRef.current = currentSet;
  }, [experiences]);

  function toggleExpSelected(id: string) {
    setSelectedExpIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function applySelectionFromChat(ids: string[]) {
    setSelectedExpIds(new Set(ids));
    setCvPanelTab("build");
    navigate("/career/cv");
  }

  async function loadCvHistory() {
    setCvHistoryLoading(true);
    try {
      const res = await apiGet<{ generations: CvGenerationSummary[] }>(`/api/career/cv/history?planner_id=${plannerId}`);
      setCvHistory(res.generations);
    } catch {
      // history stays empty
    } finally {
      setCvHistoryLoading(false);
    }
  }

  async function viewCvHistoryItem(id: string) {
    setCvHistoryBusyId(id);
    setCvError(null);
    const gen = cvHistory.find((g) => g.id === id);
    if (gen) {
      setCvName(gen.name);
      setCvFullName(gen.full_name);
    }
    try {
      const [texRes, pdfRes] = await Promise.all([
        fetch(`${API_BASE}/api/career/cv/history/${id}?planner_id=${plannerId}`),
        fetch(`${API_BASE}/api/career/cv/history/${id}/pdf?planner_id=${plannerId}`),
      ]);
      if (cvTexUrl) URL.revokeObjectURL(cvTexUrl);
      if (cvPdfUrl) URL.revokeObjectURL(cvPdfUrl);
      if (!texRes.ok || !pdfRes.ok) {
        setCvError(await (pdfRes.ok ? texRes : pdfRes).text());
        setCvTexUrl(null);
        setCvPdfUrl(null);
        return;
      }
      setCvTexUrl(URL.createObjectURL(await texRes.blob()));
      setCvPdfUrl(URL.createObjectURL(await pdfRes.blob()));
      setCvPanelTab("build");
    } catch {
      setCvError("Couldn't reach the server.");
    } finally {
      setCvHistoryBusyId(null);
    }
  }

  async function deleteCvHistoryItem(id: string) {
    setCvHistoryBusyId(id);
    try {
      await apiDelete(`/api/career/cv/history/${id}?planner_id=${plannerId}`);
      setCvHistory((prev) => prev.filter((g) => g.id !== id));
    } catch {
      // leave the list as-is; user can retry
    } finally {
      setCvHistoryBusyId(null);
    }
  }

  async function clearChat() {
    setHistoryMessages([]);
    try {
      await apiDelete(`/api/career/chat?planner_id=${plannerId}`);
    } catch {
      // best-effort — local state is already cleared
    }
  }

  useEffect(() => {
    if (showForm) formRef.current?.querySelector("input")?.focus();
  }, [showForm]);

  async function addExperience(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      await apiPost("/api/career/experiences", {
        planner_id: plannerId,
        title,
        organization,
        location,
        kind,
        start_date: startDate || null,
        end_date: endDate || null,
        description,
      });
      setTitle("");
      setOrganization("");
      setLocation("");
      setKind("internship");
      setStartDate("");
      setEndDate("");
      setDescription("");
      setShowForm(false);
      await refreshExperiences();
    } catch {
      setError("Couldn't save that experience.");
    } finally {
      setSaving(false);
    }
  }

  async function removeExperience(id: string) {
    setRemovingId(id);
    try {
      await apiDelete(`/api/career/experiences/${id}?planner_id=${plannerId}`);
      setExperiences((prev) => prev.filter((exp) => exp.id !== id));
    } catch {
      setError("Couldn't remove that — refreshing.");
      refreshExperiences();
    } finally {
      setRemovingId(null);
    }
  }

  useEffect(() => {
    if (subpage === "cv") loadCvHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subpage, plannerId]);

  // Prefill the editable education block from the student's actual profile
  // once per planner — after that, leave whatever the student typed alone.
  useEffect(() => {
    setEduLoaded(false);
    apiGet<CvEducationDefaults>(`/api/career/cv/education-defaults?planner_id=${plannerId}`)
      .then((defaults) => {
        setEduInstitution(defaults.institution);
        setEduLocation(defaults.location);
        setEduDegreeLine(defaults.degree_line);
        setEduDates(defaults.dates);
      })
      .catch(() => {
        // stays blank — the backend still falls back to its own defaults if empty
      })
      .finally(() => setEduLoaded(true));
  }, [plannerId]);

  // Release the blob URLs when the page unmounts (planner switch, navigation away).
  useEffect(() => {
    return () => {
      if (cvTexUrl) URL.revokeObjectURL(cvTexUrl);
      if (cvPdfUrl) URL.revokeObjectURL(cvPdfUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function generateCv(e: React.FormEvent) {
    e.preventDefault();
    if (!cvFullName.trim() || cvGenerating) return;
    setCvGenerating(true);
    setCvError(null);
    if (cvTexUrl) URL.revokeObjectURL(cvTexUrl);
    if (cvPdfUrl) URL.revokeObjectURL(cvPdfUrl);
    setCvTexUrl(null);
    setCvPdfUrl(null);
    const payload = JSON.stringify({
      planner_id: plannerId,
      name: cvName,
      full_name: cvFullName,
      email: cvEmail,
      phone: cvPhone,
      linkedin: cvLinkedin,
      github: cvGithub,
      website: cvWebsite,
      skills_text: cvSkills,
      include_ids: Array.from(selectedExpIds),
      education_institution: eduInstitution,
      education_location: eduLocation,
      education_degree_line: eduDegreeLine,
      education_dates: eduDates,
    });
    try {
      const [texRes, pdfRes] = await Promise.all([
        fetch(`${API_BASE}/api/career/cv`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
        }),
        fetch(`${API_BASE}/api/career/cv/pdf`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
        }),
      ]);
      if (!texRes.ok) {
        setCvError(await texRes.text());
        return;
      }
      setCvTexUrl(URL.createObjectURL(await texRes.blob()));

      if (!pdfRes.ok) {
        // .tex still succeeded — surface the PDF-specific problem without blocking that download.
        setCvError(await pdfRes.text());
        return;
      }
      setCvPdfUrl(URL.createObjectURL(await pdfRes.blob()));
      loadCvHistory();
    } catch {
      setCvError("Couldn't reach the server.");
    } finally {
      setCvGenerating(false);
    }
  }

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setChatError(null);
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages([...next, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);

    try {
      const res = await apiPostStream("/api/career/advisor", { messages: next, planner_id: plannerId });
      if (!res.ok || !res.body) {
        setChatError(await res.text());
        setMessages(next);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages([...next, { role: "assistant", content: acc }]);
      }
      if (/<<EXPERIENCE_(ADDED|REMOVED):/.test(acc)) {
        refreshExperiences();
      }
      // The backend persisted this turn server-side — mirror it into the
      // History tab's list so it shows up without needing a page reload.
      setHistoryMessages((prev) => [...prev, { role: "user", content: text }, { role: "assistant", content: acc }]);
    } catch {
      setChatError("Couldn't reach the career agent. Check the server is running.");
      setMessages(next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex h-full min-h-0 flex-col">
      <PageHeader
        icon={CareerIcon}
        badgeClassName="bg-page-career/15 text-page-career"
        title="Career"
        subtitle="Internships, projects, activities, research — and what to take next"
      />

      <nav className="flex shrink-0 gap-1 border-b border-line px-4">
        {CAREER_SUBPAGES.map((page) => (
          <NavLink
            key={page.id}
            to={page.to}
            end={page.id === "experience"}
            className={({ isActive }) =>
              `-mb-px border-b-2 px-2.5 py-2 text-[13px] ${
                isActive ? "border-accent font-medium text-ink" : "border-transparent text-muted hover:text-ink"
              }`
            }
          >
            {page.label}
          </NavLink>
        ))}
      </nav>

      <div className="flex min-h-0 flex-1 flex-col gap-2 bg-bg p-2 lg:flex-row lg:gap-3 lg:p-3">
        <section
          className={`min-h-0 min-w-0 flex-1 rounded-2xl border border-line bg-surface-raised shadow-soft ${
            subpage === "cv" ? "overflow-hidden" : "overflow-auto"
          }`}
        >
          {subpage === "experience" ? (
            <>
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <h2 className="flex items-center gap-2 text-[13px] font-medium">
              Experience
              {experiences.length > 0 ? (
                <span className="rounded-full bg-fill px-1.5 py-0.5 text-[11px] font-normal text-muted">
                  {experiences.length}
                </span>
              ) : null}
            </h2>
            <button
              onClick={() => setShowForm((v) => !v)}
              className={`flex items-center gap-1 rounded-xl px-2.5 py-1 text-[12px] font-medium transition-colors ${
                showForm ? "bg-fill text-ink hover:bg-line" : "bg-accent text-accent-ink hover:bg-accent/90"
              }`}
            >
              {showForm ? (
                "Cancel"
              ) : (
                <>
                  <Icon className="size-3.5">
                    <path d="M12 5v14M5 12h14" />
                  </Icon>
                  Add experience
                </>
              )}
            </button>
          </div>

          {showForm ? (
            <form
              ref={formRef}
              onSubmit={addExperience}
              className="flex flex-col gap-2.5 border-b border-line bg-bg px-3 py-3"
            >
              <div className="flex flex-wrap gap-2">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Title (e.g. Software Engineering Intern)"
                  required
                  className="min-w-[14rem] flex-1 rounded-xl border border-line bg-surface-raised px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
                />
                <input
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  placeholder={KIND_META[kind]?.orgLabel ?? "Organization"}
                  className="min-w-[10rem] flex-1 rounded-xl border border-line bg-surface-raised px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
                />
                <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Location (e.g. Hong Kong, HK)"
                  className="min-w-[10rem] flex-1 rounded-xl border border-line bg-surface-raised px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
                />
              </div>

              <div className="flex flex-wrap gap-1.5">
                {Object.entries(KIND_META).map(([value, meta]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setKind(value)}
                    className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors ${
                      kind === value
                        ? "border-page-career bg-page-career/15 text-page-career"
                        : "border-line text-muted hover:text-ink"
                    }`}
                  >
                    {meta.icon}
                    {meta.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5 text-[12px] text-muted">
                  From
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="rounded-xl border border-line bg-surface-raised px-2 py-1 text-[13px] outline-none focus:border-accent"
                  />
                </label>
                <label className="flex items-center gap-1.5 text-[12px] text-muted">
                  To
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="rounded-xl border border-line bg-surface-raised px-2 py-1 text-[13px] outline-none focus:border-accent"
                  />
                </label>
              </div>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What did you actually do? One point per line — each becomes its own bullet on your CV."
                rows={3}
                className="rounded-xl border border-line bg-surface-raised px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
              />
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={saving || !title.trim()}
                  className="self-start rounded-xl bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-ink transition-opacity disabled:opacity-40"
                >
                  {saving ? "Saving…" : "Save experience"}
                </button>
              </div>
            </form>
          ) : null}

          {loading ? (
            <div className="flex flex-col gap-2 px-3 py-3">
              {[0, 1].map((i) => (
                <div key={i} className="h-14 animate-pulse rounded-xl bg-fill" />
              ))}
            </div>
          ) : experiences.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <span className="flex size-10 items-center justify-center rounded-full bg-fill text-muted">
                <CareerIcon className="size-5" />
              </span>
              <p className="max-w-xs text-[13px] text-muted">
                No internships, projects, activities, or research logged yet. Add one, or just tell the
                agent about it, so we can match your background against real job descriptions and build
                your CV.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-4 p-2.5">
              {SECTION_ORDER.map(({ kind: sectionKind, title }) => {
                const items = experiences.filter((exp) => exp.kind === sectionKind);
                if (items.length === 0) return null;
                return (
                  <div key={sectionKind}>
                    <h3 className="mb-1.5 flex items-center gap-1.5 px-0.5 text-[11px] font-semibold tracking-wide text-muted uppercase">
                      {title}
                      <span className="rounded-full bg-fill px-1.5 py-0.5 text-[10px] font-normal normal-case text-muted">
                        {items.length}
                      </span>
                    </h3>
                    <ul className="flex flex-col gap-2">
                      {items.map((exp) => (
                        <ExperienceCard key={exp.id} exp={exp} removingId={removingId} onRemove={removeExperience} />
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}

          {error ? <p className="px-3 py-2 text-[12px] text-accent">{error}</p> : null}
            </>
          ) : (
            <div className="flex h-full min-h-0 flex-col lg:flex-row">
              <div className="flex min-h-0 w-full shrink-0 flex-col overflow-y-auto lg:max-w-sm lg:border-r lg:border-line">
                <div className="flex items-center justify-between border-b border-line px-4 py-3">
                  <div className="flex items-center gap-1 rounded-xl bg-fill p-0.5">
                    <button
                      onClick={() => setCvPanelTab("build")}
                      className={`rounded-lg px-2.5 py-1 text-[12px] font-medium transition-colors ${
                        cvPanelTab === "build" ? "bg-surface-raised text-ink shadow-soft" : "text-muted hover:text-ink"
                      }`}
                    >
                      Build
                    </button>
                    <button
                      onClick={() => setCvPanelTab("history")}
                      className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-[12px] font-medium transition-colors ${
                        cvPanelTab === "history" ? "bg-surface-raised text-ink shadow-soft" : "text-muted hover:text-ink"
                      }`}
                    >
                      History
                      {cvHistory.length > 0 ? (
                        <span className="rounded-full bg-fill px-1.5 py-0.5 text-[10px] text-muted">{cvHistory.length}</span>
                      ) : null}
                    </button>
                  </div>
                </div>

                {cvPanelTab === "build" ? (
                  <div className="flex flex-col gap-3 p-4">
                    <p className="text-[12px] text-muted">
                      Choose what to include below, or ask the career agent in chat to pick relevant
                      experience for a specific role. Contact info isn't saved — just used for this
                      generation.
                    </p>

                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <p className="text-[11px] font-semibold tracking-wide text-muted uppercase">Include</p>
                        <div className="flex gap-2 text-[11px] text-accent">
                          <button type="button" onClick={() => setSelectedExpIds(new Set(experiences.map((e) => e.id)))}>
                            All
                          </button>
                          <button type="button" onClick={() => setSelectedExpIds(new Set())}>
                            None
                          </button>
                        </div>
                      </div>
                      {experiences.length === 0 ? (
                        <p className="text-[12px] text-muted">Nothing logged yet — add experience first.</p>
                      ) : (
                        <div className="flex flex-col gap-2">
                          {SECTION_ORDER.map(({ kind: sectionKind, title }) => {
                            const items = experiences.filter((exp) => exp.kind === sectionKind);
                            if (items.length === 0) return null;
                            return (
                              <div key={sectionKind}>
                                <p className="mb-1 text-[10px] font-medium text-muted">{title}</p>
                                <div className="flex flex-col gap-1">
                                  {items.map((exp) => (
                                    <label
                                      key={exp.id}
                                      className="flex cursor-pointer items-start gap-2 rounded-xl border border-line bg-bg px-2.5 py-1.5 text-[12px] hover:border-page-career/40"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={selectedExpIds.has(exp.id)}
                                        onChange={() => toggleExpSelected(exp.id)}
                                        className="mt-0.5 accent-page-career"
                                      />
                                      <span>
                                        <span className="font-medium">{exp.title}</span>
                                        {exp.organization ? <span className="text-muted"> · {exp.organization}</span> : null}
                                      </span>
                                    </label>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <form onSubmit={generateCv} className="flex flex-col gap-2.5">
                      <input
                        value={cvName}
                        onChange={(e) => setCvName(e.target.value)}
                        placeholder="Name this CV (e.g. Google SWE Application) — optional"
                        className="rounded-xl border border-line bg-bg px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
                      />
                      <input
                        value={cvFullName}
                        onChange={(e) => setCvFullName(e.target.value)}
                        placeholder="Full name"
                        required
                        className="rounded-xl border border-line bg-bg px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
                      />
                      <div className="flex flex-wrap gap-2">
                        <input
                          value={cvEmail}
                          onChange={(e) => setCvEmail(e.target.value)}
                          placeholder="Email"
                          className="min-w-[10rem] flex-1 rounded-xl border border-line bg-bg px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
                        />
                        <input
                          value={cvPhone}
                          onChange={(e) => setCvPhone(e.target.value)}
                          placeholder="Phone"
                          className="min-w-[8rem] flex-1 rounded-xl border border-line bg-bg px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <input
                          value={cvLinkedin}
                          onChange={(e) => setCvLinkedin(e.target.value)}
                          placeholder="LinkedIn URL"
                          className="min-w-[10rem] flex-1 rounded-xl border border-line bg-bg px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
                        />
                        <input
                          value={cvGithub}
                          onChange={(e) => setCvGithub(e.target.value)}
                          placeholder="GitHub URL"
                          className="min-w-[10rem] flex-1 rounded-xl border border-line bg-bg px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
                        />
                      </div>
                      <input
                        value={cvWebsite}
                        onChange={(e) => setCvWebsite(e.target.value)}
                        placeholder="Website (optional)"
                        className="rounded-xl border border-line bg-bg px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
                      />

                      <div className="flex flex-col gap-1.5 rounded-xl border border-line bg-bg p-2.5">
                        <p className="text-[11px] font-semibold tracking-wide text-muted uppercase">
                          Education {eduLoaded ? "" : "(loading from your profile…)"}
                        </p>
                        <input
                          value={eduInstitution}
                          onChange={(e) => setEduInstitution(e.target.value)}
                          placeholder="Institution"
                          className="rounded-xl border border-line bg-surface-raised px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
                        />
                        <div className="flex flex-wrap gap-2">
                          <input
                            value={eduLocation}
                            onChange={(e) => setEduLocation(e.target.value)}
                            placeholder="Location"
                            className="min-w-[8rem] flex-1 rounded-xl border border-line bg-surface-raised px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
                          />
                          <input
                            value={eduDates}
                            onChange={(e) => setEduDates(e.target.value)}
                            placeholder="Dates (e.g. Aug 2023 -- May 2027)"
                            className="min-w-[10rem] flex-1 rounded-xl border border-line bg-surface-raised px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
                          />
                        </div>
                        <textarea
                          value={eduDegreeLine}
                          onChange={(e) => setEduDegreeLine(e.target.value)}
                          placeholder="Degree / major / minor line"
                          rows={2}
                          className="rounded-xl border border-line bg-surface-raised px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
                        />
                      </div>

                      <textarea
                        value={cvSkills}
                        onChange={(e) => setCvSkills(e.target.value)}
                        placeholder={"Skills, one category per line, e.g.\nLanguages: Python, C++, SQL\nFrameworks: React, FastAPI, PyTorch"}
                        rows={4}
                        className="rounded-xl border border-line bg-bg px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
                      />
                      {cvError ? <p className="whitespace-pre-wrap text-[12px] text-accent">{cvError}</p> : null}
                      <button
                        type="submit"
                        disabled={cvGenerating || !cvFullName.trim()}
                        className="flex items-center justify-center gap-1.5 rounded-xl bg-ink px-3 py-2 text-[13px] font-medium text-bg transition-opacity disabled:opacity-40"
                      >
                        {cvGenerating ? "Generating…" : cvPdfUrl ? "Regenerate" : "Generate CV"}
                      </button>
                      {cvTexUrl || cvPdfUrl ? (
                        <div className="flex gap-2">
                          {cvTexUrl ? (
                            <a
                              href={cvTexUrl}
                              download="resume.tex"
                              className="flex-1 rounded-xl border border-line px-3 py-1.5 text-center text-[12px] font-medium hover:bg-fill"
                            >
                              Download .tex
                            </a>
                          ) : null}
                          {cvPdfUrl ? (
                            <a
                              href={cvPdfUrl}
                              download="resume.pdf"
                              className="flex-1 rounded-xl border border-line px-3 py-1.5 text-center text-[12px] font-medium hover:bg-fill"
                            >
                              Download PDF
                            </a>
                          ) : null}
                        </div>
                      ) : null}
                    </form>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 p-4">
                    {cvHistoryLoading ? (
                      <p className="text-[12px] text-muted">Loading…</p>
                    ) : cvHistory.length === 0 ? (
                      <p className="text-[12px] text-muted">No CVs generated yet.</p>
                    ) : (
                      cvHistory.map((gen) => (
                        <div
                          key={gen.id}
                          className="flex items-center justify-between gap-2 rounded-xl border border-line bg-bg px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-[12px] font-medium">{gen.name || gen.full_name}</p>
                            <p className="text-[11px] text-muted">
                              {gen.name ? `${gen.full_name} · ` : ""}
                              {new Date(gen.created_at).toLocaleString()} · {gen.experience_count} included
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              onClick={() => viewCvHistoryItem(gen.id)}
                              disabled={cvHistoryBusyId === gen.id}
                              className="rounded-lg px-2 py-1 text-[11px] font-medium text-accent hover:bg-fill disabled:opacity-40"
                            >
                              View
                            </button>
                            <button
                              onClick={() => deleteCvHistoryItem(gen.id)}
                              disabled={cvHistoryBusyId === gen.id}
                              className="rounded-lg p-1.5 text-muted hover:bg-fill hover:text-accent disabled:opacity-40"
                              aria-label="Delete"
                            >
                              <TrashIcon />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
              <div className="hidden min-h-0 min-w-0 flex-1 items-center justify-center bg-fill/40 lg:flex">
                {cvPdfUrl ? (
                  <iframe title="CV preview" src={cvPdfUrl} className="h-full w-full" />
                ) : (
                  <p className="max-w-[16rem] text-center text-[12px] text-muted">
                    Generate a CV to preview it here.
                  </p>
                )}
              </div>
            </div>
          )}
        </section>

        <AgentPanel>
          <ChatTabs
            tab={panelTab}
            onChange={setPanelTab}
            historyCount={historyMessages.length}
            icon={
              <span className="text-page-career">
                <SparkleIcon />
              </span>
            }
          />

          <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
            {panelTab === "history" ? (
              !historyLoaded ? (
                <p className="text-[12px] text-muted">Loading…</p>
              ) : historyMessages.length === 0 ? (
                <p className="text-[12px] text-muted">No conversation yet with the career agent.</p>
              ) : (
                historyMessages.map((m, i) => (
                  <ChatBubble key={i} message={m} pending={false} onApplySelection={applySelectionFromChat} />
                ))
              )
            ) : messages.length === 0 ? (
              <div className="flex flex-col gap-2">
                <p className="text-[12px] text-muted">
                  Paste a job description, or tell it about past experience
                </p>
                <div className="flex flex-col gap-1.5">
                  {STARTERS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="rounded-xl border border-line px-2.5 py-1.5 text-left text-[13px] leading-5 text-ink transition-colors hover:border-page-career/50 hover:bg-page-career/5"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, i) => (
                <ChatBubble
                  key={i}
                  message={m}
                  pending={busy && i === messages.length - 1}
                  onApplySelection={applySelectionFromChat}
                />
              ))
            )}
          </div>

          {chatError ? (
            <p className="border-t border-line bg-bg px-2.5 py-1.5 text-[12px] text-accent">{chatError}</p>
          ) : null}

          {panelTab === "chat" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
              className="flex gap-1.5 border-t border-line p-2"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Paste a job description or ask something…"
                disabled={busy}
                className="min-w-0 flex-1 rounded-xl border border-line bg-bg px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
              />
              <button
                type="submit"
                disabled={busy || !input.trim()}
                className="flex shrink-0 items-center gap-1.5 rounded-xl bg-accent px-2.5 py-1.5 text-[12px] font-medium text-accent-ink transition-opacity disabled:opacity-40"
              >
                <SendIcon />
                Send
              </button>
            </form>
          ) : (
            <ChatHistoryFooter
              label="Full conversation with the career agent"
              onClear={clearChat}
              disabled={historyMessages.length === 0}
            />
          )}
        </AgentPanel>
      </div>

    </main>
  );
}
