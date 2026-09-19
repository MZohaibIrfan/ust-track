import type { ReactNode } from "react";

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3.5"
    >
      {children}
    </svg>
  );
}

function HistoryIcon() {
  return (
    <Icon>
      <path d="M3 12a9 9 0 1 0 2.6-6.4L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </Icon>
  );
}

const TrashIcon = () => (
  <Icon>
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0-1 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 6h12Z" />
  </Icon>
);

export type ChatTab = "chat" | "history";

/** Small tab bar for an agent panel: live Chat vs. a read-only History
 * scrollback of the same persisted conversation. Shared across the degree,
 * timetable, and career agent panels so each keeps its own history but the
 * UI for it stays consistent. */
export function ChatTabs({
  tab,
  onChange,
  historyCount,
  icon,
}: {
  tab: ChatTab;
  onChange: (tab: ChatTab) => void;
  historyCount: number;
  icon?: ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1.5 pr-9">
      <button
        onClick={() => onChange("chat")}
        className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium transition-colors ${
          tab === "chat" ? "bg-fill text-ink" : "text-muted hover:text-ink"
        }`}
      >
        {icon}
        Chat
      </button>
      <button
        onClick={() => onChange("history")}
        className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium transition-colors ${
          tab === "history" ? "bg-fill text-ink" : "text-muted hover:text-ink"
        }`}
      >
        <HistoryIcon />
        History
        {historyCount > 0 ? (
          <span className="rounded-full bg-line px-1.5 py-0.5 text-[10px] text-muted">{historyCount}</span>
        ) : null}
      </button>
    </div>
  );
}

export function ChatHistoryFooter({ label, onClear, disabled }: { label: string; onClear: () => void; disabled: boolean }) {
  return (
    <div className="flex items-center justify-between border-t border-line p-2">
      <p className="px-1 text-[11px] text-muted">{label}</p>
      <button
        onClick={onClear}
        disabled={disabled}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-muted transition-colors hover:bg-fill hover:text-accent disabled:opacity-40"
      >
        <TrashIcon /> Clear
      </button>
    </div>
  );
}
