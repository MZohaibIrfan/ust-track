import { useState } from "react";
import type { RequirementGroupProgress, RequirementItemProgress } from "../lib/types";

const STATUS: Record<RequirementItemProgress["status"], string> = {
  done: "Done",
  in_progress: "This term",
  missing: "Open",
  info: "",
};

function CourseRow({
  item,
  depth,
}: {
  item: RequirementItemProgress;
  depth: number;
}) {
  if (item.status === "info") {
    return (
      <p className="border-b border-line py-1.5 pr-3 text-[12px] leading-5 text-muted" style={{ paddingLeft: 12 + depth * 16 }}>
        {item.note}
      </p>
    );
  }

  return (
    <div
      className="grid grid-cols-[6.75rem_minmax(0,1fr)_4.75rem] items-baseline gap-3 border-b border-line py-[7px] pr-3 text-[13px]"
      style={{ paddingLeft: 12 + depth * 16 }}
    >
      <span className="font-mono">{item.course_code}</span>
      <span className="min-w-0 truncate text-muted" title={item.note ?? undefined}>
        {item.note}
      </span>
      <span className="text-right text-[12px] text-muted">{STATUS[item.status]}</span>
    </div>
  );
}

function groupCaption(group: RequirementGroupProgress): string | null {
  const note = group.items.find((item) => item.status === "info" && item.note)?.note;
  if (group.kind === "or_group") return note ?? group.name;
  return null;
}

export function RequirementGroup({
  group,
  depth = 0,
}: {
  group: RequirementGroupProgress;
  depth?: number;
}) {
  const courses = group.items.filter((item) => item.course_code);
  const isArea = group.kind === "area" || group.kind === "elective_list";
  const longList = isArea && courses.length > 6;
  const [open, setOpen] = useState(!longList);
  const caption = groupCaption(group);
  const courseItems = group.items.filter((item) => item.status !== "info");

  if (depth === 0) {
    return (
      <section>
        <div className="sticky top-0 z-[1] flex items-baseline justify-between gap-3 border-b border-line bg-bg px-3 py-1.5">
          <h3 className="text-[11px] font-medium tracking-wide text-muted uppercase">{group.name}</h3>
          <span className="font-mono text-[11px] text-muted tabular-nums">
            {group.of > 0 ? `${group.done}/${group.of}` : longList ? `${courses.length}` : null}
          </span>
        </div>
        {group.items
          .filter((item) => item.status === "info" && !caption)
          .map((item, i) => (
            <CourseRow key={`info-${i}`} item={item} depth={0} />
          ))}
        {courseItems.map((item, i) => (
          <CourseRow key={i} item={item} depth={0} />
        ))}
        {group.children.map((child, i) => (
          <RequirementGroup key={i} group={child} depth={1} />
        ))}
      </section>
    );
  }

  return (
    <div>
      <button
        type="button"
        disabled={!longList}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-baseline justify-between gap-3 border-b border-line py-1.5 pr-3 text-left"
        style={{ paddingLeft: 12 + depth * 16 }}
      >
        <span className="min-w-0 text-[12px] text-muted">{caption ?? group.name}</span>
        <span className="shrink-0 font-mono text-[11px] text-muted tabular-nums">
          {longList ? (open ? "Hide" : `${courses.length} courses`) : group.of > 0 ? `${group.done}/${group.of}` : null}
        </span>
      </button>
      {open
        ? courseItems.map((item, i) => <CourseRow key={i} item={item} depth={depth + 1} />)
        : null}
      {open
        ? group.children.map((child, i) => <RequirementGroup key={i} group={child} depth={depth + 1} />)
        : null}
    </div>
  );
}
