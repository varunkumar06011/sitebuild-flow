// Frontend API wrapper for retention calls.
import { api } from "../api-client";

// GET /api/retention/fetch
export function fetchRetentionRecords(data: {
  releaseStatus?: string;
  search?: string;
}): Promise<{
  data: any[];
  total: number;
  summary: {
    total_held: number;
    total_released: number;
    eligible_for_release: number;
  };
}> {
  return api.get("/api/retention/fetch", data);
}

// POST /api/retention/create
export function createRetentionRecord(data: {
  vendor_id: string;
  contract_ref?: string;
  total_contract_value: number;
  retention_percentage: number;
  retention_held: number;
  retention_released?: number;
  defect_liability_start?: string;
  defect_liability_end?: string;
  release_status?: "Held" | "Eligible" | "Released";
  released_date?: string;
  notes?: string;
}): Promise<{ success: boolean; error?: string; id?: string }> {
  return api.post("/api/retention/create", data);
}

// POST /api/retention/update
export function updateRetentionRecord(data: {
  id: string;
  vendor_id?: string;
  contract_ref?: string;
  total_contract_value?: number;
  retention_percentage?: number;
  retention_held?: number;
  retention_released?: number;
  defect_liability_start?: string;
  defect_liability_end?: string;
  release_status?: "Held" | "Eligible" | "Released";
  released_date?: string;
  notes?: string;
}): Promise<{ success: boolean; error?: string }> {
  return api.post("/api/retention/update", data);
}
