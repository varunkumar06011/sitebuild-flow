// Frontend API wrapper for aerb-compliance calls.
import { api } from "../api-client";

// GET /api/aerb-compliance/fetch
export function fetchAerbCompliance(data: {
  page?: number;
  limit?: number;
  result?: string;
  search?: string;
}): Promise<{ data: any[]; total: number; page: number; limit: number }> {
  return api.get("/api/aerb-compliance/fetch", data);
}

// POST /api/aerb-compliance/create
export function createAerbRecord(data: {
  area: string;
  shielding_type?: string;
  material?: string;
  thickness?: string;
  batch_id?: string;
  inspection_date?: string;
  result?: "Pass" | "Fail" | "Re-test";
  dose_survey_value?: number;
  dose_survey_unit?: string;
  license_number?: string;
  license_expiry?: string;
  notes?: string;
  photos?: string[];
}): Promise<{ success: boolean; error?: string; id?: string }> {
  return api.post("/api/aerb-compliance/create", data);
}

// POST /api/aerb-compliance/update
export function updateAerbRecord(data: {
  id: string;
  area?: string;
  shielding_type?: string;
  material?: string;
  thickness?: string;
  batch_id?: string;
  inspection_date?: string;
  result?: "Pass" | "Fail" | "Re-test";
  dose_survey_value?: number;
  dose_survey_unit?: string;
  license_number?: string;
  license_expiry?: string;
  notes?: string;
  photos?: string[];
}): Promise<{ success: boolean; error?: string }> {
  return api.post("/api/aerb-compliance/update", data);
}
