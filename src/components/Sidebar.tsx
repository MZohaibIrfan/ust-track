"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Overview" },
  { href: "/courses", label: "Courses" },
  { href: "/programs", label: "Pathways" },
  { href: "/advisor", label: "Advisor" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <header className="flex shrink-0 flex-col border-b border-line bg-surface sm:h-screen sm:w-56 sm:border-r sm:border-b-0">
      <Link
        href="/"
        className="flex items-center gap-2 border-b border-line px-5 py-4 sm:border-b-0"
      >
        <span className="h-2.5 w-2.5 rounded-full bg-accent" aria-hidden />
        <span className="font-mono text-xs tracking-[0.25em] text-ink uppercase">
          UST Track
        </span>
      </Link>

      <nav className="flex flex-1 gap-1 overflow-x-auto px-2 py-2 text-sm sm:flex-col sm:gap-0.5 sm:overflow-visible sm:px-3">
        {links.map((link) => {
          const active =
            link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`shrink-0 rounded-sm px-3 py-2 transition-colors ${
                active
                  ? "bg-accent-soft font-medium text-ink"
                  : "text-muted hover:bg-accent-soft/60 hover:text-ink"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>

      <p className="hidden border-t border-line px-5 py-4 font-mono text-[11px] leading-5 text-muted sm:block">
        Structured HKUST course data.
        <br />
        Fall 2025-26 catalog.
      </p>
    </header>
  );
}
