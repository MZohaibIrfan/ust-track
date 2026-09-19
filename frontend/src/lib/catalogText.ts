/** Official catalog wording from ugadmin 2026-27 program sheets. */

export const COMP_ELECTIVES_RULE =
  "COMP Electives (5 courses from the specified elective list, of which at least 3 courses should be taken from 1 area and at least 2 courses outside that area (including course(s) in the Courses Without Associated Area). Students may use at most one course under Deep Learning Applications (COMP 4471 and COMP 5215) to count towards this elective requirement.)";

export const COMP_2000_RULE =
  "COMP 2000-level or above Elective (Any course(s) of the subject and level as specified)";

export const COSC_2000_RULE =
  "COMP 2000-level or above Electives [Any 6 courses of the subject and level as specified. For students who have taken the 6-credit course COMP 4981 or COMP 4981H to fulfill this elective requirement, the minimum number of courses required to satisfy this requirement may be reduced by one. With approval by the Dean or the Dean's designate, students may use up to 3 computer science related courses (9 credits) offered by non-CSE department(s) to count towards this requirement.]";

export const COMP_4900_NOTE =
  "Students are required to take COMP 4900 for every regular term in which they are in residency at HKUST with major in COMP";

export const COSC_4900_NOTE =
  "Students are required to take COMP 4900 for every regular term in which they are in residency at HKUST with major in COSC";

export const BIEN_ELECTIVES_RULE =
  "Bioengineering Electives (5 courses from the specified elective list, of which at least 9 credits should be taken from a single specialty area (Area 1 or Area 2). Out of the 15 credits taken, at least 9 credits should be at 4000-level or above. Courses taken as Major Required Courses may not be counted towards this elective requirement.)";

export const BIEN_MINOR_ELECTIVES_RULE =
  "Bioengineering Electives (3 courses from the specified list, of which at least one course must be at 4000-level)";

export const BIEN_LIFS_EXEMPTION =
  "Students with level 3 or above in HKDSE 1x Biology are exempted from taking LIFS 1901";

export const SENG_INTRO_NOTE =
  "Engineering Introduction course (If the students take an introduction course included in their major, this course can be counted towards their major requirement.)";

export const ELEC_3000_RULE =
  "ELEC 3000-level or above Electives (Courses of the subject and level as specified, out of which at least 2 courses must be at 4000-level. ELEC 4940 cannot be used to count towards this elective requirement)";

export const ELEC_MATH_RULE_6 =
  "(ELEC 2600 OR ELEC 2600H) OR MATH 2011 OR MATH 2111 OR MATH 2350 OR MATH 2351 (3 courses out of 6)";

export const ELEC_MATH_RULE_5 =
  "ELEC 2600 OR MATH 2011 OR MATH 2111 OR MATH 2350 OR MATH 2351 (3 courses out of 5)";

function isCosc2000(text: string, programCode?: string): boolean {
  return (
    /any 6 course/i.test(text) ||
    /non-cse/i.test(text) ||
    /electives\s*\[/i.test(text) ||
    (/4981/i.test(text) && /2000-level/i.test(text)) ||
    ((programCode || "").toUpperCase() === "COSC" && /2000-level or above/i.test(text))
  );
}

const OFFICIAL_RULES: { test: (text: string, programCode?: string) => boolean; text: string }[] = [
  { test: (text, program) => isCosc2000(text, program), text: COSC_2000_RULE },
  {
    test: (text, program) =>
      (program || "").toUpperCase() === "MINOR-BIEN" &&
      (/bioengineering electives/i.test(text) || /^Electives$/i.test(text.trim()) || /3 courses from the specified/i.test(text)),
    text: BIEN_MINOR_ELECTIVES_RULE,
  },
  {
    test: (text, program) =>
      (program || "").toUpperCase() === "BIEN" &&
      (/bioengineering electives/i.test(text) || /specialty area/i.test(text) || /^Electives$/i.test(text.trim()) || /5 courses from the specified/i.test(text)),
    text: BIEN_ELECTIVES_RULE,
  },
  { test: (text) => /hkdse/i.test(text) && /lifs 1901/i.test(text), text: BIEN_LIFS_EXEMPTION },
  { test: (text) => /engineering introduction course/i.test(text), text: SENG_INTRO_NOTE },
  {
    test: (text) => /ELEC 3000-level or above/i.test(text) || (/3000-level or above Electives/i.test(text) && /4940|4000-level/i.test(text)),
    text: ELEC_3000_RULE,
  },
  {
    test: (text) => /3 courses out of/i.test(text) && /ELEC 2600/i.test(text) && (/2600H/i.test(text) || /out of 6/i.test(text)),
    text: ELEC_MATH_RULE_6,
  },
  {
    test: (text) => /3 courses out of/i.test(text) && /ELEC 2600/i.test(text),
    text: ELEC_MATH_RULE_5,
  },
  {
    test: (text) => /specified elective list/i.test(text) || /^COMP Electives\b/i.test(text),
    text: COMP_ELECTIVES_RULE,
  },
  {
    test: (text, program) => /2000-level or above/i.test(text) && !isCosc2000(text, program),
    text: COMP_2000_RULE,
  },
  {
    test: (text, program) => /take COMP 4900/i.test(text) && (/COSC/i.test(text) || (program || "").toUpperCase() === "COSC"),
    text: COSC_4900_NOTE,
  },
  { test: (text) => /take COMP 4900/i.test(text), text: COMP_4900_NOTE },
  { test: (text) => /^Courses Without Associated$/i.test(text.trim()), text: "Courses Without Associated Area" },
];

export function completeCatalogText(text: string | null | undefined, programCode?: string): string {
  const raw = (text ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return text ?? "";
  for (const rule of OFFICIAL_RULES) {
    if (rule.test(raw, programCode)) return rule.text;
  }
  return text ?? "";
}
