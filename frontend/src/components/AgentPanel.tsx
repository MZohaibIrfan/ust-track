import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useCollapsed } from "../lib/collapse";
import { CollapseButton } from "./CollapseButton";

const WIDTH_KEY = "ust-track:agent-panel-width";
const HEIGHT_KEY = "ust-track:agent-panel-height";
const MIN_W = 260;
const MAX_W = 720;
const DEFAULT_W = 320;
const MIN_H = 180;
const MAX_H = 560;
const DEFAULT_H = 256;

function readSize(key: string, fallback: number, min: number, max: number): number {
  const n = Number(localStorage.getItem(key));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function AgentPanel({ children }: { children: ReactNode }) {
  const [width, setWidth] = useState(() => readSize(WIDTH_KEY, DEFAULT_W, MIN_W, MAX_W));
  const [height, setHeight] = useState(() => readSize(HEIGHT_KEY, DEFAULT_H, MIN_H, MAX_H));
  const [dragging, setDragging] = useState<"x" | "y" | null>(null);
  const [collapsed, setCollapsed] = useCollapsed("ust-track:agent-panel-collapsed");
  const drag = useRef<{ kind: "x" | "y"; start: number; size: number } | null>(null);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const current = drag.current;
      if (!current) return;
      if (current.kind === "x") {
        setWidth(Math.min(MAX_W, Math.max(MIN_W, current.size + (current.start - event.clientX))));
      } else {
        setHeight(Math.min(MAX_H, Math.max(MIN_H, current.size + (current.start - event.clientY))));
      }
    };
    const onUp = () => {
      if (!drag.current) return;
      drag.current = null;
      setDragging(null);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(WIDTH_KEY, String(width));
  }, [width]);

  useEffect(() => {
    localStorage.setItem(HEIGHT_KEY, String(height));
  }, [height]);

  function start(kind: "x" | "y", event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      kind,
      start: kind === "x" ? event.clientX : event.clientY,
      size: kind === "x" ? width : height,
    };
    setDragging(kind);
    document.body.style.cursor = kind === "x" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  }

  const line = dragging ? "bg-accent" : "bg-transparent hover:bg-line";
  const targetWidth = collapsed ? 36 : width;
  const targetHeight = collapsed ? 36 : height;

  return (
    <section
      className="relative flex min-h-0 shrink-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface-raised shadow-soft transition-[width,height] duration-200 ease-in-out max-lg:h-[var(--agent-h)] lg:h-auto lg:w-[var(--agent-w)]"
      style={{ "--agent-w": `${targetWidth}px`, "--agent-h": `${targetHeight}px` } as CSSProperties}
    >
      {collapsed ? null : (
        <>
          <div
            className="absolute inset-x-0 top-0 z-10 h-2 cursor-row-resize touch-none lg:hidden"
            onPointerDown={(event) => start("y", event)}
            aria-label="Resize agent panel"
            role="separator"
            aria-orientation="horizontal"
          >
            <div className={`h-px w-full ${line}`} />
          </div>
          <div
            className="absolute inset-y-0 left-0 z-10 hidden w-2 cursor-col-resize touch-none lg:block"
            onPointerDown={(event) => start("x", event)}
            aria-label="Resize agent panel"
            role="separator"
            aria-orientation="vertical"
          >
            <div className={`h-full w-px ${line}`} />
          </div>
        </>
      )}
      <CollapseButton
        collapsed={collapsed}
        onClick={() => setCollapsed(!collapsed)}
        side="right"
        label={collapsed ? "Expand assistant" : "Collapse assistant"}
        className={`absolute top-1 z-20 ${collapsed ? "inset-x-0 mx-auto" : "right-1"}`}
      />
      <div
        className={`flex min-h-0 flex-1 flex-col transition-opacity duration-150 ${
          collapsed ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
      >
        {children}
      </div>
    </section>
  );
}
