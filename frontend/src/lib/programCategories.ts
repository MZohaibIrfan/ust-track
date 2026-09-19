import type { CatalogProgram } from "./types";

export const CATEGORIES: { id: string; label: string }[] = [
  { id: "major", label: "Major" },
  { id: "minor", label: "Minor" },
  { id: "extended_major", label: "Extended major" },
  { id: "dual", label: "Dual degree" },
  { id: "framework", label: "Framework" },
  { id: "common_core", label: "Common core" },
];

const CATEGORY_COLOR_SLUGS: Record<string, string> = {
  major: "major",
  minor: "minor",
  extended_major: "extended-major",
  dual: "dual",
  framework: "framework",
  common_core: "common-core",
};

export function categoryColorClasses(category: string): { text: string; bg: string; border: string; dot: string } {
  const slug = CATEGORY_COLOR_SLUGS[category] ?? "major";
  return {
    text: `text-cat-${slug}`,
    bg: `bg-cat-${slug}-soft`,
    border: `border-cat-${slug}`,
    dot: `bg-cat-${slug}`,
  };
}

export function categoryFor(program: CatalogProgram): string {
  if (program.kind === "minor") return "minor";
  if (program.kind === "extended_major") return "extended_major";
  if (program.kind === "dual") return "dual";
  if (program.kind === "framework") return "framework";
  if (program.code === "UNIV-CC" || program.kind === "common_core") return "common_core";
  return "major";
}

export function roleFor(program: CatalogProgram): string {
  if (program.kind === "minor") return "minor";
  if (program.kind === "extended_major") return "extended_major";
  if (program.kind === "dual") return "dual_degree";
  if (program.code === "UNIV-CC") return "school_requirement";
  return "major";
}
