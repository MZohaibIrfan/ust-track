import type { RequirementGroupProgress, RequirementItemProgress } from "../lib/types";

const MARK: Record<RequirementItemProgress["status"], string> = {
  done: "✓",
  in_progress: "·",
  missing: "○",
  info: "–",
};

const MARK_COLOR: Record<RequirementItemProgress["status"], string> = {
  done: "text-accent",
  in_progress: "text-ink",
  missing: "text-muted",
  info: "text-muted",
};

function Item({ item }: { item: RequirementItemProgress }) {
  return (
    <div className="flex items-baseline gap-2 border-t border-line py-1.5 first:border-t-0">
      <span className={`w-4 shrink-0 font-mono text-xs ${MARK_COLOR[item.status]}`}>{MARK[item.status]}</span>
      <span className="flex-1 text-[13px]">{item.course_code ?? item.note}</span>
      {item.course_code && item.note ? <span className="shrink-0 text-[12px] text-muted">{item.note}</span> : null}
    </div>
  );
}

export function RequirementGroup({ group }: { group: RequirementGroupProgress }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface-raised">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-bg px-3 py-1.5">
        <span className="text-[13px] font-medium">{group.name}</span>
        <span className="font-mono text-[11px] text-muted tabular-nums">
          {group.of > 0 ? `${group.done} of ${group.of}` : null}
          {group.min_credits ? `${group.of > 0 ? " · " : ""}${group.min_credits} cr min` : ""}
        </span>
      </div>
      <div className="px-3 py-0.5">
        {group.items.map((item, i) => (
          <Item key={i} item={item} />
        ))}
      </div>
      {group.children.length > 0 ? (
        <div className="flex flex-col gap-2 border-t border-line p-2">
          {group.children.map((child, i) => (
            <RequirementGroup key={i} group={child} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
