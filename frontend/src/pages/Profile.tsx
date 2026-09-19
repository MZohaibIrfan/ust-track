import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet } from "../lib/api";
import { useAuth } from "../lib/auth";
import { usePlanner } from "../lib/PlannerContext";
import type { DeclaredProgram, DegreeProfile } from "../lib/types";

const MINOR_ROLES = new Set(["minor"]);

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function ProgramCard({ program }: { program: DeclaredProgram }) {
  return (
    <div className="rounded-xl border border-line bg-surface-raised p-3">
      <p className="text-[13px] font-medium text-ink">{program.name ?? program.code ?? "Unnamed program"}</p>
      <p className="mt-0.5 font-mono text-[12px] text-muted">{program.code}</p>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted">
        {program.school ? <span>{program.school}</span> : null}
        {program.intake_year ? <span>Intake {program.intake_year}</span> : null}
      </div>
    </div>
  );
}

export function ProfilePage() {
  const { plannerId, profile: demo } = usePlanner();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const displayName = user?.display_name || user?.email || demo?.name || "Signed in";
  const [profile, setProfile] = useState<DegreeProfile | null>(null);
  const [loading, setLoading] = useState(true);

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setProfile(null);
    apiGet<DegreeProfile>(`/api/degree/profile?planner_id=${plannerId}`)
      .then((next) => {
        if (!cancelled) setProfile(next);
      })
      .catch(() => {
        if (!cancelled) setProfile(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [plannerId]);

  const declared = profile?.declared_programs.filter((d) => d.code) ?? [];
  const majors = declared.filter((d) => !MINOR_ROLES.has(d.role));
  const minors = declared.filter((d) => MINOR_ROLES.has(d.role));
  const schools = [...new Set(declared.map((d) => d.school).filter((s): s is string => !!s))];

  return (
    <main className="flex h-full min-h-0 flex-col overflow-y-auto">
      <header className="shrink-0 border-b border-line px-4 py-3">
        <h1 className="text-[15px] font-semibold tracking-tight">Profile</h1>
      </header>

      <div className="flex flex-col gap-4 p-4">
        <section className="flex items-center gap-3 rounded-xl border border-line bg-surface-raised p-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[18px] font-medium text-accent">
            {initials(displayName)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[16px] font-semibold text-ink">{displayName}</p>
            {user?.display_name ? <p className="text-[12px] text-muted">{user.email}</p> : null}
            {demo ? (
              <p className="text-[12px] text-muted">
                {demo.label} · demo account
              </p>
            ) : null}
            <p className="mt-1 font-mono text-[11px] text-muted">Planner ID: {plannerId}</p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="shrink-0 rounded-xl border border-line px-2.5 py-1.5 text-[12px] font-medium hover:bg-fill"
          >
            Log out
          </button>
        </section>

        {loading ? (
          <p className="text-[13px] text-muted">Loading profile…</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-line bg-surface-raised p-3">
                <p className="text-[11px] font-medium tracking-wide text-muted uppercase">School</p>
                <p className="mt-1 text-[13px] text-ink">
                  {schools.length > 0 ? schools.join(", ") : (demo?.school ?? "HKUST")}
                </p>
              </div>
              <div className="rounded-xl border border-line bg-surface-raised p-3">
                <p className="text-[11px] font-medium tracking-wide text-muted uppercase">Year</p>
                <p className="mt-1 text-[13px] text-ink">
                  {profile?.standing_year ? `Year ${profile.standing_year}` : "Not set"}
                </p>
                {profile?.intake_year ? (
                  <p className="mt-0.5 text-[12px] text-muted">Intake {profile.intake_year}</p>
                ) : null}
              </div>
              <div className="rounded-xl border border-line bg-surface-raised p-3">
                <p className="text-[11px] font-medium tracking-wide text-muted uppercase">Catalog</p>
                <p className="mt-1 text-[13px] text-ink">{profile?.catalog_year ?? "Not set"}</p>
              </div>
            </div>

            <section className="flex flex-col gap-2">
              <p className="text-[11px] font-medium tracking-wide text-muted uppercase">
                {majors.length === 1 ? "Major" : "Majors"}
              </p>
              {majors.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {majors.map((m) => (
                    <ProgramCard key={`${m.code}-${m.role}`} program={m} />
                  ))}
                </div>
              ) : (
                <p className="text-[13px] text-muted">No major declared yet.</p>
              )}
            </section>

            <section className="flex flex-col gap-2">
              <p className="text-[11px] font-medium tracking-wide text-muted uppercase">
                {minors.length === 1 ? "Minor" : "Minors"}
              </p>
              {minors.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {minors.map((m) => (
                    <ProgramCard key={`${m.code}-${m.role}`} program={m} />
                  ))}
                </div>
              ) : (
                <p className="text-[13px] text-muted">No minor declared.</p>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
