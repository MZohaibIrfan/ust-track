import { useState } from "react";
import { completeCatalogText } from "../lib/catalogText";
import type { RequirementGroupProgress, RequirementItemProgress } from "../lib/types";

const MARK: Record<NonNullable<RequirementItemProgress["status"]>, string> = {
  done: "✓",
  in_progress: "◐",
  missing: "○",
  info: "–",
  excluded: "×",
};

const MARK_COLOR: Record<NonNullable<RequirementItemProgress["status"]>, string> = {
  done: "text-page-degree",
  in_progress: "text-page-career",
  missing: "text-muted",
  info: "text-muted",
  excluded: "text-muted",
};

const STATUS_PILL: Record<NonNullable<RequirementItemProgress["status"]>, string> = {
  done: "bg-page-degree/10 text-page-degree",
  in_progress: "bg-page-career/10 text-page-career",
  missing: "bg-fill text-muted",
  info: "bg-fill text-muted",
  excluded: "bg-fill text-muted",
};

const STATUS_LABEL: Record<NonNullable<RequirementItemProgress["status"]>, string> = {
  done: "Completed",
  in_progress: "In progress",
  missing: "Not yet",
  info: "Note",
  excluded: "Excluded",
};

function progressLabel(group: RequirementGroupProgress): string {
  if (group.of > 0) return `${group.done} of ${group.of}`;
  if (group.done > 0) return `${group.done} taken`;
  if (group.min_credits) return `${group.min_credits} cr min`;
  return "";
}

function Item({
  item,
  programCode,
  doubleCounts,
}: {
  item: RequirementItemProgress;
  programCode?: string;
  doubleCounts?: Record<string, string[]>;
}) {
  const shared = item.course_code ? doubleCounts?.[item.course_code] : undefined;
  const others = (shared ?? item.double_counts ?? []).filter((code) => code !== programCode);
  return (
    <div className="flex items-baseline gap-2 py-1.5">
      <span className={`w-4 shrink-0 font-mono text-xs ${MARK_COLOR[item.status]}`}>{MARK[item.status]}</span>
      <span className="min-w-0 flex-1 text-[13px] whitespace-normal break-words">
        {item.course_code ? (
          <span className={`font-mono ${item.status === "excluded" ? "line-through" : ""}`}>{item.course_code}</span>
        ) : (
          <span className="break-words">{completeCatalogText(item.note, programCode)}</span>
        )}
        {item.status === "excluded" && item.excluded_by?.length ? (
          <span className="mt-0.5 block text-[12px] text-muted">Excluded by {item.excluded_by.join(", ")}</span>
        ) : item.course_code && item.note ? (
          <span className="mt-0.5 block text-[12px] text-muted">{completeCatalogText(item.note, programCode)}</span>
        ) : null}
        {others.length > 0 ? (
          <span className="mt-0.5 block text-[11px] text-accent">
            Double-counts with {others.join(", ")}
          </span>
        ) : null}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium tracking-wide ${STATUS_PILL[item.status]}`}>
          {STATUS_LABEL[item.status]}
        </span>
        {others.length > 0 ? (
          <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-accent">
            Shared
          </span>
        ) : null}
      </span>
    </div>
  );
}

function progressForOr(group: RequirementGroupProgress): string {
  if (group.kind !== "or_group") return progressLabel(group);
  if (group.of > 1) return `${group.done} of ${group.of}`;
  if (group.of > 0) return `one of · ${group.done} of ${group.of}`;
  return "one of";
}

function visibleItems(group: RequirementGroupProgress, programCode?: string): RequirementItemProgress[] {
  const titles = new Set([
    completeCatalogText(group.name, programCode),
    ...group.children.map((child) => completeCatalogText(child.name, programCode)),
  ]);
  return group.items.filter((item) => {
    if (item.course_code) return true;
    return !titles.has(completeCatalogText(item.note, programCode));
  });
}

function orderedRows(group: RequirementGroupProgress) {
  const rows: { key: string; sort: number; kind: "item" | "group"; item?: RequirementItemProgress; child?: RequirementGroupProgress }[] = [
    ...group.items.map((item, i) => ({
      key: `i-${item.course_code ?? item.note ?? i}-${i}`,
      sort: item.sort_index ?? i,
      kind: "item" as const,
      item,
    })),
    ...group.children.map((child, i) => ({
      key: `g-${child.name}-${i}`,
      sort: child.sort_index ?? 100 + i,
      kind: "group" as const,
      child,
    })),
  ];
  rows.sort((a, b) => a.sort - b.sort);
  return rows;
}

const COLLAPSE_KINDS = new Set(["area", "elective_list", "remarks", "advisory_pathway", "placeholder"]);

export function RequirementGroup({
  group,
  depth = 0,
  programCode,
  doubleCounts,
}: {
  group: RequirementGroupProgress;
  depth?: number;
  programCode?: string;
  doubleCounts?: Record<string, string[]>;
}) {
  const items = visibleItems(group, programCode);
  const many = items.length > 8 || COLLAPSE_KINDS.has(group.kind);
  const [open, setOpen] = useState(!many && group.kind !== "remarks" && group.kind !== "advisory_pathway");
  const status = group.status ?? (group.of > 0 && group.done >= group.of ? "done" : group.done > 0 ? "in_progress" : "missing");
  const label = progressForOr(group);
  const hasBody = items.length > 0 || group.children.length > 0;
  const rows = orderedRows({ ...group, items });
  const mixed = items.length > 0 && group.children.length > 0;
  const bar =
    status === "done"
      ? "border-l-page-degree"
      : status === "in_progress"
        ? "border-l-page-career"
        : "border-l-line";

  return (
    <div className={`overflow-hidden rounded-lg border border-line border-l-4 ${bar} ${depth > 0 ? "bg-bg" : "bg-surface-raised"}`}>
      <button
        type="button"
        onClick={() => hasBody && setOpen((value) => !value)}
        className="flex w-full items-start justify-between gap-3 bg-bg px-3 py-1.5 text-left"
      >
        <span className="flex w-0 min-w-0 flex-1 items-start gap-2">
          <span className={`mt-0.5 w-4 shrink-0 font-mono text-xs ${MARK_COLOR[status]}`}>{MARK[status]}</span>
          <span className="w-0 min-w-0 flex-1 whitespace-normal text-[13px] font-medium leading-5 break-words">
            {completeCatalogText(group.name, programCode)}
          </span>
        </span>
        <span className="ml-2 shrink-0 font-mono text-[11px] text-muted tabular-nums">
          {label}
          {hasBody ? <span className="ml-2 text-muted">{open ? "▾" : "▸"}</span> : null}
        </span>
      </button>
      {open && hasBody ? (
        mixed ? (
          <div className="flex flex-col gap-2 border-t border-line p-2">
            {rows.map((row) =>
              row.kind === "item" && row.item ? (
                <div key={row.key} className="border-b border-line px-1 last:border-b-0">
                  <Item item={row.item} programCode={programCode} doubleCounts={doubleCounts} />
                </div>
              ) : row.child ? (
                <RequirementGroup
                  key={row.key}
                  group={row.child}
                  depth={depth + 1}
                  programCode={programCode}
                  doubleCounts={doubleCounts}
                />
              ) : null,
            )}
          </div>
        ) : (
          <>
            {items.length > 0 ? (
              <div className="divide-y divide-line px-3 py-0.5">
                {[...items]
                  .sort((a, b) => (a.sort_index ?? 0) - (b.sort_index ?? 0))
                  .map((item, i) => (
                    <Item
                      key={`${item.course_code ?? item.note ?? i}-${i}`}
                      item={item}
                      programCode={programCode}
                      doubleCounts={doubleCounts}
                    />
                  ))}
              </div>
            ) : null}
            {group.children.length > 0 ? (
              <div className="flex flex-col gap-2 border-t border-line p-2">
                {[...group.children]
                  .sort((a, b) => (a.sort_index ?? 0) - (b.sort_index ?? 0))
                  .map((child, i) => (
                    <RequirementGroup
                      key={`${child.name}-${i}`}
                      group={child}
                      depth={depth + 1}
                      programCode={programCode}
                      doubleCounts={doubleCounts}
                    />
                  ))}
              </div>
            ) : null}
          </>
        )
      ) : null}
    </div>
  );
}
