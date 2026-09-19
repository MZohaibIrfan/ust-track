export type PlannerId = string;

export type AuthUser = {
  id: string;
  email: string;
  display_name: string | null;
  planner_id: string;
  onboarding_completed_at: string | null;
};

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

export type CourseHit = {
  course_code: string;
  title: string | null;
  credits: number | null;
};

export type CommonCoreLabel = {
  id: string;
  family: string;
  area: string;
  group: string;
  wcq_text: string;
};

export type SectionKind = "lecture" | "tutorial" | "lab" | "other";
export type MatchMode = "aligned" | "any";

export type CatalogSection = {
  section_code: string;
  kind: SectionKind;
  number: string;
  instructor: string;
  quota: number | null;
  avail: number | null;
  remarks: string;
  meetings: Meeting[];
};

export type CatalogOffering = {
  term_code: string;
  term_label: string;
  matching: { tutorials: MatchMode; labs: MatchMode };
  sections: CatalogSection[];
};

export type CourseDetail = {
  course_code: string;
  title: string | null;
  credits: number | null;
  description: string;
  offerings: CatalogOffering[];
  error?: string;
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
  plan?: Plan;
  replaces_course_code?: string;
  replaces_section_code?: string;
};

export type RemovedPayload = {
  ok: boolean;
  removed: number;
  error?: string;
  plan?: Plan;
};

export type DeclaredProgram = {
  code: string | null;
  name?: string | null;
  school?: string | null;
  role: string;
  intake_year: number | null;
};
export type CourseRecord = {
  course_code: string | null;
  status: string;
  title?: string | null;
  credits?: number | null;
  term_label?: string | null;
};

export type AcademicHistoryStatus = "taken" | "transferred" | "in_progress";

export type AcademicHistoryRow = {
  course_code: string;
  title: string;
  term: string;
  grade: string | null;
  units: number;
  status: AcademicHistoryStatus;
};

export type DegreeProfile = {
  planner_id: string;
  entry_year: number | null;
  standing_year?: number | null;
  intake_year?: number | null;
  catalog_year?: string | null;
  declared_programs: DeclaredProgram[];
  courses: CourseRecord[];
};

export type AcademicYear = {
  code: string;
  start_year: number;
};

export type CatalogProgram = {
  code: string;
  name: string;
  school: string;
  kind: string | null;
  year: string | null;
  duration?: string | null;
  has_requirements?: boolean;
};

export type RequirementItemProgress = {
  course_code: string | null;
  note: string | null;
  status: "done" | "in_progress" | "missing" | "info" | "excluded";
  excluded_by?: string[] | null;
  double_counts?: string[] | null;
  sort_index?: number;
};

export type RequirementGroupProgress = {
  name: string;
  kind: string;
  min_credits: number | null;
  items: RequirementItemProgress[];
  done: number;
  of: number;
  status?: "done" | "in_progress" | "missing" | "info";
  children: RequirementGroupProgress[];
  sort_index?: number;
};

export type RequirementProgress = {
  code: string;
  name: string;
  school?: string;
  kind?: string | null;
  year?: string | null;
  duration?: string | null;
  award_title?: string | null;
  catalog_year?: string | null;
  intake_year?: number | null;
  requirements: RequirementGroupProgress[];
  summary?: string;
  error?: string;
};

export type ProgramOverlap = { course_code: string; programs: string[] };

export type ProgramActionPayload = {
  ok?: boolean;
  proposed?: boolean;
  code: string;
  name: string;
  role: string;
  overlaps: ProgramOverlap[];
  error?: string;
  fork?: boolean;
  planner_id?: string;
  label?: string;
};

export type StudyPlanMove = {
  id?: string;
  code?: string | null;
  label?: string;
  from?: string;
  to?: string;
};

export type StudyPlanActionPayload = {
  ok?: boolean;
  proposed?: boolean;
  title: string;
  summary: string;
  year?: number;
  season?: string;
  status?: string;
  moved?: StudyPlanMove[];
  deferral?: { needed: boolean; year?: number; reason?: string } | null;
  courses?: {
    id: string;
    code: string | null;
    label: string;
    credits: number;
    options: string[];
    locked: boolean;
    status: "done" | "in_progress" | "planned" | "open";
    year: number | null;
    season: "fall" | "spring" | null;
  }[];
  term_statuses?: Record<string, "regular" | "exchange" | "leave">;
  added?: StudyPlanMove[];
  skipped?: { code: string; reason: string }[];
  error?: string;
};

export type Experience = {
  id: string;
  title: string;
  organization: string;
  location: string;
  kind: string;
  start_date: string | null;
  end_date: string | null;
  description: string;
};

export type CourseMatch = {
  course_code: string;
  title: string;
  credits: number;
  matched_terms: string[];
  score: number;
  in_major: boolean;
  status: string | null;
  prereq_gap: boolean;
};

export type JobMatchResult = {
  matched_keywords: string[];
  major?: string | null;
  already_relevant: CourseMatch[];
  recommended: CourseMatch[];
  error?: string;
};

export type CvGenerationSummary = {
  id: string;
  full_name: string;
  experience_count: number;
  created_at: string;
};

export type ExperienceMatch = {
  id: string;
  title: string;
  kind: string;
  matched_terms: string[];
  score: number;
};

export type ExperienceSelectionResult = {
  matched_keywords: string[];
  selected: ExperienceMatch[];
  not_selected: ExperienceMatch[];
  error?: string;
};

export type DegreePathway = {
  planner_id: string;
  label: string;
  home: boolean;
  declared_programs: DeclaredProgram[];
};

export type StudyPlanSlotStatus = "done" | "in_progress" | "planned" | "open";

export type StudyPlanSlot = {
  kind: "course" | "choice" | "bucket";
  label: string;
  codes: string[];
  credits: { min: number; max: number };
  credits_label: string;
  note: string | null;
  tag: string | null;
  status: StudyPlanSlotStatus;
  matched_code: string | null;
};

export type StudyPlanTerm = {
  season: string;
  label: string;
  credits: { min: number; max: number };
  credits_label: string;
  zero_credit: string[];
  slots: StudyPlanSlot[];
};

export type StudyPlanYear = {
  year: number;
  label: string;
  current: boolean;
  terms: StudyPlanTerm[];
};

export type StudyPlanVariant = {
  id: string;
  label: string;
  title: string;
  notes: string[];
  years: StudyPlanYear[];
};

export type StudyPathway = {
  available: boolean;
  program_code: string;
  intake_year?: number;
  catalog_year?: string;
  source_url?: string;
  source_label?: string;
  notes?: string[];
  year_note?: string | null;
  suggested_variant?: string;
  suggest_reason?: string | null;
  has_minor?: boolean;
  standing_year?: number | null;
  variants?: StudyPlanVariant[];
};

