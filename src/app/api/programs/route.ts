import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const programs = await prisma.program.findMany({
    orderBy: [{ kind: "desc" }, { code: "asc" }],
    include: {
      school: true,
      requirements: {
        include: {
          courses: {
            include: { course: { select: { code: true, title: true, credits: true } } },
          },
        },
      },
    },
  });

  return NextResponse.json(programs);
}
