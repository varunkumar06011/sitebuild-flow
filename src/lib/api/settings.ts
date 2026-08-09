// Frontend API wrapper for organization settings calls.
// These functions call the Express API server instead of TanStack server functions.
import { api } from "../api-client";

// GET /api/settings/fetch
export function fetchOrgSettings(): Promise<{
  success: boolean;
  error?: string;
  data?: any;
}> {
  return api.get("/api/settings/fetch");
}

// POST /api/settings/update
export function updateOrgSettings(data: {
  name: string;
  gst_number?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  phone?: string;
  email?: string;
  logo_url?: string;
}): Promise<{ success: boolean; error?: string }> {
  return api.post("/api/settings/update", data);
}
