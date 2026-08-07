import type { Role } from "./erp-data";

export async function requireAuth() {
  // Session validation handled by API server functions via requireSessionUser
}

export async function requireRole(_expectedRole: Role) {
  // Session validation handled by API server functions via requireSessionUser
}
