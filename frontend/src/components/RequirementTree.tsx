import { useState } from "react";
import type { RequirementGroupProgress, RequirementItemProgress } from "../lib/types";

const MARK: Record<NonNullable<RequirementGroupProgress["status"]>, string> = {
  done: "✓",
  in_progress: "·",
  missing: "○",
  info: "–",
};

const MARK_COLOR: Record<NonNullable<RequirementGroupProgress["status"]>, string> = {
  done: "text-accent",
  in_progress: "text-ink",
  missing: "text-muted",
  info: "text-muted",
};

function progressLabel(group: RequirementGroupProgress): string {
  if (group.of > 0) return `${group.done} of ${group.of}`;
  if (group.done > 0) return `${group.done} taken`;
  if (group.min_credits) return `${group.min_credits} cr min`;
  return "";
}

function Item({ item }: { item: RequirementItemProgress }) {
  return (
    <div className="flex items-baseline gap-2 border-t border-line py-1.5 first:border-t-0">
      <span className={`w-4 shrink-0 font-mono text-xs ${MARK_COLOR[item.status]}`}>{MARK[item.status]}</span>
      <span className="min-w-0 flex-1 text-[13px]">
        {item.course_code ? <span className="font-mono">{item.course_code}</span> : item.note}
        {item.course_code && item.note ? (
          <span className="mt-0.5 block text-[12px] text-muted">{item.note}</span>
        ) : null}
      </span>
    </div>
  );
}

const COLLAPSE_KINDS = new Set(["area", "elective_list", "remarks", "advisory_pathway", "placeholder"]);

export function RequirementGroup({
  group,
  depth = 0,
}: {
  group: RequirementGroupProgress;
  depth?: number;
}) {
  const many = group.items.length > 8 || COLLAPSE_KINDS.has(group.kind);
  const [open, setOpen] = useState(!many && group.kind !== "remarks" && group.kind !== "advisory_pathway");
  const status = group.status ?? (group.of > 0 && group.done >= group.of ? "done" : group.done > 0 ? "in_progress" : "missing");
  const label = progressLabel(group);
  const hasBody = group.items.length > 0 || group.children.length > 0;

  return (
    <div className={`overflow-hidden rounded-lg border border-line ${depth > 0 ? "bg-bg" : "bg-surface-raised"}`}>
      <button
        type="button"
        onClick={() => hasBody && setOpen((value) => !value)}
        className="flex w-full items-start justify-between gap-3 bg-bg px-3 py-1.5 text-left"
      >
        <span className="flex min-w-0 items-start gap-2">
          <span className={`mt-0.5 w-4 shrink-0 font-mono text-xs ${MARK_COLOR[status]}`}>{MARK[status]}</span>
          <span className="min-w-0 text-[13px] font-medium leading-5">{group.name}</span>
        </span>
        <span className="shrink-0 font-mono text-[11px] text-muted tabular-nums">
          {label}
          {hasBody ? <span className="ml-2 text-muted">{open ? "▾" : "▸"}</span> : null}
        </span>
      </button>
      {open && hasBody ? (
        <>
          {group.items.length > 0 ? (
            <div className="px-3 py-0.5">
              {group.items.map((item, i) => (
                <Item key={`${item.course_code ?? item.note ?? i}-${i}`} item={item} />
              ))}
            </div>
          ) : null}
          {group.children.length > 0 ? (
            <div className="flex flex-col gap-2 border-t border-line p-2">
              {group.children.map((child, i) => (
                <RequirementGroup key={`${child.name}-${i}`} group={child} depth={depth + 1} />
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
