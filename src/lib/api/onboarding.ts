// Frontend API wrapper for onboarding calls.
// These functions call the Express API server instead of TanStack server functions.
import { api } from "../api-client";

// GET /api/onboarding/completed
export function getCompletedSections(): Promise<{ data: string[] }> {
  return api.get("/api/onboarding/completed");
}

// POST /api/onboarding/mark-complete
export function markSectionComplete(data: {
  section_key: string;
}): Promise<{ success: boolean; error?: string }> {
  return api.post("/api/onboarding/mark-complete", data);
}
