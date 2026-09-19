import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function toMinutes(hhmm: string): number {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return hours * 60 + minutes;
}

async function main() {
  await prisma.planCourse.deleteMany();
  await prisma.planSemester.deleteMany();
  await prisma.plan.deleteMany();
  await prisma.requirementCourse.deleteMany();
  await prisma.requirement.deleteMany();
  await prisma.meetingTime.deleteMany();
  await prisma.offering.deleteMany();
  await prisma.prerequisite.deleteMany();
  await prisma.course.deleteMany();
  await prisma.program.deleteMany();
  await prisma.school.deleteMany();
  await prisma.term.deleteMany();

  const [seng, ssci, sbm, ais] = await Promise.all([
    prisma.school.create({
      data: { code: "SENG", name: "School of Engineering" },
    }),
    prisma.school.create({
      data: { code: "SSCI", name: "School of Science" },
    }),
    prisma.school.create({
      data: { code: "SBM", name: "School of Business and Management" },
    }),
    prisma.school.create({
      data: { code: "AIS", name: "Academy of Interdisciplinary Studies" },
    }),
  ]);

  const [comp, cpeg, math, ibm, ddp] = await Promise.all([
    prisma.program.create({
      data: {
        code: "COMP",
        name: "BEng in Computer Science",
        kind: "TRADITIONAL",
        schoolId: seng.id,
        notes: "School-based SENG pathway. Major declaration typically in Year 2.",
      },
    }),
    prisma.program.create({
      data: {
        code: "CPEG",
        name: "BEng in Computer Engineering",
        kind: "TRADITIONAL",
        schoolId: seng.id,
        notes: "Joint COMP/ELEC major under SENG.",
      },
    }),
    prisma.program.create({
      data: {
        code: "MATH",
        name: "BSc in Mathematics",
        kind: "TRADITIONAL",
        schoolId: ssci.id,
      },
    }),
    prisma.program.create({
      data: {
        code: "IBM",
        name: "BSc in Individualized Interdisciplinary Major",
        kind: "SPECIAL",
        schoolId: ais.id,
        notes: "Student-designed major. Requirements are custom, not a fixed COMP map.",
      },
    }),
    prisma.program.create({
      data: {
        code: "DDP",
        name: "Dual Degree Program (Engineering + Business)",
        kind: "SPECIAL",
        schoolId: seng.id,
        notes: "Longer pathway covering SENG major plus SBM core.",
      },
    }),
  ]);

  const courseRows = [
    {
      code: "COMP1021",
      title: "Introduction to Computer Science",
      credits: 3,
      department: "COMP",
      description: "First programming course for Engineering students.",
    },
    {
      code: "COMP2011",
      title: "Programming with C++",
      credits: 4,
      department: "COMP",
      description: "Imperative programming, memory, and basic data structures in C++.",
    },
    {
      code: "COMP2012",
      title: "Object-Oriented Programming and Data Structures",
      credits: 4,
      department: "COMP",
      description: "OOP, templates, and core data structures.",
    },
    {
      code: "COMP2711",
      title: "Discrete Mathematical Tools for Computer Science",
      credits: 4,
      department: "COMP",
      description: "Logic, proofs, combinatorics, and graph basics for CS.",
    },
    {
      code: "COMP3111",
      title: "Software Engineering",
      credits: 4,
      department: "COMP",
    },
    {
      code: "COMP3511",
      title: "Operating Systems",
      credits: 3,
      department: "COMP",
    },
    {
      code: "COMP3711",
      title: "Design and Analysis of Algorithms",
      credits: 3,
      department: "COMP",
    },
    {
      code: "MATH1013",
      title: "Calculus I",
      credits: 3,
      department: "MATH",
    },
    {
      code: "MATH1014",
      title: "Calculus II",
      credits: 3,
      department: "MATH",
    },
    {
      code: "MATH2111",
      title: "Matrix Algebra and Applications",
      credits: 3,
      department: "MATH",
    },
    {
      code: "ELEC1100",
      title: "Introduction to Electro-Robot Design",
      credits: 4,
      department: "ELEC",
    },
    {
      code: "LANG1402",
      title: "Academic English for University Studies",
      credits: 3,
      department: "LANG",
    },
    {
      code: "LANG1403",
      title: "Academic English for Technical Communication",
      credits: 3,
      department: "LANG",
    },
    {
      code: "HUMA1000",
      title: "Cultures and Values",
      credits: 3,
      department: "HUMA",
      isCommonCore: true,
    },
    {
      code: "SOSC1960",
      title: "Introduction to Psychology",
      credits: 3,
      department: "SOSC",
      isCommonCore: true,
    },
    {
      code: "ACCT2010",
      title: "Principles of Accounting I",
      credits: 3,
      department: "ACCT",
    },
    {
      code: "ISOM2020",
      title: "Coding for Business",
      credits: 3,
      department: "ISOM",
    },
  ];

  const courses = Object.fromEntries(
    await Promise.all(
      courseRows.map(async (row) => {
        const course = await prisma.course.create({ data: row });
        return [course.code, course] as const;
      }),
    ),
  );

  const prereqs: [string, string, string][] = [
    ["COMP2011", "COMP1021", "default"],
    ["COMP2012", "COMP2011", "default"],
    ["COMP2711", "MATH1013", "default"],
    ["COMP3111", "COMP2012", "default"],
    ["COMP3511", "COMP2012", "a"],
    ["COMP3511", "COMP2711", "b"],
    ["COMP3711", "COMP2012", "a"],
    ["COMP3711", "COMP2711", "b"],
    ["MATH1014", "MATH1013", "default"],
    ["MATH2111", "MATH1013", "default"],
    ["LANG1403", "LANG1402", "default"],
  ];

  await prisma.prerequisite.createMany({
    data: prereqs.map(([courseCode, requiresCode, groupKey]) => ({
      courseId: courses[courseCode].id,
      requiresId: courses[requiresCode].id,
      groupKey,
    })),
  });

  async function addRequirement(
    programId: string,
    name: string,
    kind: string,
    minCredits: number,
    codes: string[],
  ) {
    await prisma.requirement.create({
      data: {
        programId,
        name,
        kind,
        minCredits,
        courses: {
          create: codes.map((code) => ({ courseId: courses[code].id })),
        },
      },
    });
  }

  await addRequirement(
    comp.id,
    "Computer Science core",
    "REQUIRED",
    25,
    [
      "COMP1021",
      "COMP2011",
      "COMP2012",
      "COMP2711",
      "COMP3111",
      "COMP3511",
      "COMP3711",
    ],
  );
  await addRequirement(
    comp.id,
    "Mathematics",
    "SCHOOL",
    9,
    ["MATH1013", "MATH1014", "MATH2111"],
  );
  await addRequirement(
    comp.id,
    "English communication",
    "SCHOOL",
    6,
    ["LANG1402", "LANG1403"],
  );
  await addRequirement(
    comp.id,
    "Common Core",
    "COMMON_CORE",
    6,
    ["HUMA1000", "SOSC1960"],
  );

  await addRequirement(
    cpeg.id,
    "Computer Engineering core",
    "REQUIRED",
    19,
    ["COMP1021", "COMP2011", "COMP2012", "ELEC1100", "COMP3511"],
  );
  await addRequirement(
    math.id,
    "Mathematics core",
    "REQUIRED",
    9,
    ["MATH1013", "MATH1014", "MATH2111"],
  );
  await addRequirement(
    ddp.id,
    "Engineering core",
    "REQUIRED",
    15,
    ["COMP1021", "COMP2011", "COMP2012", "MATH1013", "MATH1014"],
  );
  await addRequirement(
    ddp.id,
    "Business core",
    "REQUIRED",
    6,
    ["ACCT2010", "ISOM2020"],
  );
  await addRequirement(ibm.id, "Sample technical electives", "ELECTIVE", 12, [
    "COMP1021",
    "COMP2011",
    "ISOM2020",
    "MATH1013",
  ]);

  const fall = await prisma.term.create({
    data: {
      code: "2526-F",
      label: "2025-26 Fall",
      yearStart: 2025,
      season: "Fall",
    },
  });

  const offerings: {
    code: string;
    section: string;
    instructor: string;
    quota: number;
    venue: string;
    meetings: { day: string; start: string; end: string }[];
  }[] = [
    {
      code: "COMP1021",
      section: "L1",
      instructor: "Chan, A.",
      quota: 80,
      venue: "G009",
      meetings: [
        { day: "Mo", start: "09:00", end: "10:20" },
        { day: "We", start: "09:00", end: "10:20" },
      ],
    },
    {
      code: "COMP2011",
      section: "L1",
      instructor: "Li, B.",
      quota: 70,
      venue: "2302",
      meetings: [
        { day: "Tu", start: "13:30", end: "14:50" },
        { day: "Th", start: "13:30", end: "14:50" },
      ],
    },
    {
      code: "COMP2011",
      section: "T1",
      instructor: "TA",
      quota: 40,
      venue: "2405",
      meetings: [{ day: "Fr", start: "15:00", end: "15:50" }],
    },
    {
      code: "COMP2012",
      section: "L1",
      instructor: "Ng, C.",
      quota: 60,
      venue: "2502",
      meetings: [
        { day: "Mo", start: "16:30", end: "17:50" },
        { day: "We", start: "16:30", end: "17:50" },
      ],
    },
    {
      code: "MATH1013",
      section: "L1",
      instructor: "Wong, D.",
      quota: 120,
      venue: "LTA",
      meetings: [
        { day: "Tu", start: "10:30", end: "11:50" },
        { day: "Th", start: "10:30", end: "11:50" },
      ],
    },
    {
      code: "MATH1014",
      section: "L1",
      instructor: "Cheung, E.",
      quota: 100,
      venue: "LTB",
      meetings: [
        { day: "Mo", start: "12:00", end: "13:20" },
        { day: "Fr", start: "12:00", end: "13:20" },
      ],
    },
    {
      code: "LANG1402",
      section: "T1",
      instructor: "Ho, F.",
      quota: 20,
      venue: "3001",
      meetings: [
        { day: "Tu", start: "09:00", end: "10:20" },
        { day: "Th", start: "09:00", end: "10:20" },
      ],
    },
  ];

  for (const offering of offerings) {
    await prisma.offering.create({
      data: {
        courseId: courses[offering.code].id,
        termId: fall.id,
        section: offering.section,
        instructor: offering.instructor,
        quota: offering.quota,
        venue: offering.venue,
        meetings: {
          create: offering.meetings.map((meeting) => ({
            day: meeting.day,
            startMin: toMinutes(meeting.start),
            endMin: toMinutes(meeting.end),
          })),
        },
      },
    });
  }

  await prisma.plan.create({
    data: {
      name: "Undeclared SENG sample",
      intakeYear: 2025,
      declared: false,
      programId: comp.id,
      semesters: {
        create: {
          year: 1,
          season: "Fall",
          courses: {
            create: [
              { courseId: courses.COMP1021.id },
              { courseId: courses.MATH1013.id },
              { courseId: courses.LANG1402.id },
              { courseId: courses.HUMA1000.id },
            ],
          },
        },
      },
    },
  });

  console.log("Seeded HKUST schools, programs, courses, and Fall 2025-26 sections.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
