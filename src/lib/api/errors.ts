// Frontend API wrapper for error logging calls.
// These functions call the Express API server instead of TanStack server functions.
import { api } from "../api-client";

// POST /api/errors/log
export function logError(data: {
  message: string;
  stack?: string;
  source?: string;
  route?: string;
  severity?: "error" | "warning" | "info";
  context?: Record<string, unknown>;
}): Promise<{ success: boolean }> {
  return api.post("/api/errors/log", data);
}

// GET /api/errors/fetch
export function fetchErrors(data: {
  limit?: number;
  severity?: string;
}): Promise<{ data: any[]; total: number }> {
  return api.get("/api/errors/fetch", data);
}
