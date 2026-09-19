import { prisma } from "@/lib/prisma";
import { formatMeetings } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function CoursesPage() {
  const courses = await prisma.course.findMany({
    orderBy: { code: "asc" },
    include: {
      prereqFor: { include: { requires: true } },
      offerings: {
        include: { meetings: true, term: true },
        orderBy: { section: "asc" },
      },
    },
  });

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-12 sm:py-16">
      <h1 className="font-display text-3xl font-semibold">Course catalog</h1>
      <p className="mt-2 max-w-2xl text-muted">
        Seeded HKUST courses with prerequisites and 2025-26 Fall sections. This is
        local structured data, not a live class-quota scrape.
      </p>

      <div className="mt-8 overflow-x-auto border border-line bg-surface">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-line bg-accent-soft">
            <tr>
              <th className="px-4 py-3 font-mono text-xs font-medium tracking-wide uppercase">Code</th>
              <th className="px-4 py-3 text-xs font-medium tracking-wide uppercase">Title</th>
              <th className="px-4 py-3 text-xs font-medium tracking-wide uppercase">Cr</th>
              <th className="px-4 py-3 text-xs font-medium tracking-wide uppercase">Prerequisites</th>
              <th className="px-4 py-3 text-xs font-medium tracking-wide uppercase">Fall 25-26</th>
            </tr>
          </thead>
          <tbody>
            {courses.map((course) => {
              const prereqText =
                course.prereqFor.length === 0
                  ? "—"
                  : [...new Set(course.prereqFor.map((item) => item.requires.code))].join(
                      ", ",
                    );

              const offeringText =
                course.offerings.length === 0
                  ? "—"
                  : course.offerings
                      .map(
                        (offering) =>
                          `${offering.section} ${formatMeetings(offering.meetings)}`,
                      )
                      .join(" · ");

              return (
                <tr key={course.id} className="border-t border-line">
                  <td className="px-4 py-3 font-mono">{course.code}</td>
                  <td className="px-4 py-3">{course.title}</td>
                  <td className="px-4 py-3 tabular-nums">{course.credits}</td>
                  <td className="px-4 py-3 text-muted">{prereqText}</td>
                  <td className="px-4 py-3 text-muted">{offeringText}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
