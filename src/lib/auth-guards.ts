import { redirect } from "@tanstack/react-router";
import { authStore } from "./auth-store";
import { ROLE_NAV, type Role } from "./erp-data";

const roleRouteMap: Record<Role, "/supervisor" | "/administrator" | "/a1" | "/a1plus"> = {
  Supervisor: "/supervisor",
  Administrator: "/administrator",
  A1: "/a1",
  "A1+": "/a1plus",
};

export function requireAuth() {
  const state = authStore.getState();
  if (!state.isAuthenticated) {
    throw redirect({ to: "/login" });
  }
}

export function requireRole(expectedRole: Role) {
  const state = authStore.getState();
  if (!state.isAuthenticated || !state.role) {
    throw redirect({ to: "/login" });
  }
  if (state.role !== expectedRole) {
    throw redirect({ to: roleRouteMap[state.role] });
  }
}

/** Allow a shared module only when it appears in the signed-in role's navigation. */
export function requireSection(path: string) {
  const state = authStore.getState();
  if (!state.isAuthenticated || !state.role) {
    throw redirect({ to: "/login" });
  }
  const allowed = ROLE_NAV[state.role].some((n) => n.to === path);
  if (!allowed) {
    throw redirect({ to: roleRouteMap[state.role] });
  }
}
