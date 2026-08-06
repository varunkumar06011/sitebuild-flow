import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { Role } from "./erp-data";

type RoleCtx = { role: Role; setRole: (r: Role) => void };

const Ctx = createContext<RoleCtx>({ role: "Administrator", setRole: () => {} });

export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role>("Administrator");
  const value = useMemo(() => ({ role, setRole }), [role]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useRole = () => useContext(Ctx);
