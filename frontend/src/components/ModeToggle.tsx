export type AgentMode = "suggest" | "auto";

export function ModeToggle({
  mode,
  onChange,
  autoLabel = "Auto apply",
}: {
  mode: AgentMode;
  onChange: (m: AgentMode) => void;
  autoLabel?: string;
}) {
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
        {autoLabel}
      </button>
    </div>
  );
}
