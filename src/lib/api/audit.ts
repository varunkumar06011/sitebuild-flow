// Frontend API wrapper for audit log calls.
// These functions call the Express API server instead of TanStack server functions.
import { api } from "../api-client";

// GET /api/audit/fetch
export function fetchAuditLog(data: {
  page?: number;
  limit?: number;
  entityType?: string;
  entityId?: string;
}): Promise<{ data: any[]; total: number; page: number; limit: number }> {
  return api.get("/api/audit/fetch", data);
}

// Stub for logAction — the real implementation lives in the Express server.
// Unconverted API modules import this, but their server functions are never
// called from the frontend. This stub exists only for compilation.
export async function logAction(
  _user: any,
  _action: string,
  _entityType: string,
  _entityId: string,
  _details?: Record<string, unknown>,
): Promise<void> {
  throw new Error("logAction is not available on the client — API not yet migrated");
}
