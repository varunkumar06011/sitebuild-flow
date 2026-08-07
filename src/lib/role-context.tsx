import { createContext, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Role } from "./erp-data";
import { authStore } from "./auth-store";

type RoleCtx = {
  role: Role;
  name: string | null;
  isAuthenticated: boolean;
  setRole: (r: Role) => void;
  setUser: (user: { role: Role; name: string }) => void;
  logout: () => void;
};

const Ctx = createContext<RoleCtx>({
  role: "Administrator",
  name: null,
  isAuthenticated: false,
  setRole: () => {},
  setUser: () => {},
  logout: () => {},
});

const DEFAULT_AUTH_STATE = { role: null, name: null, isAuthenticated: false } as const;

export function RoleProvider({ children }: { children: ReactNode }) {
  const authState = useSyncExternalStore(
    (cb) => authStore.subscribe(cb),
    () => authStore.getState(),
    () => DEFAULT_AUTH_STATE,
  );

  const [overrideRole, setOverrideRole] = useState<Role | null>(null);
  const role = overrideRole ?? authState.role ?? "Administrator";

  const value = useMemo<RoleCtx>(
    () => ({
      role,
      name: authState.name,
      isAuthenticated: authState.isAuthenticated,
      setRole: (r: Role) => setOverrideRole(r),
      setUser: (user: { role: Role; name: string }) => {
        authStore.setUser(user);
        setOverrideRole(null);
      },
      logout: () => {
        authStore.logout();
        setOverrideRole(null);
      },
    }),
    [role, authState.isAuthenticated, authState.name],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useRole = () => useContext(Ctx);
