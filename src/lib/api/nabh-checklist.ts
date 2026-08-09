// Frontend API wrapper for nabh-checklist calls.
import { api } from "../api-client";

// GET /api/nabh-checklist/fetch
export function fetchNabhChecklist(data: {
  page?: number;
  limit?: number;
  status?: string;
  category?: string;
  search?: string;
}): Promise<{ data: any[]; total: number; page: number; limit: number }> {
  return api.get("/api/nabh-checklist/fetch", data);
}

// POST /api/nabh-checklist/create
export function createNabhItem(data: {
  category: string;
  item: string;
  status?: "Pending" | "In Progress" | "Completed" | "Not Applicable";
  responsible_party?: string;
  document_path?: string;
  expiry_date?: string;
  completed_date?: string;
  notes?: string;
}): Promise<{ success: boolean; error?: string; id?: string }> {
  return api.post("/api/nabh-checklist/create", data);
}

// POST /api/nabh-checklist/update
export function updateNabhItem(data: {
  id: string;
  category?: string;
  item?: string;
  status?: "Pending" | "In Progress" | "Completed" | "Not Applicable";
  responsible_party?: string;
  document_path?: string;
  expiry_date?: string;
  completed_date?: string;
  notes?: string;
}): Promise<{ success: boolean; error?: string }> {
  return api.post("/api/nabh-checklist/update", data);
}

// POST /api/nabh-checklist/delete
export function deleteNabhItem(data: { id: string }): Promise<{ success: boolean; error?: string }> {
  return api.post("/api/nabh-checklist/delete", data);
}
