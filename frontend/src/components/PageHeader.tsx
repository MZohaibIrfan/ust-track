import type { ComponentType, ReactNode } from "react";

export function PageHeader({
  icon: Icon,
  badgeClassName,
  title,
  subtitle,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  badgeClassName: string;
  title: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-2.5 border-b border-line px-4 py-3">
      <span className={`flex size-8 shrink-0 items-center justify-center rounded-xl ${badgeClassName}`}>
        <Icon className="size-4.5" />
      </span>
      <div className="min-w-0">
        <h1 className="text-[16px] font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-[11px] text-muted">{subtitle}</p> : null}
      </div>
      {children ? <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div> : null}
    </header>
  );
}
