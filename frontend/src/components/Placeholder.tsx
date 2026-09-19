export function Placeholder({
  title,
  body,
  eyebrow = "Coming soon",
}: {
  title: string;
  body: string;
  accent?: string;
  eyebrow?: string;
}) {
  return (
    <main className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-baseline gap-2 border-b border-line px-4 py-2.5">
        <h1 className="text-[15px] font-semibold tracking-tight">{title}</h1>
        <p className="text-[12px] text-muted">{eyebrow}</p>
      </header>
      <p className="max-w-xl px-4 py-3 text-[13px] leading-5 text-muted">{body}</p>
    </main>
  );
}
