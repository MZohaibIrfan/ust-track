import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { apiGet, apiPost } from "./api";
import { clearPlannerId, setPlannerId } from "./planner";
import type { AuthUser } from "./types";

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  signup: (email: string, password: string, displayName?: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  markOnboarded: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<AuthUser>("/api/auth/me")
      .then((u) => {
        setPlannerId(u.planner_id);
        setUser(u);
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const u = await apiPost<AuthUser>("/api/auth/login", { email, password });
    setPlannerId(u.planner_id);
    setUser(u);
    return u;
  }

  async function signup(email: string, password: string, displayName?: string) {
    const u = await apiPost<AuthUser>("/api/auth/signup", {
      email,
      password,
      display_name: displayName || null,
    });
    setPlannerId(u.planner_id);
    setUser(u);
    return u;
  }

  async function logout() {
    await apiPost("/api/auth/logout", {});
    clearPlannerId();
    setUser(null);
  }

  async function markOnboarded() {
    // Optimistic: flip the local flag immediately so the caller can navigate to the
    // main app right away instead of waiting on this round-trip. The real timestamp
    // still lands in the background — if it fails, the app just isn't gated on
    // /onboarding again, which is harmless for a completed session.
    setUser((current) => (current ? { ...current, onboarding_completed_at: new Date().toISOString() } : current));
    try {
      const u = await apiPost<AuthUser>("/api/auth/complete-onboarding", {});
      setUser(u);
    } catch {
      // already marked onboarded locally — fine to leave it there
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout, markOnboarded }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
