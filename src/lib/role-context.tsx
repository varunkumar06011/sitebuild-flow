import {
  createContext,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { Role } from "./erp-data";
import { authStore } from "./auth-store";

// Context value exposing the current role and auth actions to consuming components.
type RoleCtx = {
  role: Role;
  name: string | null;
  isAuthenticated: boolean;
  setRole: (r: Role) => void;
  setUser: (user: { role: Role; name: string }) => void;
  logout: () => void;
};

const Ctx = createContext<RoleCtx>({
  role: "Supervisor",
  name: null,
  isAuthenticated: false,
  setRole: () => {},
  setUser: () => {},
  logout: () => {},
});

const DEFAULT_AUTH_STATE = { role: null, name: null, isAuthenticated: false } as const;

// React context provider that exposes the current role and auth actions via the auth store.
export function RoleProvider({ children }: { children: ReactNode }) {
  const authState = useSyncExternalStore(
    (cb) => authStore.subscribe(cb),
    () => authStore.getState(),
    () => DEFAULT_AUTH_STATE,
  );

  const [overrideRole, setOverrideRole] = useState<Role | null>(null);
  // Default to Supervisor (least privilege) when unauthenticated.
  // Authenticated routes are guarded by requireRole() so this fallback
  // only applies to login/portal pages that don't use role for logic.
  const role: Role = overrideRole ?? authState.role ?? "Supervisor";

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

// Hook that returns the current role context value (role, auth state, actions).
export const useRole = () => useContext(Ctx);
