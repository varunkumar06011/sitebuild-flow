// Frontend API wrapper for cleanroom-validation calls.
import { api } from "../api-client";

// GET /api/cleanroom-validation/fetch
export function fetchCleanroomRecords(data: {
  page?: number;
  limit?: number;
  result?: string;
  area?: string;
  search?: string;
}): Promise<{ data: any[]; total: number; page: number; limit: number }> {
  return api.get("/api/cleanroom-validation/fetch", data);
}

// POST /api/cleanroom-validation/create
export function createCleanroomRecord(data: {
  area: string;
  test_type: string;
  iso_class?: string;
  particle_count?: number;
  ach_value?: number;
  pressure_diff?: number;
  filter_type?: string;
  filter_install_date?: string;
  filter_replacement_date?: string;
  test_date?: string;
  result?: "Pass" | "Fail" | "Re-test";
  notes?: string;
  photos?: string[];
}): Promise<{ success: boolean; error?: string; id?: string }> {
  return api.post("/api/cleanroom-validation/create", data);
}

// POST /api/cleanroom-validation/update
export function updateCleanroomRecord(data: {
  id: string;
  area?: string;
  test_type?: string;
  iso_class?: string;
  particle_count?: number;
  ach_value?: number;
  pressure_diff?: number;
  filter_type?: string;
  filter_install_date?: string;
  filter_replacement_date?: string;
  test_date?: string;
  result?: "Pass" | "Fail" | "Re-test";
  notes?: string;
  photos?: string[];
}): Promise<{ success: boolean; error?: string }> {
  return api.post("/api/cleanroom-validation/update", data);
}
