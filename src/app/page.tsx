import Link from "next/link";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [courseCount, programCount, offeringCount, programs] = await Promise.all([
    prisma.course.count(),
    prisma.program.count(),
    prisma.offering.count(),
    prisma.program.findMany({
      include: { school: true },
      orderBy: [{ kind: "desc" }, { code: "asc" }],
      take: 4,
    }),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-12 px-6 py-12 sm:py-16">
      <section className="max-w-2xl">
        <p className="font-mono text-xs tracking-[0.25em] text-muted uppercase">
          HKUST undergraduates
        </p>
        <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Plan a degree around courses that actually exist.
        </h1>
        <p className="mt-4 text-lg leading-8 text-muted">
          Semester timetables, school-based majors, and special pathways like IBM
          and DDP — all from structured HKUST course data, plus an advisor that
          reads it with you.
        </p>
        <Link
          href="/advisor"
          className="mt-6 inline-flex items-center gap-2 bg-accent px-5 py-2.5 font-medium text-accent-ink transition-opacity hover:opacity-90"
        >
          Talk to the advisor
        </Link>
      </section>

      <section className="grid gap-px overflow-hidden border border-line bg-line sm:grid-cols-3">
        <Stat label="Courses" value={courseCount} href="/courses" />
        <Stat label="Pathways" value={programCount} href="/programs" />
        <Stat label="Class sections" value={offeringCount} href="/courses" />
      </section>

      <section>
        <div className="mb-4 flex items-end justify-between">
          <h2 className="font-display text-xl font-semibold">Pathways in the catalog</h2>
          <Link href="/programs" className="text-sm text-accent underline underline-offset-4">
            View all
          </Link>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {programs.map((program) => (
            <article key={program.id} className="border border-line bg-surface p-5">
              <p className="font-mono text-xs tracking-widest text-accent">
                {program.kind === "SPECIAL" ? "Special" : "Traditional"} · {program.school.code}
              </p>
              <h3 className="mt-2 font-display text-lg font-semibold">
                {program.code} — {program.name}
              </h3>
              {program.notes ? (
                <p className="mt-2 text-sm leading-6 text-muted">{program.notes}</p>
              ) : null}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function Stat({
  label,
  value,
  href,
}: {
  label: string;
  value: number;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="bg-surface px-5 py-5 transition-colors hover:bg-accent-soft"
    >
      <p className="font-mono text-3xl tabular-nums">{value}</p>
      <p className="mt-1 text-sm text-muted">{label}</p>
    </Link>
  );
}
