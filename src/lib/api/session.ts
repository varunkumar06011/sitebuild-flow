// Stubbed session module for the frontend.
// The real session logic now lives in the Express server (/server/lib/session.ts).
// This stub exists only so unconverted API modules (that still import from here)
// can compile. Their server functions will not be called at runtime — the
// frontend now calls the Express API directly via src/lib/api-client.ts.
import type { Role } from "../erp-data";

export type SessionUser = {
  id: string;
  name: string;
  role: Role;
  phone: string | null;
};

// Stubs that throw — these should never be called from the frontend.
// If they are, it means a route is still using an unconverted server function.
export async function getSessionUser(): Promise<SessionUser | null> {
  throw new Error("getSessionUser is not available on the client — API not yet migrated");
}

export async function requireSessionUser(): Promise<SessionUser> {
  throw new Error("requireSessionUser is not available on the client — API not yet migrated");
}

export async function requireRole(_allowedRoles: Role[]): Promise<SessionUser> {
  throw new Error("requireRole is not available on the client — API not yet migrated");
}
