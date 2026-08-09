// Frontend API wrapper for medical-gas calls.
import { api } from "../api-client";

// GET /api/medical-gas/fetch
export function fetchGasPipelines(data: {
  page?: number;
  limit?: number;
  gas_type?: string;
  search?: string;
}): Promise<{ data: any[]; total: number; page: number; limit: number }> {
  return api.get("/api/medical-gas/fetch", data);
}

// POST /api/medical-gas/create
export function createGasPipeline(data: {
  gas_type: string;
  pipeline_segment: string;
  pressure_test_date?: string;
  pressure_test_result?: "Pass" | "Fail" | "Pending";
  leak_test_date?: string;
  leak_test_result?: "Pass" | "Fail" | "Pending";
  manifold_installed?: boolean;
  cross_connection_verified?: boolean;
  batch_id?: string;
  notes?: string;
  photos?: string[];
}): Promise<{ success: boolean; error?: string; id?: string }> {
  return api.post("/api/medical-gas/create", data);
}

// POST /api/medical-gas/update
export function updateGasPipeline(data: {
  id: string;
  gas_type?: string;
  pipeline_segment?: string;
  pressure_test_date?: string;
  pressure_test_result?: "Pass" | "Fail" | "Pending";
  leak_test_date?: string;
  leak_test_result?: "Pass" | "Fail" | "Pending";
  manifold_installed?: boolean;
  cross_connection_verified?: boolean;
  batch_id?: string;
  notes?: string;
  photos?: string[];
}): Promise<{ success: boolean; error?: string }> {
  return api.post("/api/medical-gas/update", data);
}
