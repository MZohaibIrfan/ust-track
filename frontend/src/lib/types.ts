export type PlannerId = string;

export type Term = {
  code: string;
  label: string;
  season: string;
  start_date: string | null;
  end_date: string | null;
};

export type Meeting = {
  weekday: string | null;
  start_time: string | null;
  end_time: string | null;
  start_date: string | null;
  end_date: string | null;
  venue: string;
};

export type ClassSelection = {
  section_id: string;
  course_code: string;
  section_code: string;
  term_code: string;
  term_label: string;
  instructor: string;
  meetings: Meeting[];
};

export type PlannedCourse = {
  course_code: string | null;
  term_label: string | null;
  status: string;
};

export type Plan = {
  planner_id: string;
  planned_courses: PlannedCourse[];
  class_selections: ClassSelection[];
};

export type ConflictEntry = {
  a: string;
  a_section: string;
  b: string;
  b_section: string;
  weekday: string;
};

export type SectionActionPayload = {
  ok?: boolean;
  proposed?: boolean;
  course_code: string;
  section_code: string;
  term_code: string;
  meetings: Meeting[];
  conflicts: ConflictEntry[];
  error?: string;
};

export type RemovedPayload = {
  ok: boolean;
  removed: number;
  error?: string;
};
