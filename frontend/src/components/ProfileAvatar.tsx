import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { usePlanner } from "../lib/PlannerContext";
import { DEMO_PROFILES } from "../lib/planner";

export function ProfileAvatar() {
  const { plannerId, profile, setPlannerId } = usePlanner();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="Switch demo profile"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] font-medium text-accent transition-opacity hover:opacity-80"
      >
        {profile.initials}
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute top-full right-0 z-50 mt-1 w-56 rounded-md border border-line bg-surface-raised py-1 shadow-lg sm:top-auto sm:right-auto sm:bottom-full sm:left-0 sm:mt-0 sm:mb-1"
        >
          <p className="px-2.5 py-1 text-[11px] text-muted">Demo profiles</p>
          {DEMO_PROFILES.map((item) => {
            const active = item.id === plannerId;
            return (
              <button
                key={item.id}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  setPlannerId(item.id);
                  setOpen(false);
                }}
                className={`flex w-full flex-col items-start px-2.5 py-1.5 text-left ${
                  active ? "bg-fill" : "hover:bg-fill"
                }`}
              >
                <span className="text-[13px] font-medium text-ink">{item.name}</span>
                <span className="text-[11px] text-muted">{item.label}</span>
              </button>
            );
          })}
          <NavLink
            to="/profile"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="mt-1 block border-t border-line px-2.5 py-1.5 text-[12px] text-muted hover:text-ink"
          >
            View profile
          </NavLink>
        </div>
      ) : null}
    </div>
  );
}
