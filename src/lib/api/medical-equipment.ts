// Frontend API wrapper for medical-equipment calls.
import { api } from "../api-client";

// GET /api/medical-equipment/fetch
export function fetchEquipment(data: {
  page?: number;
  limit?: number;
  status?: string;
  category?: string;
  search?: string;
}): Promise<{ data: any[]; total: number; page: number; limit: number }> {
  return api.get("/api/medical-equipment/fetch", data);
}

// POST /api/medical-equipment/create
export function createEquipment(data: {
  eq_number: string;
  name: string;
  model?: string;
  serial_number?: string;
  manufacturer?: string;
  category?: string;
  location?: string;
  vendor_id?: string;
  requisition_id?: string;
  status?: "Ordered" | "Delivered" | "Installed" | "Testing" | "Commissioned" | "Handed Over";
  warranty_start?: string;
  warranty_end?: string;
  amc_expiry?: string;
  handover_date?: string;
  handover_department?: string;
  commissioning_checklist?: { item: string; ok: boolean }[];
  certificates?: {
    type: string;
    number?: string;
    issued_date?: string;
    expiry_date?: string;
  }[];
  photos?: string[];
  notes?: string;
}): Promise<{ success: boolean; error?: string; id?: string }> {
  return api.post("/api/medical-equipment/create", data);
}

// POST /api/medical-equipment/update
export function updateEquipment(data: {
  id: string;
  eq_number?: string;
  name?: string;
  model?: string;
  serial_number?: string;
  manufacturer?: string;
  category?: string;
  location?: string;
  vendor_id?: string;
  requisition_id?: string;
  status?: "Ordered" | "Delivered" | "Installed" | "Testing" | "Commissioned" | "Handed Over";
  warranty_start?: string;
  warranty_end?: string;
  amc_expiry?: string;
  handover_date?: string;
  handover_department?: string;
  commissioning_checklist?: { item: string; ok: boolean }[];
  certificates?: {
    type: string;
    number?: string;
    issued_date?: string;
    expiry_date?: string;
  }[];
  photos?: string[];
  notes?: string;
}): Promise<{ success: boolean; error?: string }> {
  return api.post("/api/medical-equipment/update", data);
}
