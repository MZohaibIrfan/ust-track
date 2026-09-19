import { useEffect, useMemo, useRef, useState } from "react";
import { WeekGrid } from "../components/WeekGrid";
import { apiGet, apiPost, apiPostStream } from "../lib/api";
import {
  DAY_LABELS,
  addDays,
  clampDate,
  formatWeekRange,
  mondayOf,
  parseISODate,
} from "../lib/time";
import { getPlannerId } from "../lib/planner";
import type { Plan, SectionActionPayload, Term } from "../lib/types";

type Mode = "suggest" | "auto";
type ChatMessage = { role: "user" | "assistant"; content: string };
type Segment =
  | { kind: "text"; text: string }
  | { kind: "suggest" | "applied" | "removed"; data: SectionActionPayload };

const STARTERS = [
  "Put COMP2011 on my calendar",
  "What's on my calendar right now?",
  "Find a calculus class",
];

const MARKER_RE = /<<(SUGGEST|APPLIED|REMOVED):([A-Za-z0-9+/=]+)>>/g;

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
      const data = JSON.parse(atob(match[2])) as SectionActionPayload;
      segments.push({ kind: match[1].toLowerCase() as "suggest" | "applied" | "removed", data });
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

function describeConflict(entry: SectionActionPayload["conflicts"][number], courseCode: string): string {
  return entry.a === courseCode ? `${entry.b} ${entry.b_section}` : `${entry.a} ${entry.a_section}`;
}

function SectionCard({
  kind,
  data,
  applied,
  onApply,
}: {
  kind: "suggest" | "applied" | "removed";
  data: SectionActionPayload;
  applied: boolean;
  onApply: (data: SectionActionPayload) => void;
}) {
  if (data.error) {
    return <p className="border border-line bg-surface px-4 py-3 text-sm text-muted">{data.error}</p>;
  }

  const meeting = data.meetings?.[0];
  const isApplied = kind === "applied" || applied;
  const isRemoved = kind === "removed";

  return (
    <div className="border border-line bg-surface px-4 py-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono font-medium">
            {data.course_code} {data.section_code}
          </p>
          {meeting?.weekday && meeting.start_time && meeting.end_time ? (
            <p className="mt-0.5 text-xs text-muted">
              {DAY_LABELS[meeting.weekday] ?? meeting.weekday} {meeting.start_time.slice(0, 5)}–
              {meeting.end_time.slice(0, 5)}
              {meeting.venue ? ` · ${meeting.venue}` : ""}
            </p>
          ) : null}
        </div>
        {isRemoved ? (
          <span className="shrink-0 text-xs text-muted">Removed</span>
        ) : isApplied ? (
          <span className="shrink-0 text-xs font-medium text-accent">Added ✓</span>
        ) : (
          <button
            onClick={() => onApply(data)}
            className="shrink-0 bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink transition-opacity hover:opacity-90"
          >
            Apply
          </button>
        )}
      </div>
      {data.conflicts?.length ? (
        <p className="mt-2 text-xs text-accent">
          Conflicts with {data.conflicts.map((c) => describeConflict(c, data.course_code)).join(", ")}
        </p>
      ) : null}
    </div>
  );
}

function ChatBubble({
  message,
  pending,
  appliedKeys,
  onApply,
}: {
  message: ChatMessage;
  pending: boolean;
  appliedKeys: Set<string>;
  onApply: (data: SectionActionPayload) => void;
}) {
  if (message.role === "user") {
    return (
      <div className="ml-auto max-w-[85%] bg-accent px-4 py-3 text-sm text-accent-ink">
        {message.content}
      </div>
    );
  }

  const segments = parseSegments(message.content);
  if (segments.length === 0) {
    return pending ? (
      <div className="mr-auto max-w-[85%] bg-accent-soft px-4 py-3 text-sm">…</div>
    ) : null;
  }

  return (
    <div className="mr-auto flex max-w-[85%] flex-col gap-2">
      {segments.map((seg, i) =>
        seg.kind === "text" ? (
          <p key={i} className="whitespace-pre-wrap bg-accent-soft px-4 py-3 text-sm leading-6">
            {seg.text.trim()}
          </p>
        ) : (
          <SectionCard
            key={i}
            kind={seg.kind}
            data={seg.data}
            applied={appliedKeys.has(`${seg.data.course_code}|${seg.data.section_code}`)}
            onApply={onApply}
          />
        ),
      )}
    </div>
  );
}

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div className="inline-flex border border-line text-sm">
      <button
        onClick={() => onChange("suggest")}
        className={`px-3 py-1.5 transition-colors ${
          mode === "suggest" ? "bg-accent text-accent-ink" : "text-muted hover:bg-accent-soft"
        }`}
      >
        Suggest
      </button>
      <button
        onClick={() => onChange("auto")}
        className={`px-3 py-1.5 transition-colors ${
          mode === "auto" ? "bg-accent text-accent-ink" : "text-muted hover:bg-accent-soft"
        }`}
      >
        Auto apply
      </button>
    </div>
  );
}

export function TimetablePage() {
  const plannerId = useRef(getPlannerId()).current;
  const scrollRef = useRef<HTMLDivElement>(null);

  const [plan, setPlan] = useState<Plan | null>(null);
  const [terms, setTerms] = useState<Term[]>([]);
  const [weekStart, setWeekStart] = useState<Date>(() => mondayOf(new Date()));
  const [mode, setMode] = useState<Mode>("suggest");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appliedKeys, setAppliedKeys] = useState<Set<string>>(new Set());

  // Bounds come from whatever terms the catalog actually has — nothing here is a fixed date.
  const bounds = useMemo(() => {
    const starts = terms.map((t) => t.start_date).filter((d): d is string => !!d).map(parseISODate);
    const ends = terms.map((t) => t.end_date).filter((d): d is string => !!d).map(parseISODate);
    if (starts.length === 0 || ends.length === 0) return { min: null, max: null };
    return {
      min: mondayOf(new Date(Math.min(...starts.map((d) => d.getTime())))),
      max: mondayOf(new Date(Math.max(...ends.map((d) => d.getTime())))),
    };
  }, [terms]);

  async function refreshPlan() {
    try {
      setPlan(await apiGet<Plan>(`/api/plan?planner_id=${plannerId}`));
    } catch {
      // backend may not be running yet — the grid just stays empty
    }
  }

  useEffect(() => {
    refreshPlan();
    apiGet<Term[]>("/api/term")
      .then(setTerms)
      .catch(() => {
        // no terms yet — the calendar still shows, just anchored on today with no nav bounds
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once term bounds are known, snap an out-of-range default week into the real catalog window.
  useEffect(() => {
    if (!bounds.min || !bounds.max) return;
    setWeekStart((current) => clampDate(current, bounds.min, bounds.max));
  }, [bounds]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function applySuggestion(data: SectionActionPayload) {
    try {
      await apiPost("/api/timetable/apply", {
        planner_id: plannerId,
        course_code: data.course_code,
        section_code: data.section_code,
        term_code: data.term_code,
      });
      setAppliedKeys((prev) => new Set(prev).add(`${data.course_code}|${data.section_code}`));
      refreshPlan();
    } catch {
      setError("Couldn't apply that suggestion — check the server is running.");
    }
  }

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setError(null);
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages([...next, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);

    try {
      const res = await apiPostStream("/api/timetable/advisor", {
        messages: next,
        planner_id: plannerId,
        mode,
      });
      if (!res.ok || !res.body) {
        setError(await res.text());
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
      refreshPlan();
    } catch {
      setError("Couldn't reach the timetable agent. Check the server is running.");
      setMessages(next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-8 sm:py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold">Timetable</h1>
          <p className="mt-1 text-muted">Real class sections, from the catalog to your calendar.</p>
        </div>
        <a
          href={`/api/plan.ics?planner_id=${plannerId}`}
          className="border border-line bg-surface px-4 py-2 text-sm transition-colors hover:bg-accent-soft"
        >
          Download .ics
        </a>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex border border-line text-sm">
          <button
            onClick={() => setWeekStart((w) => clampDate(addDays(w, -7), bounds.min, bounds.max))}
            disabled={bounds.min !== null && weekStart <= bounds.min}
            className="px-3 py-1.5 text-muted transition-colors hover:bg-accent-soft hover:text-ink disabled:opacity-30"
          >
            ← Prev
          </button>
          <button
            onClick={() => setWeekStart(clampDate(mondayOf(new Date()), bounds.min, bounds.max))}
            className="border-x border-line px-3 py-1.5 text-muted transition-colors hover:bg-accent-soft hover:text-ink"
          >
            Today
          </button>
          <button
            onClick={() => setWeekStart((w) => clampDate(addDays(w, 7), bounds.min, bounds.max))}
            disabled={bounds.max !== null && weekStart >= bounds.max}
            className="px-3 py-1.5 text-muted transition-colors hover:bg-accent-soft hover:text-ink disabled:opacity-30"
          >
            Next →
          </button>
        </div>
        <p className="font-mono text-sm text-muted">{formatWeekRange(weekStart)}</p>
      </div>

      <WeekGrid selections={plan?.class_selections ?? []} weekStart={weekStart} />

      <section className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <div className="flex flex-col border border-line bg-surface">
          <div
            ref={scrollRef}
            className="flex flex-1 flex-col gap-3 overflow-y-auto p-4"
            style={{ minHeight: "20rem", maxHeight: "50vh" }}
          >
            {messages.length === 0 ? (
              <div className="m-auto flex flex-col items-center gap-3 text-center">
                <p className="text-sm text-muted">Try asking:</p>
                <div className="flex flex-col gap-2">
                  {STARTERS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="border border-line px-4 py-2 text-sm transition-colors hover:bg-accent-soft"
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
                  appliedKeys={appliedKeys}
                  onApply={applySuggestion}
                />
              ))
            )}
          </div>

          {error ? <p className="border-t border-line bg-accent-soft px-4 py-3 text-sm">{error}</p> : null}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex gap-2 border-t border-line p-3"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about classes or your calendar…"
              disabled={busy}
              className="flex-1 border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-opacity disabled:opacity-40"
            >
              Send
            </button>
          </form>
        </div>

        <div className="flex flex-col gap-3 border border-line bg-surface p-4">
          <p className="text-sm font-medium">Agent mode</p>
          <ModeToggle mode={mode} onChange={setMode} />
          <p className="text-xs leading-5 text-muted">
            {mode === "suggest"
              ? "The agent proposes a class — click Apply to put it on the calendar."
              : "The agent adds classes to the calendar itself as soon as it finds a good option."}
          </p>
        </div>
      </section>
    </main>
  );
}
