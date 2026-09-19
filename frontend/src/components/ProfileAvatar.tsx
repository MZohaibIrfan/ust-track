import { NavLink } from "react-router-dom";
import { useAuth } from "../lib/auth";

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function ProfileAvatar() {
  const { user } = useAuth();
  const label = user?.display_name || user?.email || "?";

  return (
    <NavLink
      to="/profile"
      aria-label="Profile"
      className={({ isActive }) =>
        `flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-medium transition-opacity ${
          isActive ? "bg-accent text-accent-ink" : "bg-accent-soft text-accent hover:opacity-80"
        }`
      }
    >
      {initials(label)}
    </NavLink>
  );
}
