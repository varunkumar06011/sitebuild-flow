import { redirect } from "@tanstack/react-router";
import { authStore } from "./auth-store";
import type { Role } from "./erp-data";

const ROLE_DASHBOARD: Record<Role, string> = {
  Supervisor: "/supervisor",
  Administrator: "/administrator",
  A1: "/a1",
  "A1+": "/a1plus",
};

// Shared flag to prevent handleAuthError (router.tsx) from firing
// multiple times. Router.tsx calls setLogoutInProgress() to coordinate.
let logoutInProgress = false;

// Exported so router.tsx can coordinate and prevent double-logout.
export function setLogoutInProgress() {
  logoutInProgress = true;
  setTimeout(() => { logoutInProgress = false; }, 2000);
}

export function isLogoutInProgress() {
  return logoutInProgress;
}

// Client-side auth guard — redirects unauthenticated users to /login.
// Checks localStorage synchronously (instant). Session validity is
// enforced by API calls returning 401, which triggers handleAuthError
// in router.tsx. This is the standard SPA pattern.
export function requireAuth() {
  if (typeof window === "undefined") return;
  const state = authStore.getState();
  if (!state.isAuthenticated) {
    throw redirect({ to: "/login" });
  }
}

// Client-side role guard — redirects unauthenticated users to /login,
// and authenticated users with the wrong role to their own dashboard.
// All checks are synchronous (localStorage) for instant navigation.
export function requireRole(expectedRole: Role) {
  if (typeof window === "undefined") return;
  const state = authStore.getState();
  if (!state.isAuthenticated) {
    throw redirect({ to: "/login" });
  }
  if (state.role && state.role !== expectedRole) {
    throw redirect({ to: ROLE_DASHBOARD[state.role] });
  }
}
