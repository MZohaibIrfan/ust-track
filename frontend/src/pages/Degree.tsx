import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { AgentMarkdown } from "../components/AgentMarkdown";
import { AgentPanel } from "../components/AgentPanel";
import { ChatHistoryFooter, ChatTabs } from "../components/ChatTabs";
import { ModeToggle, type AgentMode } from "../components/ModeToggle";
import { DegreeDashboard } from "../components/DegreeDashboard";
import { DegreeIcon } from "../components/NavIcons";
import { DegreeRequirements } from "../components/DegreeRequirements";
import { PageHeader } from "../components/PageHeader";
import { ProgramsPanel, roleFor } from "../components/ProgramsPanel";
import { StudyPlan } from "../components/StudyPlan";
import { ThinkingDots } from "../components/ThinkingDots";
import { apiDelete, apiGet, apiGetCached, apiPost, apiPostStream, apiPut } from "../lib/api";
import { DUMMY_EXCHANGE_OPTIONS, programTotals, suggestCourses } from "../lib/degreeDashboard";
import {
  PATHWAY_SCOPES,
  PATHWAY_VIEWS,
  type PathwayScope,
  type PathwayView,
} from "../lib/pathway";
import { getDegreePathwayId, setDegreePathwayId, studentHeading } from "../lib/planner";
import { usePlanner } from "../lib/PlannerContext";
import {
  loadDraft,
  reconcileDraft,
  saveDraft,
  seedFromPathway,
  snapshotFromPayload,
  suggestedVariant,
  type PlanCourse,
  type TermStatus,
} from "../lib/studyPlanMaker";
import type {
  AcademicYear,
  CatalogProgram,
  DegreePathway,
  DegreeProfile,
  ProgramActionPayload,
  RequirementProgress,
  StudyPlanActionPayload,
  StudyPathway,
} from "../lib/types";

type DegreeSubpage = "overview" | "requirements" | "plan";
type ChatMessage = { role: "user" | "assistant"; content: string };
type Segment =
  | { kind: "text"; text: string }
  | { kind: "suggest" | "applied" | "removed"; data: ProgramActionPayload }
  | { kind: "plan_suggest" | "plan_applied"; data: StudyPlanActionPayload };

const SUBPAGES: { id: DegreeSubpage; to: string; label: string }[] = [
  { id: "overview", to: "/degree", label: "Overview" },
  { id: "requirements", to: "/degree/requirements", label: "Requirements" },
  { id: "plan", to: "/degree/plan", label: "Study plan" },
];

const STARTERS: Record<DegreeSubpage, string[]> = {
  overview: ["What does my course history already count toward?", "Should I add the Mathematics minor?", "Compare my program options"],
  requirements: ["What have I already completed?", "What's still open?", "Which electives should I prioritize?"],
  plan: [
    "I want to go on exchange year 3 fall, help me modify my study plan",
    "Mark year 2 spring as leave",
    "Do I need to defer if I take a term off?",
  ],
};

const MARKER_RE = /<<(PROGRAM_SUGGEST|PROGRAM_APPLIED|PROGRAM_REMOVED|PLAN_SUGGEST|PLAN_APPLIED):([A-Za-z0-9+/=]+)>>/g;

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
      if (match[1] === "PLAN_SUGGEST") segments.push({ kind: "plan_suggest", data });
      else if (match[1] === "PLAN_APPLIED") segments.push({ kind: "plan_applied", data });
      else segments.push({ kind: match[1].replace("PROGRAM_", "").toLowerCase() as "suggest" | "applied" | "removed", data });
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
      <p className="rounded-xl border border-line bg-bg px-3 py-2 text-[13px] text-muted">{data.error}</p>
    );
  }

  const isApplied = kind === "applied" || applied;
  const isRemoved = kind === "removed";

  return (
    <div className="rounded-2xl border border-line bg-surface-raised px-3.5 py-3 text-[13px] shadow-soft">
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
            className="shrink-0 rounded-xl bg-accent px-2.5 py-1 text-[12px] font-medium text-accent-ink hover:bg-accent/90"
          >
            {data.fork ? "Open pathway" : "Apply"}
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

function PlanCard({
  kind,
  data,
  applied,
  onApply,
}: {
  kind: "plan_suggest" | "plan_applied";
  data: StudyPlanActionPayload;
  applied: boolean;
  onApply: (data: StudyPlanActionPayload) => void;
}) {
  if (data.error) {
    return <p className="rounded-xl border border-line bg-bg px-3 py-2 text-[13px] text-muted">{data.error}</p>;
  }
  const isApplied = kind === "plan_applied" || applied;
  return (
    <div className="rounded-2xl border border-line bg-surface-raised px-3.5 py-3 text-[13px] shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{data.title}</p>
          <p className="mt-0.5 text-[12px] text-muted">{data.summary}</p>
          {data.deferral?.needed ? (
            <p className="mt-1.5 text-[12px] text-page-career">Deferral suggested{data.deferral.year ? ` · Year ${data.deferral.year}` : ""}.</p>
          ) : null}
        </div>
        {isApplied ? (
          <span className="shrink-0 text-[12px] font-medium text-accent">Applied</span>
        ) : (
          <button
            type="button"
            onClick={() => onApply(data)}
            className="shrink-0 rounded-xl bg-accent px-2.5 py-1 text-[12px] font-medium text-accent-ink hover:bg-accent/90"
          >
            Apply
          </button>
        )}
      </div>
    </div>
  );
}

function ChatBubble({
  message,
  pending,
  appliedKeys,
  onApply,
  onApplyPlan,
}: {
  message: ChatMessage;
  pending: boolean;
  appliedKeys: Set<string>;
  onApply: (data: ProgramActionPayload) => void;
  onApplyPlan: (data: StudyPlanActionPayload) => void;
}) {
  if (message.role === "user") {
    return (
      <div className="ml-auto max-w-[85%] rounded-xl bg-accent px-3 py-2 text-[13px] text-accent-ink">
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
      {segments.map((seg, i) => {
        if (seg.kind === "text") return <AgentMarkdown key={i}>{seg.text}</AgentMarkdown>;
        if (seg.kind === "plan_suggest" || seg.kind === "plan_applied") {
          return (
            <PlanCard
              key={i}
              kind={seg.kind}
              data={seg.data}
              applied={appliedKeys.has(seg.data.title)}
              onApply={onApplyPlan}
            />
          );
        }
        if (seg.kind === "suggest" || seg.kind === "applied" || seg.kind === "removed") {
          return (
            <ProgramCard
              key={i}
              kind={seg.kind}
              data={seg.data}
              applied={appliedKeys.has(seg.data.code)}
              onApply={onApply}
            />
          );
        }
        return null;
      })}
      {pending ? <ThinkingDots boxed={false} /> : null}
    </div>
  );
}

export function DegreePage() {
  const { plannerId } = usePlanner();
  const location = useLocation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadGen = useRef(0);
  const skipSave = useRef(true);
  const subpage: DegreeSubpage =
    location.pathname === "/degree/plan" ? "plan" : location.pathname === "/degree/requirements" ? "requirements" : "overview";

  const [pathwayId, setPathwayId] = useState(() => getDegreePathwayId(plannerId));
  const [pathways, setPathways] = useState<DegreePathway[]>([]);
  const [profile, setProfile] = useState<DegreeProfile | null>(null);
  const [programs, setPrograms] = useState<CatalogProgram[]>([]);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [progress, setProgress] = useState<RequirementProgress | null>(null);
  const [studyPlan, setStudyPlan] = useState<StudyPathway | null>(null);
  const [loadingTree, setLoadingTree] = useState(false);
  const [mode, setMode] = useState<AgentMode>("suggest");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatLoaded, setChatLoaded] = useState(false);
  const [panelTab, setPanelTab] = useState<"chat" | "history">("chat");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appliedKeys, setAppliedKeys] = useState<Set<string>>(new Set());
  const [view, setView] = useState<PathwayView>("all");
  const [scope, setScope] = useState<PathwayScope>("all");
  const [query, setQuery] = useState("");
  const [browseOpen, setBrowseOpen] = useState(false);
  const [progressByCode, setProgressByCode] = useState<Record<string, RequirementProgress>>({});
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [variantId, setVariantId] = useState("custom");
  const [planCourses, setPlanCourses] = useState<PlanCourse[]>([]);
  const [termStatuses, setTermStatuses] = useState<Record<string, TermStatus>>({});
  const [planNote, setPlanNote] = useState<string | null>(null);

  const declared = profile?.declared_programs ?? [];
  const selectedProgram = programs.find((p) => p.code === selectedCode) ?? null;
  const declaredEntry = declared.find((d) => d.code === selectedCode);
  const entryYear = profile?.entry_year ?? declared.find((d) => d.intake_year)?.intake_year ?? null;
  const studyPlanCode =
    selectedCode === "COMP" || declared.some((d) => d.code === "COMP") ? "COMP" : selectedCode;

  async function refreshProfile() {
    const gen = ++loadGen.current;
    try {
      const [listed, p] = await Promise.all([
        apiGet<{ pathways: DegreePathway[] }>(`/api/degree/pathways?planner_id=${plannerId}`),
        apiGet<DegreeProfile>(`/api/degree/profile?planner_id=${pathwayId}`),
      ]);
      if (gen !== loadGen.current) return;
      setPathways(listed.pathways);
      setProfile(p);
      setAppliedKeys((prev) => {
        const next = new Set(prev);
        for (const d of p.declared_programs) {
          if (d.code) next.add(d.code);
        }
        return next;
      });
      setSelectedCode((current) => {
        if (current) return current;
        return p.declared_programs.find((d) => d.code)?.code ?? null;
      });
    } catch {
      if (gen !== loadGen.current) return;
      setError("Couldn't load the student profile.");
    }
  }

  async function loadPrograms(year: number | null, preferredCode?: string | null) {
    const yearQuery = year ? `?intake_year=${year}` : "";
    try {
      const list = await apiGetCached<CatalogProgram[]>(`/api/programs${yearQuery}`);
      setPrograms(list);
      setSelectedCode((current) => {
        if (preferredCode && list.some((program) => program.code === preferredCode)) return preferredCode;
        if (current && list.some((program) => program.code === current)) return current;
        const declaredCode = declared.find((d) => d.code)?.code;
        if (declaredCode && list.some((program) => program.code === declaredCode)) return declaredCode;
        return null;
      });
    } catch {
      setError("Couldn't load the program catalog.");
    }
  }

  async function saveEntryYear(year: number) {
    setError(null);
    try {
      const next = await apiPut<DegreeProfile>("/api/degree/entry-year", {
        planner_id: pathwayId,
        entry_year: year,
      });
      setProfile(next);
    } catch {
      setError("Couldn't save the entry year.");
    }
  }

  async function loadProgress(code: string, year: number | null) {
    setLoadingTree(true);
    try {
      const yearQuery = year ? `&intake_year=${year}` : "";
      const next = await apiGet<RequirementProgress>(
        `/api/degree/progress?planner_id=${pathwayId}&program_code=${encodeURIComponent(code)}${yearQuery}`,
      );
      setProgress(next);
      if (next.code) {
        setProgressByCode((prev) => ({ ...prev, [next.code]: next }));
      }
    } catch {
      setError("Couldn't load that program's requirements.");
      setProgress(null);
    } finally {
      setLoadingTree(false);
    }
  }

  useEffect(() => {
    setPathwayId(getDegreePathwayId(plannerId));
    setSelectedCode(null);
    setMessages([]);
    setAppliedKeys(new Set());
    setProgress(null);
    setProgressByCode({});
    setStudyPlan(null);
    setProfile(null);
    setPathways([]);
    setError(null);
    setBrowseOpen(false);
  }, [plannerId]);

  useEffect(() => {
    apiGetCached<AcademicYear[]>("/api/academic-years")
      .then(setYears)
      .catch(() => {
        // year picker stays empty until the catalog years load
      });
  }, []);

  useEffect(() => {
    refreshProfile();

    setChatLoaded(false);
    apiGet<{ messages: ChatMessage[] }>(`/api/degree/chat?planner_id=${pathwayId}`)
      .then((res) => setMessages(res.messages))
      .catch(() => setMessages([]))
      .finally(() => setChatLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathwayId]);

  async function clearChat() {
    setMessages([]);
    try {
      await apiDelete(`/api/degree/chat?planner_id=${pathwayId}`);
    } catch {
      // best-effort — local state is already cleared
    }
  }

  function selectPathway(id: string) {
    setPathwayId(id);
    setDegreePathwayId(id);
  }

  useEffect(() => {
    if (!profile) return;
    void loadPrograms(entryYear, selectedCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.entry_year, profile?.planner_id]);

  useEffect(() => {
    if (!selectedCode || !profile) return;
    setProgress(null);
    loadProgress(selectedCode, entryYear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCode, entryYear, profile]);

  const otherDeclaredCodes = declared
    .map((item) => item.code)
    .filter((code): code is string => Boolean(code) && code !== selectedCode)
    .join(",");

  useEffect(() => {
    if (!profile || !otherDeclaredCodes) return;
    const codes = otherDeclaredCodes.split(",");
    const yearQuery = entryYear ? `&intake_year=${entryYear}` : "";
    void Promise.all(
      codes.map(async (code) => {
        const next = await apiGet<RequirementProgress>(
          `/api/degree/progress?planner_id=${pathwayId}&program_code=${encodeURIComponent(code)}${yearQuery}`,
        );
        return [code, next] as const;
      }),
    )
      .then((entries) => {
        setProgressByCode((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
      })
      .catch(() => {
        // selected program tree still loads on its own
      });
  }, [otherDeclaredCodes, entryYear, pathwayId, profile]);

  useEffect(() => {
    if (!studyPlanCode || !profile) {
      setStudyPlan(null);
      return;
    }
    const yearQuery = entryYear ? `&intake_year=${entryYear}` : "";
    apiGet<StudyPathway>(
      `/api/degree/study-pathway?program_code=${encodeURIComponent(studyPlanCode)}&planner_id=${pathwayId}${yearQuery}`,
    )
      .then((next) => {
        setStudyPlan(next);
      })
      .catch(() => {
        setStudyPlan(null);
      });
  }, [studyPlanCode, entryYear, pathwayId, profile]);

  const programCode = studyPlan?.program_code ?? progress?.code ?? studyPlanCode ?? "PLAN";
  const variant = studyPlan?.variants?.find((item) => item.id === variantId) ?? studyPlan?.variants?.[0];

  useEffect(() => {
    setVariantId(suggestedVariant(studyPlan));
  }, [studyPlan?.suggested_variant, studyPlan?.program_code]);

  useEffect(() => {
    const saved = loadDraft(pathwayId, programCode, variantId);
    const seeded = saved?.courses ?? seedFromPathway(variant, progress);
    skipSave.current = true;
    setPlanCourses(reconcileDraft(seeded, progress));
    setTermStatuses(saved?.termStatuses ?? {});
    setPlanNote(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathwayId, programCode, variantId, studyPlan?.program_code]);

  useEffect(() => {
    if (!progress) return;
    setPlanCourses((current) => {
      if (current.length) return reconcileDraft(current, progress);
      const seeded = seedFromPathway(variant, progress);
      return seeded.length ? reconcileDraft(seeded, progress) : current;
    });
  }, [progress, variant]);

  useEffect(() => {
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    if (planCourses.length === 0) return;
    saveDraft(pathwayId, programCode, variantId, planCourses, termStatuses);
  }, [planCourses, termStatuses, pathwayId, programCode, variantId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function applySuggestion(data: ProgramActionPayload) {
    try {
      const result = await apiPost<ProgramActionPayload>("/api/degree/pathways", {
        planner_id: pathwayId,
        program_code: data.code,
        role: data.role,
        intake_year: entryYear,
      });
      setAppliedKeys((prev) => new Set(prev).add(data.code));
      setSelectedCode(data.code);
      if (result.planner_id && result.planner_id !== pathwayId) {
        selectPathway(result.planner_id);
      } else {
        refreshProfile();
      }
    } catch {
      setError("Couldn't apply that — check the server is running.");
    }
  }

  function applyPlan(data: StudyPlanActionPayload) {
    const snapshot = snapshotFromPayload(data);
    if (!snapshot) {
      setError(data.error ?? "That study-plan suggestion had no courses to apply.");
      return;
    }
    skipSave.current = false;
    setPlanCourses(snapshot.courses);
    setTermStatuses(snapshot.termStatuses);
    setAppliedKeys((prev) => new Set(prev).add(data.title));
    setPlanNote(data.deferral?.reason ?? data.summary);
  }

  async function declareSelected() {
    if (!selectedProgram || acting) return;
    setActing(true);
    setError(null);
    try {
      await apiPost("/api/degree/apply", {
        planner_id: pathwayId,
        program_code: selectedProgram.code,
        role: roleFor(selectedProgram),
        intake_year: entryYear,
      });
      setAppliedKeys((prev) => new Set(prev).add(selectedProgram.code));
      await refreshProfile();
    } catch {
      setError("Couldn't declare that program.");
    } finally {
      setActing(false);
    }
  }

  async function removeSelected() {
    if (!selectedCode || acting) return;
    setActing(true);
    setError(null);
    try {
      await apiPost("/api/degree/remove", {
        planner_id: pathwayId,
        program_code: selectedCode,
      });
      setAppliedKeys((prev) => {
        const next = new Set(prev);
        next.delete(selectedCode);
        return next;
      });
      await refreshProfile();
    } catch {
      setError("Couldn't remove that program.");
    } finally {
      setActing(false);
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
        focus: subpage,
        study_plan: {
          program_code: programCode,
          variant_id: variantId,
          courses: planCourses,
          term_statuses: termStatuses,
        },
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
      const planHits = [...acc.matchAll(/<<PLAN_APPLIED:([A-Za-z0-9+/=]+)>>/g)];
      if (planHits.length) {
        try {
          applyPlan(JSON.parse(atob(planHits[planHits.length - 1][1])) as StudyPlanActionPayload);
        } catch {
          // marker parse failed
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

  const scopeBuckets = PATHWAY_SCOPES.find((option) => option.id === scope)?.buckets ?? PATHWAY_SCOPES[0].buckets;
  const identity = studentHeading(profile);
  const suggestions = useMemo(() => suggestCourses(progress, studyPlan), [progress, studyPlan]);
  const dashboardPrograms = useMemo(
    () =>
      declared
        .filter((item): item is { code: string; role: string; intake_year: number | null } => Boolean(item.code))
        .map((item) => {
          const totalsFor = programTotals(progressByCode[item.code] ?? (item.code === selectedCode ? progress : null));
          return {
            code: item.code,
            name: progressByCode[item.code]?.name ?? item.code,
            role: item.role,
            ...totalsFor,
          };
        }),
    [declared, progressByCode, progress, selectedCode],
  );
  const combinedProgress = useMemo(() => {
    const codes = declared.map((item) => item.code).filter((code): code is string => Boolean(code));
    const seen = new Set<string>();
    const out: RequirementProgress[] = [];
    for (const code of codes) {
      const next = progressByCode[code] ?? (code === selectedCode ? progress : null);
      if (next && !seen.has(next.code)) {
        seen.add(next.code);
        out.push(next);
      }
    }
    if (out.length === 0 && progress) out.push(progress);
    return out;
  }, [declared, progressByCode, progress, selectedCode]);
  const starters = STARTERS[subpage];

  return (
    <main className="flex h-full min-h-0 flex-col">
      <PageHeader icon={DegreeIcon} badgeClassName="bg-page-degree/15 text-page-degree" title="Degree">
        {pathways.length > 0 ? (
          <select
            value={pathwayId}
            onChange={(e) => selectPathway(e.target.value)}
            className="max-w-[16rem] rounded-xl border border-line bg-bg px-1.5 py-1 text-[13px] text-ink"
          >
            {pathways.map((option) => (
              <option key={option.planner_id} value={option.planner_id}>
                {option.home ? `${option.label} · home` : option.label}
              </option>
            ))}
          </select>
        ) : null}
        <button
          type="button"
          onClick={() => setBrowseOpen((open) => !open)}
          className={`rounded-xl px-2.5 py-1 text-[12px] font-medium ${
            browseOpen ? "bg-accent text-accent-ink" : "border border-line text-muted hover:text-ink"
          }`}
        >
          Browse catalog
        </button>
        <label className="flex items-center gap-1.5 text-[12px] text-muted">
          Entry
          <select
            value={entryYear ?? ""}
            onChange={(e) => {
              const year = Number(e.target.value);
              if (year) void saveEntryYear(year);
            }}
            className="rounded-xl border border-line bg-bg px-1.5 py-1 font-mono text-[12px] text-ink outline-none focus:border-accent"
          >
            {entryYear == null ? <option value="">Year</option> : null}
            {years.map((year) => (
              <option key={year.start_year} value={year.start_year}>
                {year.code}
              </option>
            ))}
          </select>
        </label>
        <ModeToggle mode={mode} onChange={setMode} autoLabel={subpage === "plan" ? "Auto apply" : "Auto create"} />
      </PageHeader>

      <nav className="flex shrink-0 gap-1 border-b border-line px-4">
        {SUBPAGES.map((page) => (
          <NavLink
            key={page.id}
            to={page.to}
            end={page.id === "overview"}
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
        <section className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-surface-raised shadow-soft">
          {browseOpen ? (
            <>
              <button
                type="button"
                className="absolute inset-0 z-20 bg-accent/20"
                aria-label="Close catalog"
                onClick={() => setBrowseOpen(false)}
              />
              <div className="absolute inset-y-0 left-0 z-30 flex w-72 max-w-[85%] shadow-lg">
                <ProgramsPanel
                  programs={programs}
                  declared={declared}
                  selected={selectedCode}
                  onSelect={(code) => {
                    setSelectedCode(code);
                    setBrowseOpen(false);
                  }}
                  onClose={() => setBrowseOpen(false)}
                />
              </div>
            </>
          ) : null}
          <div className="min-h-0 flex-1 overflow-auto">
          {subpage === "overview" ? (
            <DegreeDashboard
              title={identity?.title ?? "Degree planner"}
              detail={identity?.detail ?? "Declare a program to see remaining requirements."}
              programs={dashboardPrograms}
              selectedCode={selectedCode}
              onSelect={setSelectedCode}
              suggestions={suggestions}
              exchanges={DUMMY_EXCHANGE_OPTIONS}
            />
          ) : null}

          {subpage === "requirements" ? (
            <>
              <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-2">
                <div className="min-w-0">
                  <h2 className="text-[13px] font-medium">Requirements</h2>
                  <p className="mt-0.5 text-[12px] text-muted">
                    Completed, in progress, and remaining items across every declared program.
                  </p>
                </div>
                {declaredEntry ? (
                  <button
                    type="button"
                    onClick={removeSelected}
                    disabled={acting}
                    className="shrink-0 rounded-xl border border-line px-2.5 py-1 text-[12px] hover:bg-fill disabled:opacity-40"
                  >
                    Remove {selectedCode}
                  </button>
                ) : selectedProgram ? (
                  <button
                    type="button"
                    onClick={declareSelected}
                    disabled={acting}
                    className="shrink-0 rounded-xl bg-accent px-2.5 py-1 text-[12px] font-medium text-accent-ink disabled:opacity-40"
                  >
                    Declare {roleFor(selectedProgram).replaceAll("_", " ")}
                  </button>
                ) : null}
              </div>
              <div className="flex flex-wrap items-end gap-x-1 border-b border-line bg-fill px-3" role="tablist" aria-label="Requirement section">
                {PATHWAY_SCOPES.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="tab"
                    aria-selected={scope === option.id}
                    onClick={() => setScope(option.id)}
                    className={`-mb-px border-b-2 px-3 py-2 text-[13px] ${
                      scope === option.id
                        ? "border-ink bg-bg font-medium text-ink"
                        : "border-transparent text-muted hover:text-ink"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
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
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Find a course"
                    className="w-28 bg-transparent py-0.5 text-[13px] outline-none placeholder:text-muted focus:w-40 sm:w-36"
                  />
                </div>
              </div>
              <DegreeRequirements
                programs={combinedProgress}
                view={view}
                buckets={scopeBuckets}
                query={query}
                loading={loadingTree && combinedProgress.length === 0}
              />
            </>
          ) : null}

          {subpage === "plan" ? (
            !profile ? (
              <p className="px-4 py-2.5 text-[13px] text-muted">Loading study plan…</p>
            ) : (
              <StudyPlan
                data={studyPlan?.available ? studyPlan : null}
                courses={planCourses}
                termStatuses={termStatuses}
                variantId={variantId}
                onVariantId={setVariantId}
                onCourses={setPlanCourses}
                onTermStatuses={setTermStatuses}
                onReset={() => {
                  setPlanCourses(seedFromPathway(variant, progress));
                  setTermStatuses({});
                  setPlanNote(null);
                }}
                note={planNote}
              />
            )
          ) : null}
          </div>
        </section>

        <AgentPanel>
          <ChatTabs tab={panelTab} onChange={setPanelTab} historyCount={messages.length} />

          <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2.5">
            {!chatLoaded ? (
              <p className="text-[12px] text-muted">Loading chat…</p>
            ) : messages.length === 0 ? (
              panelTab === "history" ? (
                <p className="text-[12px] text-muted">No conversation yet with the degree agent.</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <p className="text-[12px] text-muted">
                    {subpage === "plan" ? "Ask to rearrange the study plan" : subpage === "requirements" ? "Ask about remaining requirements" : "Ask about programs"}
                  </p>
                  {starters.map((s) => (
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
                      ? subpage === "plan"
                        ? "Suggest mode: click Apply to update the study plan."
                        : "Suggest mode: click Apply to declare a program."
                      : subpage === "plan"
                        ? "Auto apply: the agent updates the study plan once it has a fit."
                        : "Auto declare: the agent declares a program after checking fit."}
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
                  onApply={applySuggestion}
                  onApplyPlan={applyPlan}
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
                placeholder={subpage === "plan" ? "Ask to change the study plan…" : "Ask about programs…"}
                disabled={busy}
                className="min-w-0 flex-1 rounded-xl border border-line bg-bg px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
              />
              <button
                type="submit"
                disabled={busy || !input.trim()}
                className="shrink-0 rounded-xl bg-accent px-2.5 py-1.5 text-[12px] font-medium text-accent-ink disabled:opacity-40"
              >
                Send
              </button>
            </form>
          ) : (
            <ChatHistoryFooter
              label="Full conversation with the degree agent"
              onClear={clearChat}
              disabled={messages.length === 0}
            />
          )}
        </AgentPanel>
      </div>
    </main>
  );
}
