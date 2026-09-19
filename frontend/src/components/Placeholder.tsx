export function Placeholder({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12 sm:py-16">
      <h1 className="font-display text-3xl font-semibold">{title}</h1>
      <p className="mt-3 max-w-2xl text-muted">{body}</p>
    </main>
  );
}
