import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const SYSTEM_PROMPT = `You are the UST Track advisor, helping an HKUST undergraduate plan their degree.
You only know what the tools tell you — always look courses and requirements up rather than guessing
codes or prerequisites. When a student wants a plan, use create_plan and add_course_to_plan to build it
in the database, and use get_plan to check credit totals before confirming. Keep answers concise and
concrete: cite course codes, credits, and terms rather than generic advice.`;

const tools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "search_courses",
      description:
        "Search the course catalog by keyword (matches code or title) and/or department. Returns code, title, credits, department, and whether it's common core.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Keyword to match against course code or title" },
          department: { type: "string", description: "Exact department code, e.g. COMP" },
          commonCoreOnly: { type: "boolean" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_course",
      description:
        "Get full detail for one course by its exact code: description, prerequisites, and Fall 2025-26 offerings with meeting times.",
      parameters: {
        type: "object",
        properties: { code: { type: "string" } },
        required: ["code"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_programs",
      description: "List every major/pathway in the catalog with its school and kind (Traditional or Special).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_program",
      description:
        "Get one program's full requirement breakdown by its exact code: each requirement group, its minimum credits, and the courses that satisfy it.",
      parameters: {
        type: "object",
        properties: { code: { type: "string" } },
        required: ["code"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_plan",
      description: "Create a new degree plan for the student. Returns its planId — reuse that id for later calls.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short label for the plan" },
          intakeYear: { type: "number", description: "Year the student entered HKUST, e.g. 2025" },
          programCode: { type: "string", description: "Optional program code to attach, e.g. COMP-BEng" },
        },
        required: ["name", "intakeYear"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_course_to_plan",
      description: "Add one course into a semester of an existing plan, creating the semester if needed.",
      parameters: {
        type: "object",
        properties: {
          planId: { type: "string" },
          year: { type: "number", description: "Calendar year the semester starts, e.g. 2025" },
          season: { type: "string", description: "Fall, Spring, or Summer" },
          courseCode: { type: "string" },
        },
        required: ["planId", "year", "season", "courseCode"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_plan",
      description: "Fetch a plan's full semester-by-semester course list and total credits.",
      parameters: {
        type: "object",
        properties: { planId: { type: "string" } },
        required: ["planId"],
      },
    },
  },
];

async function executeTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "search_courses": {
      const { query, department, commonCoreOnly } = input as {
        query?: string;
        department?: string;
        commonCoreOnly?: boolean;
      };
      const courses = await prisma.course.findMany({
        where: {
          department: department ? department.toUpperCase() : undefined,
          isCommonCore: commonCoreOnly || undefined,
          OR: query
            ? [
                { code: { contains: query.toUpperCase() } },
                { title: { contains: query } },
              ]
            : undefined,
        },
        orderBy: { code: "asc" },
        take: 30,
      });
      return courses.map((c) => ({
        code: c.code,
        title: c.title,
        credits: c.credits,
        department: c.department,
        isCommonCore: c.isCommonCore,
      }));
    }

    case "get_course": {
      const { code } = input as { code: string };
      const course = await prisma.course.findUnique({
        where: { code },
        include: {
          prereqFor: { include: { requires: true } },
          offerings: { include: { meetings: true, term: true } },
        },
      });
      if (!course) return { error: `No course with code ${code}` };
      return {
        code: course.code,
        title: course.title,
        credits: course.credits,
        department: course.department,
        description: course.description,
        prerequisites: [...new Set(course.prereqFor.map((p) => p.requires.code))],
        offerings: course.offerings.map((o) => ({
          term: o.term.label,
          section: o.section,
          instructor: o.instructor,
          meetings: o.meetings.map((m) => `${m.day} ${m.startMin}-${m.endMin}`),
        })),
      };
    }

    case "list_programs": {
      const programs = await prisma.program.findMany({ include: { school: true } });
      return programs.map((p) => ({
        code: p.code,
        name: p.name,
        kind: p.kind,
        school: p.school.code,
      }));
    }

    case "get_program": {
      const { code } = input as { code: string };
      const program = await prisma.program.findUnique({
        where: { code },
        include: {
          school: true,
          requirements: { include: { courses: { include: { course: true } } } },
        },
      });
      if (!program) return { error: `No program with code ${code}` };
      return {
        code: program.code,
        name: program.name,
        kind: program.kind,
        school: program.school.name,
        notes: program.notes,
        requirements: program.requirements.map((r) => ({
          name: r.name,
          kind: r.kind,
          minCredits: r.minCredits,
          courses: r.courses.map((c) => c.course.code),
        })),
      };
    }

    case "create_plan": {
      const { name, intakeYear, programCode } = input as {
        name: string;
        intakeYear: number;
        programCode?: string;
      };
      const program = programCode
        ? await prisma.program.findUnique({ where: { code: programCode } })
        : null;
      const plan = await prisma.plan.create({
        data: { name, intakeYear, programId: program?.id },
      });
      return { planId: plan.id };
    }

    case "add_course_to_plan": {
      const { planId, year, season, courseCode } = input as {
        planId: string;
        year: number;
        season: string;
        courseCode: string;
      };
      const course = await prisma.course.findUnique({ where: { code: courseCode } });
      if (!course) return { error: `No course with code ${courseCode}` };

      const semester = await prisma.planSemester.upsert({
        where: { planId_year_season: { planId, year, season } },
        create: { planId, year, season },
        update: {},
      });
      await prisma.planCourse.upsert({
        where: { semesterId_courseId: { semesterId: semester.id, courseId: course.id } },
        create: { semesterId: semester.id, courseId: course.id },
        update: {},
      });
      return { ok: true, added: courseCode, to: `${season} ${year}` };
    }

    case "get_plan": {
      const { planId } = input as { planId: string };
      const plan = await prisma.plan.findUnique({
        where: { id: planId },
        include: {
          program: true,
          semesters: {
            include: { courses: { include: { course: true } } },
            orderBy: [{ year: "asc" }, { season: "asc" }],
          },
        },
      });
      if (!plan) return { error: `No plan with id ${planId}` };
      const totalCredits = plan.semesters.reduce(
        (sum, s) => sum + s.courses.reduce((c, pc) => c + pc.course.credits, 0),
        0,
      );
      return {
        name: plan.name,
        intakeYear: plan.intakeYear,
        program: plan.program?.code ?? null,
        totalCredits,
        semesters: plan.semesters.map((s) => ({
          term: `${s.season} ${s.year}`,
          courses: s.courses.map((pc) => `${pc.course.code} (${pc.course.credits} cr)`),
        })),
      };
    }

    default:
      return { error: `Unknown tool ${name}` };
  }
}

function missingOpenRouterConfig(): string | null {
  if (!process.env.OPENROUTER_API_KEY) {
    return "OPENROUTER_API_KEY is not configured on the server yet.";
  }
  return null;
}

export async function POST(req: Request) {
  const configError = missingOpenRouterConfig();
  if (configError) {
    return new Response(configError, { status: 503 });
  }

  const { messages } = (await req.json()) as {
    messages: { role: "user" | "assistant"; content: string }[];
  };

  const model = process.env.OPENROUTER_MODEL ?? "openai/gpt-4.1-mini";
  const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "UST Track",
    },
  });

  const history: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...messages.map((m): ChatCompletionMessageParam => ({ role: m.role, content: m.content })),
  ];

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for (let iteration = 0; iteration < 8; iteration++) {
          const completion = await client.chat.completions.create({
            model,
            messages: history,
            tools,
          });

          const choice = completion.choices[0];
          const message = choice.message;

          if (choice.finish_reason !== "tool_calls" || !message.tool_calls?.length) {
            if (message.content) controller.enqueue(encoder.encode(message.content));
            break;
          }

          history.push({
            role: "assistant",
            content: message.content,
            tool_calls: message.tool_calls,
          });

          for (const call of message.tool_calls) {
            if (call.type !== "function") continue;
            const result = await executeTool(
              call.function.name,
              JSON.parse(call.function.arguments || "{}"),
            );
            history.push({
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify(result),
            });
          }
        }
        controller.close();
      } catch (error) {
        controller.enqueue(
          encoder.encode(
            `\n\n[advisor error: ${error instanceof Error ? error.message : "unknown"}]`,
          ),
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
