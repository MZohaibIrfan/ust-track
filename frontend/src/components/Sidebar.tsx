import { NavLink } from "react-router-dom";

const links = [
  { href: "/", label: "Overview" },
  { href: "/timetable", label: "Timetable" },
  { href: "/degree", label: "Degree" },
  { href: "/career", label: "Career" },
];

export function Sidebar() {
  return (
    <header className="flex shrink-0 flex-col border-b border-line bg-surface sm:h-screen sm:w-56 sm:border-r sm:border-b-0">
      <NavLink
        to="/"
        className="flex items-center gap-2 border-b border-line px-5 py-4 sm:border-b-0"
      >
        <span className="h-2.5 w-2.5 rounded-full bg-accent" aria-hidden />
        <span className="font-mono text-xs tracking-[0.25em] text-ink uppercase">
          UST Track
        </span>
      </NavLink>

      <nav className="flex flex-1 gap-1 overflow-x-auto px-2 py-2 text-sm sm:flex-col sm:gap-0.5 sm:overflow-visible sm:px-3">
        {links.map((link) => (
          <NavLink
            key={link.href}
            to={link.href}
            end={link.href === "/"}
            className={({ isActive }) =>
              `shrink-0 rounded-sm px-3 py-2 transition-colors ${
                isActive
                  ? "bg-accent-soft font-medium text-ink"
                  : "text-muted hover:bg-accent-soft/60 hover:text-ink"
              }`
            }
          >
            {link.label}
          </NavLink>
        ))}
      </nav>

      <p className="hidden border-t border-line px-5 py-4 font-mono text-[11px] leading-5 text-muted sm:block">
        Framework only.
        <br />
        Catalog + planner schema.
      </p>
    </header>
  );
}
