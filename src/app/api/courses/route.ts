import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const courses = await prisma.course.findMany({
    orderBy: { code: "asc" },
    include: {
      prereqFor: {
        include: { requires: { select: { code: true } } },
      },
      offerings: {
        include: {
          term: true,
          meetings: true,
        },
      },
    },
  });

  return NextResponse.json(courses);
}
