import { redirect } from "@tanstack/react-router";
import { authStore } from "./auth-store";
import type { Role } from "./erp-data";

const ROLE_DASHBOARD: Record<Role, string> = {
  Supervisor: "/supervisor",
  Administrator: "/administrator",
  A1: "/a1",
  "A1+": "/a1plus",
};

// Client-side auth guard — redirects unauthenticated users to /login.
// On SSR (no window) this is a no-op; actual auth is enforced by server
// functions via requireSessionUser().
export async function requireAuth() {
  if (typeof window === "undefined") return;
  const state = authStore.getState();
  if (!state.isAuthenticated) {
    throw redirect({ to: "/login" });
  }
}

// Client-side role guard — redirects unauthenticated users to /login,
// and authenticated users with the wrong role to their own dashboard.
export async function requireRole(expectedRole: Role) {
  if (typeof window === "undefined") return;
  const state = authStore.getState();
  if (!state.isAuthenticated) {
    throw redirect({ to: "/login" });
  }
  if (state.role !== expectedRole) {
    throw redirect({ to: ROLE_DASHBOARD[state.role!] });
  }
}
