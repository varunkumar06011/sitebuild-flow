// Frontend API wrapper for batch calls.
// These functions call the Express API server instead of TanStack server functions.
import { api } from "../api-client";

// GET /api/batches/fetch
export function fetchBatches(data: {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
}): Promise<{ data: any[]; total: number; page: number; limit: number }> {
  return api.get("/api/batches/fetch", data);
}

// POST /api/batches/create
export function createBatch(data: {
  batch_number: string;
  material: string;
  supplier?: string;
  manufacturer?: string;
  purchase_date?: string;
  invoice?: string;
  challan?: string;
  mtc?: string;
  lab_report?: string;
  status?: "Verified" | "Pending MTC" | "Under Test";
  photos?: string[];
}): Promise<{ success: boolean; error?: string; id?: string }> {
  return api.post("/api/batches/create", data);
}

// POST /api/batches/update
export function updateBatch(data: {
  id: string;
  batch_number?: string;
  material?: string;
  supplier?: string;
  manufacturer?: string;
  purchase_date?: string;
  invoice?: string;
  challan?: string;
  mtc?: string;
  lab_report?: string;
  status?: "Verified" | "Pending MTC" | "Under Test";
  photos?: string[];
}): Promise<{ success: boolean; error?: string }> {
  return api.post("/api/batches/update", data);
}
