import { useEffect, useMemo, useRef, useState } from "react";
import { AgentMarkdown } from "../components/AgentMarkdown";
import { AgentPanel } from "../components/AgentPanel";
import { CatalogPanel } from "../components/CatalogPanel";
import { ChatHistoryFooter, ChatTabs } from "../components/ChatTabs";
import { CourseActions } from "../components/CourseActions";
import { ModeToggle, type AgentMode } from "../components/ModeToggle";
import { ThinkingDots } from "../components/ThinkingDots";
import { WeekGrid, type GridSelection, type PreviewSelection } from "../components/WeekGrid";
import { apiDelete, apiGet, apiGetCached, apiPost, apiPostStream } from "../lib/api";
import {
  DAY_LABELS,
  addDays,
  clampDate,
  formatWeekRange,
  mondayOf,
  parseISODate,
} from "../lib/time";
import { usePlanner } from "../lib/PlannerContext";
import type { Plan, SectionActionPayload, Term } from "../lib/types";

type Mode = AgentMode;
type ChatMessage = { role: "user" | "assistant"; content: string };
type Segment =
  | { kind: "text"; text: string }
  | { kind: "suggest" | "applied" | "removed"; data: SectionActionPayload };

const STARTERS = [
  "What's on my calendar right now?",
  "Does COMP2711 clash with COMP3511?",
  "Find a COMP lecture that fits",
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

function previewFromAction(data: SectionActionPayload): PreviewSelection[] {
  return [
    {
      course_code: data.course_code,
      section_code: data.section_code,
      meetings: data.meetings ?? [],
    },
  ];
}

function previewMatches(preview: PreviewSelection[] | null, data: SectionActionPayload): boolean {
  return Boolean(
    preview?.some((item) => item.course_code === data.course_code && item.section_code === data.section_code),
  );
}

function SectionCard({
  kind,
  data,
  applied,
  previewing,
  onApply,
  onPreview,
}: {
  kind: "suggest" | "applied" | "removed";
  data: SectionActionPayload;
  applied: boolean;
  previewing: boolean;
  onApply: (data: SectionActionPayload) => void;
  onPreview: (data: SectionActionPayload) => void;
}) {
  if (data.error) {
    return <p className="rounded-xl border border-line bg-bg px-3 py-2 text-[13px] text-muted">{data.error}</p>;
  }

  const meeting = data.meetings?.[0];
  const isApplied = kind === "applied" || applied;
  const isRemoved = kind === "removed";
  const replacing = data.replaces_course_code
    ? `${data.replaces_course_code}${data.replaces_section_code ? ` ${data.replaces_section_code}` : ""}`
    : null;

  return (
    <div
      className={`rounded-xl border bg-surface-raised px-3 py-2.5 text-[13px] ${
        previewing ? "border-accent" : "border-line"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => onPreview(data)} className="min-w-0 flex-1 text-left">
          <p className="font-mono font-medium">
            {data.course_code} {data.section_code}
          </p>
          {replacing ? <p className="mt-0.5 text-[12px] text-muted">Replaces {replacing}</p> : null}
          {meeting?.weekday && meeting.start_time && meeting.end_time ? (
            <p className="mt-0.5 text-[12px] text-muted tabular-nums">
              {DAY_LABELS[meeting.weekday] ?? meeting.weekday} {meeting.start_time.slice(0, 5)}–
              {meeting.end_time.slice(0, 5)}
              {meeting.venue ? ` · ${meeting.venue}` : ""}
            </p>
          ) : null}
        </button>
        {isRemoved ? (
          <span className="shrink-0 text-[12px] text-muted">Removed</span>
        ) : isApplied ? (
          <span className="shrink-0 text-[12px] font-medium text-accent">{replacing ? "Replaced" : "Added"}</span>
        ) : (
          <button
            onClick={() => onApply(data)}
            className="shrink-0 rounded-xl bg-ink px-2.5 py-1 text-[12px] font-medium text-bg hover:bg-ink/90"
          >
            {replacing ? "Replace" : "Apply"}
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
  preview,
  onApply,
  onPreview,
}: {
  message: ChatMessage;
  pending: boolean;
  appliedKeys: Set<string>;
  preview: PreviewSelection[] | null;
  onApply: (data: SectionActionPayload) => void;
  onPreview: (data: SectionActionPayload) => void;
}) {
  if (message.role === "user") {
    return (
      <div className="ml-auto max-w-[85%] rounded-xl bg-ink px-3 py-2 text-[13px] text-bg">
        {message.content}
      </div>
    );
  }

  const segments = parseSegments(message.content);
  if (segments.length === 0) {
    return pending ? <ThinkingDots /> : null;
  }

  return (
    <div className="mr-auto flex max-w-[85%] flex-col gap-2">
      {segments.map((seg, i) =>
        seg.kind === "text" ? (
          <AgentMarkdown key={i}>{seg.text}</AgentMarkdown>
        ) : (
          <SectionCard
            key={i}
            kind={seg.kind}
            data={seg.data}
            applied={appliedKeys.has(`${seg.data.course_code}|${seg.data.section_code}`)}
            previewing={previewMatches(preview, seg.data)}
            onApply={onApply}
            onPreview={onPreview}
          />
        ),
      )}
      {pending ? <ThinkingDots boxed={false} /> : null}
    </div>
  );
}

export function TimetablePage() {
  const { plannerId } = usePlanner();
  const scrollRef = useRef<HTMLDivElement>(null);

  const [plan, setPlan] = useState<Plan | null>(null);
  const [terms, setTerms] = useState<Term[]>([]);
  const [weekStart, setWeekStart] = useState<Date>(() => mondayOf(new Date()));
  const [mode, setMode] = useState<Mode>("suggest");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatLoaded, setChatLoaded] = useState(false);
  const [panelTab, setPanelTab] = useState<"chat" | "history">("chat");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appliedKeys, setAppliedKeys] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<GridSelection | null>(null);
  const [preview, setPreview] = useState<PreviewSelection[] | null>(null);

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

  function applyPlanUpdate(next?: Plan) {
    if (next) setPlan(next);
    else void refreshPlan();
  }

  useEffect(() => {
    let cancelled = false;
    setMessages([]);
    setAppliedKeys(new Set());
    setPreview(null);
    setSelected(null);
    setError(null);
    apiGet<Plan>(`/api/plan?planner_id=${plannerId}`)
      .then((next) => {
        if (!cancelled) setPlan(next);
      })
      .catch(() => {
        // backend may not be running yet — the grid just stays empty
      });
    apiGetCached<Term[]>("/api/term")
      .then((next) => {
        if (!cancelled) setTerms(next);
      })
      .catch(() => {
        // no terms yet — the calendar still shows, just anchored on today with no nav bounds
      });
    setChatLoaded(false);
    apiGet<{ messages: ChatMessage[] }>(`/api/timetable/chat?planner_id=${plannerId}`)
      .then((res) => {
        if (!cancelled) setMessages(res.messages);
      })
      .catch(() => {
        // backend may not be running yet — chat just starts empty
      })
      .finally(() => {
        if (!cancelled) setChatLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [plannerId]);

  async function clearChat() {
    setMessages([]);
    try {
      await apiDelete(`/api/timetable/chat?planner_id=${plannerId}`);
    } catch {
      // best-effort — local state is already cleared
    }
  }

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
      const result = await apiPost<SectionActionPayload>("/api/timetable/apply", {
        planner_id: plannerId,
        course_code: data.course_code,
        section_code: data.section_code,
        term_code: data.term_code,
        replaces_course_code: data.replaces_course_code,
        replaces_section_code: data.replaces_section_code,
      });
      setAppliedKeys((prev) => new Set(prev).add(`${data.course_code}|${data.section_code}`));
      setPreview(null);
      applyPlanUpdate(result.plan);
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
    <main className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <h1 className="text-[15px] font-semibold tracking-tight">Timetable</h1>
        <div className="inline-flex rounded-xl border border-line bg-bg p-0.5 text-[12px]">
          <button
            onClick={() => setWeekStart((w) => clampDate(addDays(w, -7), bounds.min, bounds.max))}
            disabled={bounds.min !== null && weekStart <= bounds.min}
            className="rounded-[5px] px-2 py-0.5 text-muted hover:bg-surface-raised hover:text-ink disabled:opacity-30"
          >
            Prev
          </button>
          <button
            onClick={() => setWeekStart(clampDate(mondayOf(new Date()), bounds.min, bounds.max))}
            className="rounded-[5px] px-2 py-0.5 text-muted hover:bg-surface-raised hover:text-ink"
          >
            Today
          </button>
          <button
            onClick={() => setWeekStart((w) => clampDate(addDays(w, 7), bounds.min, bounds.max))}
            disabled={bounds.max !== null && weekStart >= bounds.max}
            className="rounded-[5px] px-2 py-0.5 text-muted hover:bg-surface-raised hover:text-ink disabled:opacity-30"
          >
            Next
          </button>
        </div>
        <p className="font-mono text-[12px] text-muted tabular-nums">{formatWeekRange(weekStart)}</p>
        <div className="ml-auto flex items-center gap-2">
          <ModeToggle mode={mode} onChange={setMode} />
          <a
            href={`/api/plan.ics?planner_id=${plannerId}`}
            className="rounded-xl border border-line bg-surface-raised px-2 py-1 text-[12px] font-medium hover:bg-fill"
          >
            .ics
          </a>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-2 bg-bg p-2 lg:flex-row lg:gap-3 lg:p-3">
        <CatalogPanel plannerId={plannerId} plan={plan} onApplied={applyPlanUpdate} onPreview={setPreview} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line shadow-soft">
          {selected ? (
            <CourseActions
              plannerId={plannerId}
              plan={plan}
              selected={selected}
              onClose={() => setSelected(null)}
              onChanged={applyPlanUpdate}
            />
          ) : null}
          <WeekGrid
            selections={plan?.class_selections ?? []}
            weekStart={weekStart}
            selectedCourse={selected?.course_code ?? null}
            preview={preview}
            onSelect={(next) => {
              if (!next) {
                setSelected(null);
                return;
              }
              setSelected((cur) =>
                cur && cur.course_code === next.course_code && cur.section_code === next.section_code
                  ? null
                  : next,
              );
            }}
          />
        </div>

        <AgentPanel>
          <ChatTabs tab={panelTab} onChange={setPanelTab} historyCount={messages.length} />

          <div
            ref={scrollRef}
            className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2.5"
          >
            {!chatLoaded ? (
              <p className="text-[12px] text-muted">Loading chat…</p>
            ) : messages.length === 0 ? (
              panelTab === "history" ? (
                <p className="text-[12px] text-muted">No conversation yet with the timetable agent.</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <p className="text-[12px] text-muted">Ask about a class</p>
                  {STARTERS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="rounded-xl border border-line px-2.5 py-1.5 text-left text-[12px] hover:bg-bg"
                    >
                      {s}
                    </button>
                  ))}
                  <p className="pt-1 text-[11px] leading-4 text-muted">
                    {mode === "suggest"
                      ? "Suggest mode: click Apply to put a class on the calendar."
                      : "Auto apply: the agent adds a class as soon as it finds a fit."}
                  </p>
                </div>
              )
            ) : (
              messages.map((m, i) => (
                <ChatBubble
                  key={i}
                  message={m}
                  pending={busy && panelTab === "chat" && i === messages.length - 1}
                  appliedKeys={appliedKeys}
                  preview={preview}
                  onApply={applySuggestion}
                  onPreview={(data) => {
                    setPreview((cur) => (previewMatches(cur, data) ? null : previewFromAction(data)));
                  }}
                />
              ))
            )}
          </div>

          {error ? (
            <p className="border-t border-line bg-bg px-2.5 py-1.5 text-[12px] text-accent">{error}</p>
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
                placeholder="Ask about classes…"
                disabled={busy}
                className="min-w-0 flex-1 rounded-xl border border-line bg-bg px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
              />
              <button
                type="submit"
                disabled={busy || !input.trim()}
                className="shrink-0 rounded-xl bg-ink px-2.5 py-1.5 text-[12px] font-medium text-bg disabled:opacity-40"
              >
                Send
              </button>
            </form>
          ) : (
            <ChatHistoryFooter
              label="Full conversation with the timetable agent"
              onClear={clearChat}
              disabled={messages.length === 0}
            />
          )}
        </AgentPanel>
      </div>
    </main>
  );
}
