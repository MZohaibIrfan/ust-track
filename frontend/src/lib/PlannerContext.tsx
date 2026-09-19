import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "./auth";
import {
  getDemoProfile,
  getPlannerId,
  setPlannerId as persistPlannerId,
  type DemoProfile,
} from "./planner";

type PlannerContextValue = {
  plannerId: string;
  profile: DemoProfile | null;
  setPlannerId: (id: string) => void;
};

const PlannerContext = createContext<PlannerContextValue | null>(null);

export function PlannerProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [plannerId, setPlannerIdState] = useState(getPlannerId);
  const profile = getDemoProfile(plannerId) ?? null;

  useEffect(() => {
    setPlannerIdState(getPlannerId());
  }, [user?.planner_id]);

  const setPlannerId = useCallback((id: string) => {
    persistPlannerId(id);
    setPlannerIdState(id);
  }, []);

  const value = useMemo(
    () => ({ plannerId, profile, setPlannerId }),
    [plannerId, profile, setPlannerId],
  );

  return <PlannerContext.Provider value={value}>{children}</PlannerContext.Provider>;
}

export function usePlanner(): PlannerContextValue {
  const ctx = useContext(PlannerContext);
  if (!ctx) throw new Error("usePlanner requires PlannerProvider");
  return ctx;
}
