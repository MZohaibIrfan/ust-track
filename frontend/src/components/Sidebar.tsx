import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import logo from "../assets/ustrack-logo.png";
import { apiGet } from "../lib/api";
import { getPlannerId, studentHeading } from "../lib/planner";
import type { DegreeProfile } from "../lib/types";
import { ProfileAvatar } from "./ProfileAvatar";
import { ThemeToggle } from "./ThemeToggle";

const links = [
  { href: "/", label: "Overview" },
  { href: "/timetable", label: "Timetable" },
  { href: "/degree", label: "Degree" },
  { href: "/history", label: "History" },
  { href: "/career", label: "Career" },
];

export function Sidebar() {
  const [identity, setIdentity] = useState<{ title: string; detail: string } | null>(null);

  useEffect(() => {
    apiGet<DegreeProfile>(`/api/degree/profile?planner_id=${getPlannerId()}`)
      .then((profile) => setIdentity(studentHeading(profile)))
      .catch(() => {
        // backend may not be running yet
      });
  }, []);

  return (
    <header className="flex w-full min-w-0 shrink-0 flex-col border-b border-line bg-bg sm:h-full sm:w-48 sm:border-r sm:border-b-0">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <NavLink to="/" className="flex items-center gap-2">
          <img src={logo} alt="USTrack" className="h-auto w-28 max-w-full sm:w-40" />
        </NavLink>
        <div className="flex items-center gap-2 sm:hidden">
          <ProfileAvatar />
          <ThemeToggle />
        </div>
      </div>

      <nav className="flex gap-0.5 overflow-x-auto px-2 pb-2 text-[13px] sm:flex-1 sm:flex-col sm:overflow-visible">
        {links.map((link) => (
          <NavLink
            key={link.href}
            to={link.href}
            end={link.href === "/"}
            className={({ isActive }) =>
              `flex shrink-0 items-center rounded-md px-2 py-1.5 transition-colors ${
                isActive ? "bg-fill font-medium text-ink" : "text-muted hover:bg-fill hover:text-ink"
              }`
            }
          >
            {link.label}
          </NavLink>
        ))}
      </nav>

      <div className="hidden flex-col gap-2 px-3 py-3 sm:flex">
        <p className="text-[11px] leading-4 text-muted">
          {identity ? identity.title : "HKUST catalog"}
        </p>
        <div className="flex items-center justify-between gap-2">
          <ProfileAvatar />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
