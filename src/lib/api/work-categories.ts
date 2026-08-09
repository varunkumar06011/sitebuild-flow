// Frontend API wrapper for work category calls.
// These functions call the Express API server instead of TanStack server functions.
import { api } from "../api-client";

export type WorkCategory = {
  id: string;
  name: string;
  label: string;
  description: string | null;
  sort_order: number;
};

// GET /api/work-categories/fetch
export function fetchWorkCategories(): Promise<{ data: WorkCategory[] }> {
  return api.get("/api/work-categories/fetch");
}

// POST /api/work-categories/create
export function createWorkCategory(data: {
  name: string;
  label: string;
  description?: string;
  sort_order?: number;
}): Promise<{ success: boolean; error?: string; category?: WorkCategory }> {
  return api.post("/api/work-categories/create", data);
}
