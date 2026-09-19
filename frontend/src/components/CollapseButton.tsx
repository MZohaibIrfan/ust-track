function PanelIcon({ side, className }: { side: "left" | "right"; className?: string }) {
  const dividerX = side === "left" ? 9 : 15;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1={dividerX} y1="3" x2={dividerX} y2="21" />
    </svg>
  );
}

export function CollapseButton({
  collapsed,
  onClick,
  side,
  label,
  className,
}: {
  collapsed: boolean;
  onClick: () => void;
  side: "left" | "right";
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-expanded={!collapsed}
      title={label}
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-xl text-muted transition-colors hover:bg-fill hover:text-ink ${className ?? ""}`}
    >
      <PanelIcon side={side} className="h-4 w-4" />
    </button>
  );
}
