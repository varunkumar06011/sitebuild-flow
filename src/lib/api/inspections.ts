// Frontend API wrapper for inspection calls.
// These functions call the Express API server instead of TanStack server functions.
import { api } from "../api-client";

// GET /api/inspections/fetch
export function fetchInspections(data: {
  page?: number;
  limit?: number;
  result?: string;
}): Promise<{ data: any[]; total: number; page: number; limit: number }> {
  return api.get("/api/inspections/fetch", data);
}

// POST /api/inspections/create
export function createInspection(data: {
  qc_number: string;
  activity: string;
  location?: string;
  inspector?: string;
  date?: string;
  result?: "Pass" | "Fail" | "Re-inspection";
  checklist?: Array<{ item: string; ok: boolean }>;
  rectification?: string | null;
  photos?: string[];
}): Promise<{ success: boolean; error?: string; id?: string }> {
  return api.post("/api/inspections/create", data);
}

// POST /api/inspections/update
export function updateInspection(data: {
  id: string;
  qc_number?: string;
  activity?: string;
  location?: string;
  inspector?: string;
  date?: string;
  result?: "Pass" | "Fail" | "Re-inspection";
  checklist?: Array<{ item: string; ok: boolean }>;
  rectification?: string | null;
  photos?: string[];
}): Promise<{ success: boolean; error?: string }> {
  return api.post("/api/inspections/update", data);
}
