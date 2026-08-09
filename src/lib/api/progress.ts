// Frontend API wrapper for progress calls.
// These functions call the Express API server instead of TanStack server functions.
import { api } from "../api-client";

// GET /api/progress/fetch
export function fetchProgress(): Promise<{ data: any[] }> {
  return api.get("/api/progress/fetch");
}

// POST /api/progress/update
export function updateProgress(data: {
  block: string;
  pct: number;
}): Promise<{ success: boolean; error?: string }> {
  return api.post("/api/progress/update", data);
}
