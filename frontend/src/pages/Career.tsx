import { useEffect, useRef, useState } from "react";
import { AgentPanel } from "../components/AgentPanel";
import { apiDelete, apiGet, apiPost, apiPostStream } from "../lib/api";
import { usePlanner } from "../lib/PlannerContext";
import type { CourseMatch, Experience, JobMatchResult } from "../lib/types";

const KIND_OPTIONS = [
  { value: "internship", label: "Internship" },
  { value: "job", label: "Job" },
  { value: "project", label: "Project" },
];

const STARTERS = [
  "Here's a job posting — what should I take?",
  "What have I already logged?",
  "I did a data analyst internship last summer, can you log it?",
];

function formatRange(start: string | null, end: string | null): string {
  if (!start && !end) return "";
  return `${start ?? "?"} – ${end ?? "present"}`;
}

function CourseMatchCard({ course }: { course: CourseMatch }) {
  return (
    <div className="rounded-md border border-line bg-bg px-3 py-2.5 text-[13px]">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono font-medium">
          {course.course_code} <span className="font-sans font-normal text-muted">· {course.credits} cr</span>
        </p>
        {course.in_major ? (
          <span className="shrink-0 text-[11px] font-medium text-accent">In your major</span>
        ) : course.status === "completed" ? (
          <span className="shrink-0 text-[11px] text-muted">Completed</span>
        ) : null}
      </div>
      <p className="mt-0.5 text-[12px] text-muted">{course.title}</p>
      {course.matched_terms.length > 0 ? (
        <p className="mt-1.5 flex flex-wrap gap-1">
          {course.matched_terms.map((term) => (
            <span key={term} className="rounded bg-fill px-1.5 py-0.5 text-[11px] text-ink">
              {term}
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}

function JobMatchCard({ data }: { data: JobMatchResult }) {
  if (data.error) {
    return <p className="rounded-md border border-line bg-bg px-3 py-2 text-[13px] text-muted">{data.error}</p>;
  }
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-surface-raised px-3 py-2.5">
      {data.already_relevant.length > 0 ? (
        <div>
          <p className="mb-1.5 text-[11px] font-medium text-muted">Already covered by courses you've taken</p>
          <div className="flex flex-col gap-1.5">
            {data.already_relevant.map((c) => (
              <CourseMatchCard key={c.course_code} course={c} />
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
              <CourseMatchCard key={c.course_code} course={c} />
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

function ChatBubble({ message, pending }: { message: ChatMessage; pending: boolean }) {
  if (message.role === "user") {
    return (
      <div className="ml-auto max-w-[90%] rounded-md bg-ink px-3 py-2 text-[13px] text-bg whitespace-pre-wrap">
        {message.content}
      </div>
    );
  }

  const segments = parseSegments(message.content);
  if (segments.length === 0) {
    return pending ? (
      <div className="mr-auto max-w-[90%] rounded-md bg-bg px-3 py-2 text-[13px] text-muted">…</div>
    ) : null;
  }

  return (
    <div className="mr-auto flex max-w-[90%] flex-col gap-2">
      {segments.map((seg, i) => {
        if (seg.kind === "text") {
          return (
            <p key={i} className="rounded-md bg-bg px-3 py-2 text-[13px] leading-5 whitespace-pre-wrap">
              {seg.text.trim()}
            </p>
          );
        }
        if (seg.kind === "job_match") {
          return <JobMatchCard key={i} data={seg.data} />;
        }
        if (seg.kind === "experience_added") {
          return (
            <p key={i} className="rounded-md border border-line bg-bg px-3 py-2 text-[12px] text-accent">
              Logged: {seg.data.title}
            </p>
          );
        }
        return (
          <p key={i} className="rounded-md border border-line bg-bg px-3 py-2 text-[12px] text-muted">
            Removed
          </p>
        );
      })}
    </div>
  );
}

export function CareerPage() {
  const { plannerId } = usePlanner();
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

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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
    return () => {
      cancelled = true;
    };
  }, [plannerId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

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
    setExperiences((prev) => prev.filter((exp) => exp.id !== id));
    try {
      await apiDelete(`/api/career/experiences/${id}?planner_id=${plannerId}`);
    } catch {
      setError("Couldn't remove that — refreshing.");
      refreshExperiences();
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
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <h1 className="text-[15px] font-semibold tracking-tight">Career</h1>
        <span className="text-[12px] text-muted">Internships, jobs, and what to take next</span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section className="min-h-0 min-w-0 flex-1 overflow-auto border-b border-line lg:border-r lg:border-b-0">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <h2 className="text-[13px] font-medium">Experience</h2>
            <button
              onClick={() => setShowForm((v) => !v)}
              className="rounded-md bg-ink px-2.5 py-1 text-[12px] font-medium text-bg hover:bg-ink/90"
            >
              {showForm ? "Cancel" : "Add experience"}
            </button>
          </div>

          {showForm ? (
            <form onSubmit={addExperience} className="flex flex-col gap-2 border-b border-line px-3 py-3">
              <div className="flex flex-wrap gap-2">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Title (e.g. Software Engineering Intern)"
                  required
                  className="min-w-[14rem] flex-1 rounded-md border border-line bg-bg px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
                />
                <input
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  placeholder="Organization"
                  className="min-w-[10rem] flex-1 rounded-md border border-line bg-bg px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
                />
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                  className="rounded-md border border-line bg-bg px-2.5 py-1.5 text-[13px]"
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
                  className="rounded-md border border-line bg-bg px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
                />
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="rounded-md border border-line bg-bg px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
                />
              </div>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What did you actually do? (used to line up with future job descriptions)"
                rows={3}
                className="rounded-md border border-line bg-bg px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
              />
              <button
                type="submit"
                disabled={saving || !title.trim()}
                className="self-start rounded-md bg-ink px-2.5 py-1.5 text-[12px] font-medium text-bg disabled:opacity-40"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </form>
          ) : null}

          {loading ? (
            <p className="px-3 py-6 text-[13px] text-muted">Loading…</p>
          ) : experiences.length === 0 ? (
            <p className="px-3 py-6 text-[13px] text-muted">
              No internships or jobs added yet. Add one, or just tell the agent about it, so we can match
              your background against real job descriptions.
            </p>
          ) : (
            <ul>
              {experiences.map((exp) => (
                <li key={exp.id} className="border-t border-line px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium">
                        {exp.title}
                        {exp.organization ? <span className="font-normal text-muted"> · {exp.organization}</span> : null}
                      </p>
                      <p className="text-[11px] text-muted">
                        {exp.kind}
                        {formatRange(exp.start_date, exp.end_date) ? ` · ${formatRange(exp.start_date, exp.end_date)}` : ""}
                      </p>
                      {exp.description ? (
                        <p className="mt-1 text-[12px] leading-5 text-ink">{exp.description}</p>
                      ) : null}
                    </div>
                    <button
                      onClick={() => removeExperience(exp.id)}
                      className="shrink-0 text-[12px] text-muted hover:text-accent"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {error ? <p className="px-3 py-2 text-[12px] text-accent">{error}</p> : null}
        </section>

        <AgentPanel>
          <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
            {messages.length === 0 ? (
              <div className="flex flex-col gap-2">
                <p className="text-[12px] text-muted">
                  Paste a job description, or tell it about past experience
                </p>
                {STARTERS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="text-left text-[13px] leading-5 text-ink hover:underline"
                  >
                    {s}
                  </button>
                ))}
              </div>
            ) : (
              messages.map((m, i) => (
                <ChatBubble key={i} message={m} pending={busy && i === messages.length - 1} />
              ))
            )}
          </div>

          {chatError ? (
            <p className="border-t border-line bg-bg px-2.5 py-1.5 text-[12px] text-accent">{chatError}</p>
          ) : null}

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
              className="flex-1 rounded-md border border-line bg-bg px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="rounded-md bg-ink px-2.5 py-1.5 text-[12px] font-medium text-bg disabled:opacity-40"
            >
              Send
            </button>
          </form>
        </AgentPanel>
      </div>
    </main>
  );
}
