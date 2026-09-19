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
    return (
      <p className="rounded-md border border-line bg-bg px-3 py-2 text-[13px] text-muted">{data.error}</p>
    );
  }

  const isApplied = kind === "applied" || applied;
  const isRemoved = kind === "removed";

  return (
    <div className="rounded-md border border-line bg-surface-raised px-3 py-2.5 text-[13px]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono font-medium">
            {data.code} <span className="text-muted">· {data.role}</span>
          </p>
          <p className="mt-0.5 text-[12px] text-muted">{data.name}</p>
        </div>
        {isRemoved ? (
          <span className="shrink-0 text-[12px] text-muted">Removed</span>
        ) : isApplied ? (
          <span className="shrink-0 text-[12px] font-medium text-accent">Declared</span>
        ) : (
          <button
            onClick={() => onApply(data)}
            className="shrink-0 rounded-md bg-ink px-2.5 py-1 text-[12px] font-medium text-bg hover:bg-ink/90"
          >
            Apply
          </button>
        )}
      </div>
      {data.overlaps?.length ? (
        <p className="mt-2 text-[12px] text-accent">
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
      <div className="ml-auto max-w-[85%] rounded-md bg-ink px-3 py-2 text-[13px] text-bg">
        {message.content}
      </div>
    );
  }

  const segments = parseSegments(message.content);
  if (segments.length === 0) {
    return pending ? (
      <div className="mr-auto max-w-[85%] rounded-md bg-bg px-3 py-2 text-[13px] text-muted">…</div>
    ) : null;
  }

  return (
    <div className="mr-auto flex max-w-[85%] flex-col gap-2">
      {segments.map((seg, i) =>
        seg.kind === "text" ? (
          <p
            key={i}
            className="rounded-md bg-bg px-3 py-2 text-[13px] leading-5 whitespace-pre-wrap"
          >
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
    <main className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <h1 className="text-[15px] font-semibold tracking-tight">Degree</h1>
        <span className="font-mono text-[11px] text-muted">Demo · {DEMO_PLANNER_ID}</span>
        <div className="ml-auto">
          <ModeToggle mode={mode} onChange={setMode} autoLabel="Auto declare" />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section className="min-h-0 min-w-0 flex-1 overflow-auto border-b border-line lg:border-r lg:border-b-0">
          <h2 className="border-b border-line px-4 py-2 text-[12px] font-medium text-muted">Pathway</h2>
          {profile && profile.declared_programs.length > 0 ? (
            <div className="grid gap-3 p-3 md:grid-cols-2">
              {Object.entries(progressByCode).map(([code, progress]) => (
                <div key={code} className="flex flex-col gap-2">
                  <p className="text-[13px] font-medium">
                    {progress.name} <span className="font-mono text-[11px] text-muted">({progress.summary})</span>
                  </p>
                  {progress.requirements.map((g, i) => (
                    <RequirementGroup key={i} group={g} />
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <p className="px-4 py-2.5 text-[13px] text-muted">No program declared yet.</p>
          )}
          {profile && profile.courses.length > 0 ? (
            <div>
              <h3 className="border-t border-b border-line px-4 py-2 text-[12px] font-medium text-muted">
                Course history
              </h3>
              <ul>
                {profile.courses.map((c) => (
                  <li
                    key={`${c.course_code}-${c.status}`}
                    className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-1.5 text-[13px] last:border-b-0"
                  >
                    <span className="font-mono">{c.course_code}</span>
                    <span className="text-[12px] text-muted">{c.status.replaceAll("_", " ")}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <section className="flex h-64 min-h-0 shrink-0 flex-col bg-surface-raised lg:h-auto lg:w-80">
          <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2.5">
            {messages.length === 0 ? (
              <div className="flex flex-col gap-1.5">
                <p className="text-[12px] text-muted">Ask about programs</p>
                {STARTERS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-md border border-line px-2.5 py-1.5 text-left text-[12px] hover:bg-bg"
                  >
                    {s}
                  </button>
                ))}
                <p className="pt-1 text-[11px] leading-4 text-muted">
                  {mode === "suggest"
                    ? "Suggest mode: click Apply to declare a program."
                    : "Auto declare: the agent declares a program after checking fit."}
                </p>
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

          {error ? (
            <p className="border-t border-line bg-bg px-2.5 py-1.5 text-[12px] text-accent">{error}</p>
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
              placeholder="Ask about programs…"
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
        </section>
      </div>
    </main>
  );
}
