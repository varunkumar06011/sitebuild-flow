import { redirect } from "@tanstack/react-router";
import { authStore } from "./auth-store";
import type { Role } from "./erp-data";

export function requireAuth() {
  const state = authStore.getState();
  if (!state.isAuthenticated) {
    throw redirect({ to: "/login" });
  }
}

export function requireRole(expectedRole: Role) {
  const state = authStore.getState();
  if (!state.isAuthenticated) {
    throw redirect({ to: "/login" });
  }
  if (state.role !== expectedRole) {
    const roleRouteMap: Record<Role, string> = {
      Supervisor: "/supervisor",
      Administrator: "/administrator",
      A1: "/a1",
      "A1+": "/a1plus",
    };
    const target = state.role ? roleRouteMap[state.role] : "/login";
    if (target === "/login") {
      throw redirect({ to: "/login" });
    }
    throw redirect({ to: target as "/supervisor" | "/administrator" | "/a1" | "/a1plus" });
  }
}
