import { useEffect, useRef, useState } from "react";
import { ModeToggle, type AgentMode } from "../components/ModeToggle";
import { RequirementGroup } from "../components/RequirementTree";
import { apiGet, apiPost, apiPostStream } from "../lib/api";
import type { DegreeProfile, ProgramActionPayload, RequirementProgress } from "../lib/types";

// Fixed demo identity for now — the pathway builder needs a student with real
// course history to reason against, and there's no auth/onboarding yet.
const DEMO_PLANNER_ID = "demo-student";

type ChatMessage = { role: "user" | "assistant"; content: string };
type Segment =
  | { kind: "text"; text: string }
  | { kind: "suggest" | "applied" | "removed"; data: ProgramActionPayload };

const STARTERS = [
  "What does my course history already count toward?",
  "Should I add the Mathematics minor?",
  "Compare my program options",
];

const MARKER_RE = /<<PROGRAM_(SUGGEST|APPLIED|REMOVED):([A-Za-z0-9+/=]+)>>/g;

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
      const data = JSON.parse(atob(match[2])) as ProgramActionPayload;
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

function ProgramCard({
  kind,
  data,
  applied,
  onApply,
}: {
  kind: "suggest" | "applied" | "removed";
  data: ProgramActionPayload;
  applied: boolean;
  onApply: (data: ProgramActionPayload) => void;
}) {
  if (data.error) {
    return <p className="border border-line bg-surface px-4 py-3 text-sm text-muted">{data.error}</p>;
  }

  const isApplied = kind === "applied" || applied;
  const isRemoved = kind === "removed";

  return (
    <div className="border border-line bg-surface px-4 py-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono font-medium">
            {data.code} <span className="text-muted">· {data.role}</span>
          </p>
          <p className="mt-0.5 text-xs text-muted">{data.name}</p>
        </div>
        {isRemoved ? (
          <span className="shrink-0 text-xs text-muted">Removed</span>
        ) : isApplied ? (
          <span className="shrink-0 text-xs font-medium text-accent">Declared ✓</span>
        ) : (
          <button
            onClick={() => onApply(data)}
            className="shrink-0 bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink transition-opacity hover:opacity-90"
          >
            Apply
          </button>
        )}
      </div>
      {data.overlaps?.length ? (
        <p className="mt-2 text-xs text-accent">
          Overlaps: {data.overlaps.map((o) => `${o.course_code} (${o.programs.join(" + ")})`).join(", ")}
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
  onApply: (data: ProgramActionPayload) => void;
}) {
  if (message.role === "user") {
    return (
      <div className="ml-auto max-w-[85%] bg-accent px-4 py-3 text-sm text-accent-ink">{message.content}</div>
    );
  }

  const segments = parseSegments(message.content);
  if (segments.length === 0) {
    return pending ? <div className="mr-auto max-w-[85%] bg-accent-soft px-4 py-3 text-sm">…</div> : null;
  }

  return (
    <div className="mr-auto flex max-w-[85%] flex-col gap-2">
      {segments.map((seg, i) =>
        seg.kind === "text" ? (
          <p key={i} className="whitespace-pre-wrap bg-accent-soft px-4 py-3 text-sm leading-6">
            {seg.text.trim()}
          </p>
        ) : (
          <ProgramCard
            key={i}
            kind={seg.kind}
            data={seg.data}
            applied={appliedKeys.has(seg.data.code)}
            onApply={onApply}
          />
        ),
      )}
    </div>
  );
}

export function DegreePage() {
  const scrollRef = useRef<HTMLDivElement>(null);

  const [profile, setProfile] = useState<DegreeProfile | null>(null);
  const [progressByCode, setProgressByCode] = useState<Record<string, RequirementProgress>>({});
  const [mode, setMode] = useState<AgentMode>("suggest");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appliedKeys, setAppliedKeys] = useState<Set<string>>(new Set());

  async function refreshProfile() {
    try {
      const p = await apiGet<DegreeProfile>(`/api/degree/profile?planner_id=${DEMO_PLANNER_ID}`);
      setProfile(p);
      const entries = await Promise.all(
        p.declared_programs
          .filter((d): d is { code: string; role: string; intake_year: number | null } => !!d.code)
          .map(async (d) => {
            const progress = await apiGet<RequirementProgress>(
              `/api/degree/progress?planner_id=${DEMO_PLANNER_ID}&program_code=${d.code}`,
            );
            return [d.code, progress] as const;
          }),
      );
      setProgressByCode(Object.fromEntries(entries));
    } catch {
      // backend may not be running yet
    }
  }

  useEffect(() => {
    refreshProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function applySuggestion(data: ProgramActionPayload) {
    try {
      await apiPost("/api/degree/apply", {
        planner_id: DEMO_PLANNER_ID,
        program_code: data.code,
        role: data.role,
      });
      setAppliedKeys((prev) => new Set(prev).add(data.code));
      refreshProfile();
    } catch {
      setError("Couldn't apply that — check the server is running.");
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
      const res = await apiPostStream("/api/degree/advisor", {
        messages: next,
        planner_id: DEMO_PLANNER_ID,
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
      refreshProfile();
    } catch {
      setError("Couldn't reach the degree agent. Check the server is running.");
      setMessages(next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-8 sm:py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold">Degree</h1>
          <p className="mt-1 text-muted">
            Program requirements and pathway trade-offs — checked against a real requirement tree, not estimated.
          </p>
        </div>
        <span className="border border-line bg-surface px-3 py-1.5 font-mono text-xs text-muted">
          Demo student · {DEMO_PLANNER_ID}
        </span>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted">My pathway</h2>
        {profile && profile.declared_programs.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2">
            {Object.entries(progressByCode).map(([code, progress]) => (
              <div key={code} className="flex flex-col gap-3">
                <p className="text-sm font-medium">
                  {progress.name} <span className="font-mono text-xs text-muted">({progress.summary})</span>
                </p>
                {progress.requirements.map((g, i) => (
                  <RequirementGroup key={i} group={g} />
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="border border-line bg-surface px-6 py-10 text-center text-sm text-muted">
            Nothing declared yet — ask the agent about your options below.
          </div>
        )}
        {profile && profile.courses.length > 0 ? (
          <p className="text-xs text-muted">
            Course history: {profile.courses.map((c) => `${c.course_code} (${c.status})`).join(", ")}
          </p>
        ) : null}
      </section>

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
              placeholder="Ask about programs, requirements, or trade-offs…"
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
          <ModeToggle mode={mode} onChange={setMode} autoLabel="Auto declare" />
          <p className="text-xs leading-5 text-muted">
            {mode === "suggest"
              ? "The agent proposes a program — click Apply to declare it."
              : "The agent declares a program itself once it's checked requirement fit and overlaps."}
          </p>
        </div>
      </section>
    </main>
  );
}
