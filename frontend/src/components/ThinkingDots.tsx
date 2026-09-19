export function ThinkingDots({ boxed = true }: { boxed?: boolean }) {
  return (
    <div
      className={
        boxed
          ? "mr-auto flex max-w-[85%] items-center gap-1 rounded-xl bg-bg px-3 py-2.5"
          : "flex items-center gap-1 px-1 py-0.5"
      }
      aria-live="polite"
      aria-label="Thinking"
    >
      <span className="thinking-dot" />
      <span className="thinking-dot" />
      <span className="thinking-dot" />
    </div>
  );
}
