import { useEffect, useRef, useState } from "react";

const DEMO_NAME = "Demo Student";

type Identity = { title: string; detail: string } | null;

export function ProfileMenu({ identity, plannerId }: { identity: Identity; plannerId: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const initials = DEMO_NAME.split(" ")
    .map((part) => part[0])
    .join("");

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Profile"
        onClick={() => setOpen((prev) => !prev)}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] font-medium text-accent transition-opacity hover:opacity-80"
      >
        {initials}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-10 mt-2 w-56 rounded-md border border-line bg-surface-raised p-3 shadow-lg sm:right-auto sm:left-0 sm:bottom-full sm:mt-0 sm:mb-2"
        >
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-medium text-accent">
              {initials}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-ink">{DEMO_NAME}</p>
              <p className="truncate text-[11px] text-muted">Demo profile</p>
            </div>
          </div>

          <div className="mt-3 space-y-1 border-t border-line pt-2 text-[11px] text-muted">
            {identity && <p className="truncate text-ink">{identity.title}</p>}
            {identity && <p className="truncate">{identity.detail}</p>}
            <p className="truncate">Planner ID: {plannerId}</p>
          </div>
        </div>
      )}
    </div>
  );
}
