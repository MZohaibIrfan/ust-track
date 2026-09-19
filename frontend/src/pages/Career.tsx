import { useEffect, useRef, useState, type ReactNode } from "react";
import { AgentMarkdown } from "../components/AgentMarkdown";
import { AgentPanel } from "../components/AgentPanel";
import { ChatHistoryFooter, ChatTabs } from "../components/ChatTabs";
import { CareerIcon } from "../components/NavIcons";
import { apiDelete, apiGet, apiPost, apiPostStream } from "../lib/api";
import { getPlannerId } from "../lib/planner";
import type { CourseMatch, Experience, JobMatchResult } from "../lib/types";

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

const KIND_META: Record<string, { label: string; icon: ReactNode }> = {
  internship: {
    label: "Internship",
    icon: (
      <Icon>
        <rect x="2" y="7" width="20" height="14" rx="2" />
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
      </Icon>
    ),
  },
  job: {
    label: "Job",
    icon: (
      <Icon>
        <path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h1m4 0h1m-6 4h1m4 0h1m-6 4h1m4 0h1" />
      </Icon>
    ),
  },
  project: {
    label: "Project",
    icon: (
      <Icon>
        <path d="m12 2 9 5-9 5-9-5 9-5Z" />
        <path d="m3 12 9 5 9-5M3 17l9 5 9-5" />
      </Icon>
    ),
  },
};

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
    </div>
  );
}

type ChatMessage = { role: "user" | "assistant"; content: string };
type Segment =
  | { kind: "text"; text: string }
  | { kind: "job_match"; data: JobMatchResult }
  | { kind: "experience_added"; data: { ok: boolean; title: string } }
  | { kind: "experience_removed"; data: { ok: boolean; removed: boolean } };

const MARKER_RE = /<<(JOB_MATCH|EXPERIENCE_ADDED|EXPERIENCE_REMOVED):([A-Za-z0-9+/=]+)>>/g;

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

function ChatBubble({ message, pending }: { message: ChatMessage; pending: boolean }) {
  if (message.role === "user") {
    return (
      <div className="ml-auto max-w-[90%] rounded-xl bg-ink px-3 py-2 text-[13px] text-bg whitespace-pre-wrap">
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
  const plannerId = getPlannerId();
  const [experiences, setExperiences] = useState<Experience[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [organization, setOrganization] = useState("");
  const [kind, setKind] = useState("internship");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatLoaded, setChatLoaded] = useState(false);
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
    refreshExperiences();
    apiGet<{ messages: ChatMessage[] }>(`/api/career/chat?planner_id=${plannerId}`)
      .then((res) => setMessages(res.messages))
      .catch(() => {
        // backend may not be running yet — chat just starts empty
      })
      .finally(() => setChatLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, panelTab]);

  async function clearChat() {
    setMessages([]);
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
        kind,
        start_date: startDate || null,
        end_date: endDate || null,
        description,
      });
      setTitle("");
      setOrganization("");
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
    } catch {
      setChatError("Couldn't reach the career agent. Check the server is running.");
      setMessages(next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-2.5 border-b border-line px-3 py-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-xl bg-page-career/15 text-page-career">
          <CareerIcon className="size-4" />
        </span>
        <div className="min-w-0">
          <h1 className="text-[15px] font-semibold tracking-tight">Career</h1>
          <p className="text-[11px] text-muted">Internships, jobs, and what to take next</p>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-2 bg-bg p-2 lg:flex-row lg:gap-3 lg:p-3">
        <section className="min-h-0 min-w-0 flex-1 overflow-auto rounded-2xl border border-line bg-surface-raised shadow-soft">
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
                showForm ? "bg-fill text-ink hover:bg-line" : "bg-ink text-bg hover:bg-ink/90"
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
                  placeholder="Organization"
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
                placeholder="What did you actually do? (used to line up with future job descriptions)"
                rows={3}
                className="rounded-xl border border-line bg-surface-raised px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
              />
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={saving || !title.trim()}
                  className="self-start rounded-xl bg-ink px-3 py-1.5 text-[12px] font-medium text-bg transition-opacity disabled:opacity-40"
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
                No internships or jobs added yet. Add one, or just tell the agent about it, so we can match
                your background against real job descriptions.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2 p-2.5">
              {experiences.map((exp) => {
                const meta = KIND_META[exp.kind] ?? KIND_META.internship;
                return (
                  <li
                    key={exp.id}
                    className="group flex items-start gap-2.5 rounded-2xl border border-line bg-bg px-3.5 py-3 shadow-soft transition-all hover:-translate-y-0.5 hover:border-page-career/40 hover:shadow-soft-lg"
                  >
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-xl bg-page-career/15 text-page-career">
                      {meta.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[13px] font-medium">
                          {exp.title}
                          {exp.organization ? (
                            <span className="font-normal text-muted"> · {exp.organization}</span>
                          ) : null}
                        </p>
                        <button
                          onClick={() => removeExperience(exp.id)}
                          disabled={removingId === exp.id}
                          className="shrink-0 rounded p-1 text-muted opacity-0 transition-opacity hover:bg-fill hover:text-accent group-hover:opacity-100 disabled:opacity-40"
                          aria-label="Remove experience"
                        >
                          <TrashIcon />
                        </button>
                      </div>
                      <p className="text-[11px] text-muted">
                        {meta.label}
                        {formatRange(exp.start_date, exp.end_date) ? ` · ${formatRange(exp.start_date, exp.end_date)}` : ""}
                      </p>
                      {exp.description ? (
                        <p className="mt-1 text-[12px] leading-5 text-ink">{exp.description}</p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {error ? <p className="px-3 py-2 text-[12px] text-accent">{error}</p> : null}
        </section>

        <AgentPanel>
          <ChatTabs
            tab={panelTab}
            onChange={setPanelTab}
            historyCount={messages.length}
            icon={
              <span className="text-page-career">
                <SparkleIcon />
              </span>
            }
          />

          <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
            {!chatLoaded ? (
              <p className="text-[12px] text-muted">Loading chat…</p>
            ) : messages.length === 0 ? (
              panelTab === "history" ? (
                <p className="text-[12px] text-muted">No conversation yet with the career agent.</p>
              ) : (
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
              )
            ) : (
              messages.map((m, i) => (
                <ChatBubble key={i} message={m} pending={busy && panelTab === "chat" && i === messages.length - 1} />
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
                className="flex shrink-0 items-center gap-1.5 rounded-xl bg-ink px-2.5 py-1.5 text-[12px] font-medium text-bg transition-opacity disabled:opacity-40"
              >
                <SendIcon />
                Send
              </button>
            </form>
          ) : (
            <ChatHistoryFooter
              label="Full conversation with the career agent"
              onClear={clearChat}
              disabled={messages.length === 0}
            />
          )}
        </AgentPanel>
      </div>
    </main>
  );
}
