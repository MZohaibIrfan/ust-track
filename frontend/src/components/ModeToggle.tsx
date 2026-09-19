export type AgentMode = "suggest" | "auto";

export function ModeToggle({
  mode,
  onChange,
  autoLabel = "Auto apply",
}: {
  mode: AgentMode;
  onChange: (m: AgentMode) => void;
  autoLabel?: string;
  accent?: string;
}) {
  return (
    <div className="inline-flex rounded-xl border border-line bg-bg p-0.5 text-[12px]">
      <button
        onClick={() => onChange("suggest")}
        className={`rounded-[5px] px-2.5 py-1 transition-colors ${
          mode === "suggest" ? "bg-surface-raised font-medium text-ink" : "text-muted hover:text-ink"
        }`}
      >
        Suggest
      </button>
      <button
        onClick={() => onChange("auto")}
        className={`rounded-[5px] px-2.5 py-1 transition-colors ${
          mode === "auto" ? "bg-surface-raised font-medium text-ink" : "text-muted hover:text-ink"
        }`}
      >
        {autoLabel}
      </button>
    </div>
  );
}
