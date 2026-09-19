import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import logo from "../assets/ustrack-logo.png";
import { apiGet } from "../lib/api";
import { useCollapsed } from "../lib/collapse";
import { usePlanner } from "../lib/PlannerContext";
import { studentHeading } from "../lib/planner";
import type { DegreeProfile } from "../lib/types";
import { CollapseButton } from "./CollapseButton";
import { CareerIcon, DegreeIcon, HistoryIcon, OverviewIcon, TimetableIcon } from "./NavIcons";
import { ProfileAvatar } from "./ProfileAvatar";
import { ThemeToggle } from "./ThemeToggle";

const links = [
  { href: "/", label: "Overview", icon: OverviewIcon },
  { href: "/timetable", label: "Timetable", icon: TimetableIcon },
  { href: "/degree", label: "Degree", icon: DegreeIcon },
  { href: "/history", label: "History", icon: HistoryIcon },
  { href: "/career", label: "Career", icon: CareerIcon },
];

export function Sidebar() {
  const { plannerId, profile } = usePlanner();
  const [identity, setIdentity] = useState<{ title: string; detail: string } | null>(null);
  const [collapsed, setCollapsed] = useCollapsed("ust-track:sidebar-collapsed");

  useEffect(() => {
    let cancelled = false;
    const fallback = profile ? { title: profile.label, detail: profile.name } : null;
    setIdentity(fallback);
    apiGet<DegreeProfile>(`/api/degree/profile?planner_id=${plannerId}`)
      .then((next) => {
        if (!cancelled) setIdentity(studentHeading(next) ?? fallback);
      })
      .catch(() => {
        if (!cancelled) setIdentity(fallback);
      });
    return () => {
      cancelled = true;
    };
  }, [plannerId, profile]);

  return (
    <header
      className={`flex w-full min-w-0 shrink-0 flex-col overflow-hidden border-b border-line bg-bg transition-[width] duration-200 ease-in-out sm:h-full sm:border-r sm:border-b-0 ${
        collapsed ? "sm:w-16" : "sm:w-48"
      }`}
    >
      <div
        className={`flex items-center gap-2 px-3 py-2 transition-[gap] duration-200 ${
          collapsed ? "sm:flex-col sm:justify-center sm:gap-1.5 sm:px-2" : "justify-between"
        }`}
      >
        <NavLink to="/" className={`flex items-center gap-2 ${collapsed ? "sm:hidden" : ""}`}>
          <img src={logo} alt="USTrack" className="h-auto w-28 max-w-full sm:w-40" />
        </NavLink>
        <div className="flex items-center gap-2 sm:hidden">
          <ProfileAvatar />
          <ThemeToggle />
        </div>
        <CollapseButton
          collapsed={collapsed}
          onClick={() => setCollapsed(!collapsed)}
          side="left"
          label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="hidden sm:flex"
        />
      </div>

      <nav className="flex gap-1 overflow-x-auto px-2 pb-2 text-[13px] sm:flex-1 sm:flex-col sm:overflow-visible">
        {links.map((link) => (
          <NavLink
            key={link.href}
            to={link.href}
            end={link.href === "/"}
            title={link.label}
            className={({ isActive }) =>
              `flex shrink-0 items-center gap-2 rounded-xl px-2.5 py-1.5 transition-all ${
                collapsed ? "sm:justify-center sm:gap-0 sm:px-1.5" : ""
              } ${isActive ? "bg-ink font-medium text-bg shadow-soft" : "text-muted hover:bg-fill hover:text-ink"}`
            }
          >
            <link.icon className="h-4 w-4 shrink-0" />
            <span
              className={`overflow-hidden whitespace-nowrap transition-[opacity,max-width] duration-200 ease-in-out ${
                collapsed ? "sm:max-w-0 sm:opacity-0" : "max-w-[10rem] opacity-100"
              }`}
            >
              {link.label}
            </span>
          </NavLink>
        ))}
      </nav>

      <div className="hidden flex-col gap-2 px-3 py-3 sm:flex">
        <p
          className={`overflow-hidden text-[11px] leading-4 whitespace-nowrap text-muted transition-[opacity,max-height] duration-200 ease-in-out ${
            collapsed ? "max-h-0 opacity-0" : "max-h-4 opacity-100"
          }`}
        >
          {identity ? identity.title : "HKUST catalog"}
        </p>
        <div className={`flex items-center gap-2 transition-[flex-direction] ${collapsed ? "flex-col" : "justify-between"}`}>
          <ProfileAvatar />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
