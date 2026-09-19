import { NavLink } from "react-router-dom";

const DEMO_NAME = "Demo Student";

export function ProfileAvatar() {
  const initials = DEMO_NAME.split(" ")
    .map((part) => part[0])
    .join("");

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
      {initials}
    </NavLink>
  );
}
