import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function ProgramsPage() {
  const programs = await prisma.program.findMany({
    orderBy: [{ kind: "desc" }, { code: "asc" }],
    include: {
      school: true,
      requirements: {
        include: {
          courses: {
            include: { course: true },
          },
        },
      },
    },
  });

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-12 sm:py-16">
      <h1 className="font-display text-3xl font-semibold">Major pathways</h1>
      <p className="mt-2 max-w-2xl text-muted">
        Traditional school-based majors versus special routes such as IBM and DDP.
        Each pathway has credit rules pointing at real course codes.
      </p>

      <div className="mt-8 grid gap-6">
        {programs.map((program) => (
          <article key={program.id} className="border border-line bg-surface p-6">
            <p className="font-mono text-xs tracking-widest text-accent">
              {program.kind === "SPECIAL" ? "Special" : "Traditional"} · {program.school.name}
            </p>
            <h2 className="mt-2 font-display text-2xl font-semibold">
              {program.code} — {program.name}
            </h2>
            {program.notes ? (
              <p className="mt-2 text-sm leading-6 text-muted">{program.notes}</p>
            ) : null}

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {program.requirements.map((requirement) => (
                <div key={requirement.id} className="border border-line p-4">
                  <p className="text-sm font-medium">{requirement.name}</p>
                  <p className="mt-1 font-mono text-xs text-muted">
                    {requirement.kind} · {requirement.minCredits} credits
                  </p>
                  <ul className="mt-3 space-y-1 text-sm">
                    {requirement.courses.map((item) => (
                      <li key={item.courseId}>
                        <span className="font-mono">{item.course.code}</span>{" "}
                        {item.course.title}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
