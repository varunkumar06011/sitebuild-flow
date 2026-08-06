import { createContext, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Role } from "./erp-data";
import { authStore } from "./auth-store";

type RoleCtx = {
  role: Role;
  isAuthenticated: boolean;
  setRole: (r: Role) => void;
  login: (r: Role) => void;
  logout: () => void;
};

const Ctx = createContext<RoleCtx>({
  role: "Administrator",
  isAuthenticated: false,
  setRole: () => {},
  login: () => {},
  logout: () => {},
});

export function RoleProvider({ children }: { children: ReactNode }) {
  const authState = useSyncExternalStore(
    (cb) => authStore.subscribe(cb),
    () => authStore.getState(),
    () => authStore.getState(),
  );

  const [overrideRole, setOverrideRole] = useState<Role | null>(null);
  const role = overrideRole ?? authState.role ?? "Administrator";

  const value = useMemo<RoleCtx>(
    () => ({
      role,
      isAuthenticated: authState.isAuthenticated,
      setRole: (r: Role) => setOverrideRole(r),
      login: (r: Role) => {
        authStore.login(r);
        setOverrideRole(null);
      },
      logout: () => {
        authStore.logout();
        setOverrideRole(null);
      },
    }),
    [role, authState.isAuthenticated],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useRole = () => useContext(Ctx);
