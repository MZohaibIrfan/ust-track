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
    const u = await apiPost<AuthUser>("/api/auth/complete-onboarding", {});
    setUser(u);
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
