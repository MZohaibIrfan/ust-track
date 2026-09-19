import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import {
  DEMO_PROFILES,
  getDemoProfile,
  getPlannerId,
  setPlannerId as persistPlannerId,
  type DemoProfile,
} from "./planner";

type PlannerContextValue = {
  plannerId: string;
  profile: DemoProfile;
  setPlannerId: (id: string) => void;
};

const PlannerContext = createContext<PlannerContextValue | null>(null);

export function PlannerProvider({ children }: { children: ReactNode }) {
  const [plannerId, setPlannerIdState] = useState(getPlannerId);
  const profile = getDemoProfile(plannerId) ?? DEMO_PROFILES[0];

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
