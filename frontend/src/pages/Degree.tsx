import { useEffect, useMemo, useRef, useState } from "react";
import { AgentPanel } from "../components/AgentPanel";
import { ModeToggle, type AgentMode } from "../components/ModeToggle";
import { RequirementGroup } from "../components/RequirementTree";
import { apiGet, apiPost, apiPostStream } from "../lib/api";
import {
  DEFAULT_SCOPE,
  PATHWAY_SCOPES,
  PATHWAY_VIEWS,
  countStatuses,
  filterRequirements,
  type PathwayScope,
  type PathwayView,
} from "../lib/pathway";
import { getDegreePathwayId, getPlannerId, setDegreePathwayId, studentHeading } from "../lib/planner";
import type {
  CourseRecord,
  DegreePathway,
  DegreeProfile,
  ProgramActionPayload,
  RequirementProgress,
} from "../lib/types";

const STATUS_ORDER: Record<string, number> = { completed: 0, in_progress: 1, planned: 2 };

function sortHistory(courses: CourseRecord[]): CourseRecord[] {
  return [...courses].sort((a, b) => {
    const byStatus = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
    if (byStatus !== 0) return byStatus;
    return (a.course_code ?? "").localeCompare(b.course_code ?? "");
  });
}

function historySummary(courses: CourseRecord[]): string | null {
  if (courses.length === 0) return null;
  const n = (status: string) => courses.filter((c) => c.status === status).length;
  return `${n("completed")} completed · ${n("in_progress")} this term · ${n("planned")} planned`;
}

type ChatMessage = { role: "user" | "assistant"; content: string };
type Segment =
  | { kind: "text"; text: string }
  | { kind: "suggest" | "applied" | "removed"; data: ProgramActionPayload };

const STARTERS = [
  "Generate pathways I could add onto COMP",
  "Which minor actually uses courses I already have?",
  "Create a pathway with the AI extended major",
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
          <span className="shrink-0 text-[12px] font-medium text-accent">
            {data.fork ? data.label ?? "Pathway created" : "Declared"}
          </span>
        ) : (
          <button
            onClick={() => onApply(data)}
            className="shrink-0 rounded-md bg-ink px-2.5 py-1 text-[12px] font-medium text-bg hover:bg-ink/90"
          >
            {data.fork ? "Open pathway" : "Set as major"}
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

  const [pathwayId, setPathwayId] = useState(getDegreePathwayId);
  const [pathways, setPathways] = useState<DegreePathway[]>([]);

  const [profile, setProfile] = useState<DegreeProfile | null>(null);
  const [progressByCode, setProgressByCode] = useState<Record<string, RequirementProgress>>({});
  const [loading, setLoading] = useState(true);
  const [progressLoading, setProgressLoading] = useState(false);
  const [mode, setMode] = useState<AgentMode>("suggest");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appliedKeys, setAppliedKeys] = useState<Set<string>>(new Set());
  const [view, setView] = useState<PathwayView>("remaining");
  const [scope, setScope] = useState<PathwayScope>(DEFAULT_SCOPE);
  const [query, setQuery] = useState("");

  async function refreshProfile() {
    try {
      const [listed, p] = await Promise.all([
        apiGet<{ pathways: DegreePathway[] }>(`/api/degree/pathways?planner_id=${getPlannerId()}`),
        apiGet<DegreeProfile>(`/api/degree/profile?planner_id=${pathwayId}`),
      ]);
      setPathways(listed.pathways);
      setProfile(p);
      setLoading(false);
      const declared = p.declared_programs.filter(
        (d): d is { code: string; role: string; intake_year: number | null } => !!d.code,
      );
      if (declared.length === 0) {
        setProgressByCode({});
        return;
      }
      setProgressLoading(true);
      const entries = await Promise.all(
        declared.map(async (d) => {
          const progress = await apiGet<RequirementProgress>(
            `/api/degree/progress?planner_id=${pathwayId}&program_code=${d.code}`,
          );
          return [d.code, progress] as const;
        }),
      );
      setProgressByCode(Object.fromEntries(entries));
    } catch {
      // backend may not be running yet
    } finally {
      setLoading(false);
      setProgressLoading(false);
    }
  }

  function selectPathway(id: string) {
    setPathwayId(id);
    setDegreePathwayId(id);
  }

  useEffect(() => {
    refreshProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathwayId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function applySuggestion(data: ProgramActionPayload) {
    try {
      const result = await apiPost<ProgramActionPayload>("/api/degree/pathways", {
        planner_id: pathwayId,
        program_code: data.code,
        role: data.role,
      });
      setAppliedKeys((prev) => new Set(prev).add(data.code));
      if (result.planner_id && result.planner_id !== pathwayId) {
        selectPathway(result.planner_id);
      } else {
        refreshProfile();
      }
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
        planner_id: pathwayId,
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
      const applied = [...acc.matchAll(/<<PROGRAM_APPLIED:([A-Za-z0-9+/=]+)>>/g)];
      if (applied.length) {
        try {
          const data = JSON.parse(atob(applied[applied.length - 1][1])) as ProgramActionPayload;
          if (data.planner_id && data.planner_id !== pathwayId) {
            setAppliedKeys((prev) => new Set(prev).add(data.code));
            selectPathway(data.planner_id);
            return;
          }
        } catch {
          // marker parse failed — still refresh the current pathway
        }
      }
      refreshProfile();
    } catch {
      setError("Couldn't reach the degree agent. Check the server is running.");
      setMessages(next);
    } finally {
      setBusy(false);
    }
  }

  const identity = studentHeading(profile);
  const scopeBuckets = PATHWAY_SCOPES.find((option) => option.id === scope)?.buckets ?? PATHWAY_SCOPES[0].buckets;
  const totals = useMemo(
    () =>
      countStatuses(
        filterRequirements(
          Object.values(progressByCode).flatMap((progress) => progress.requirements),
          "all",
          scopeBuckets,
          "",
        ),
      ),
    [progressByCode, scopeBuckets],
  );

  return (
    <main className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <h1 className="text-[15px] font-semibold tracking-tight">Degree</h1>
        {pathways.length > 0 ? (
          <select
            value={pathwayId}
            onChange={(e) => selectPathway(e.target.value)}
            className="max-w-[16rem] bg-bg py-0.5 text-[13px] text-ink"
          >
            {pathways.map((option) => (
              <option key={option.planner_id} value={option.planner_id}>
                {option.home ? `${option.label} · home` : option.label}
              </option>
            ))}
          </select>
        ) : identity ? (
          <span className="min-w-0 text-[12px] text-muted">
            <span className="font-medium text-ink">{identity.title}</span>
            {identity.detail ? <span className="hidden sm:inline"> · {identity.detail}</span> : null}
          </span>
        ) : (
          <span className="text-[12px] text-muted">{loading ? "Loading profile…" : "No program declared"}</span>
        )}
        <div className="ml-auto">
          <ModeToggle mode={mode} onChange={setMode} autoLabel="Auto create" />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section className="min-h-0 min-w-0 flex-1 overflow-auto border-b border-line lg:border-r lg:border-b-0">
          <div className="flex flex-wrap items-end gap-x-4 border-b border-line px-3">
            {PATHWAY_VIEWS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setView(option.id)}
                className={`-mb-px border-b-2 py-2 text-[13px] ${
                  view === option.id
                    ? "border-ink font-medium text-ink"
                    : "border-transparent text-muted hover:text-ink"
                }`}
              >
                {option.label}
              </button>
            ))}
            <div className="ml-auto flex min-w-0 items-center gap-3 py-1.5">
              {Object.keys(progressByCode).length > 0 ? (
                <span className="hidden font-mono text-[11px] text-muted sm:inline">
                  {totals.missing} open{profile?.catalog_year ? ` · ${profile.catalog_year}` : ""}
                </span>
              ) : null}
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as PathwayScope)}
                className="bg-bg py-0.5 text-[13px] text-ink"
              >
                {PATHWAY_SCOPES.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a course"
                className="w-28 bg-transparent py-0.5 text-[13px] outline-none placeholder:text-muted focus:w-40 sm:w-36"
              />
            </div>
          </div>
          {loading && !profile ? (
            <p className="px-3 py-6 text-[13px] text-muted">Loading profile…</p>
          ) : profile && profile.declared_programs.length > 0 ? (
            progressLoading && Object.keys(progressByCode).length === 0 ? (
              <p className="px-3 py-6 text-[13px] text-muted">Loading COMP requirements…</p>
            ) : (
              Object.entries(progressByCode).map(([code, progress]) => {
                const groups = filterRequirements(progress.requirements, view, scopeBuckets, query);
                return (
                  <div key={code}>
                    {groups.length === 0 ? (
                      <p className="px-3 py-6 text-[13px] text-muted">
                        Nothing in this view. Switch to All, or pick Electives.
                      </p>
                    ) : (
                      groups.map((g, i) => <RequirementGroup key={i} group={g} />)
                    )}
                  </div>
                );
              })
            )
          ) : (
            <p className="px-3 py-6 text-[13px] text-muted">No program declared yet.</p>
          )}
          {profile && profile.courses.length > 0 ? (
            <details className="border-t border-line">
              <summary className="cursor-pointer px-3 py-2 text-[12px] text-muted hover:text-ink">
                Course history
                {historySummary(profile.courses) ? (
                  <span className="ml-2 font-mono text-[11px]">{historySummary(profile.courses)}</span>
                ) : null}
              </summary>
              <ul>
                {sortHistory(profile.courses).map((c) => (
                  <li
                    key={`${c.course_code}-${c.status}`}
                    className="grid grid-cols-[6.75rem_minmax(0,1fr)] gap-3 border-t border-line px-3 py-[7px] text-[13px]"
                  >
                    <span className="font-mono">{c.course_code}</span>
                    <span className="text-[12px] text-muted">{c.status.replaceAll("_", " ")}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>

        <AgentPanel>
          <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
            {messages.length === 0 ? (
              <div className="flex flex-col gap-2">
                <p className="text-[12px] text-muted">Ask about this plan</p>
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
        </AgentPanel>
      </div>
    </main>
  );
}
