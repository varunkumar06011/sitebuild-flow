import { api } from "../api-client";

export function fetchPunchItems(params?: {
  page?: number;
  limit?: number;
  zone?: string;
  status?: string;
  severity?: string;
  assignedVendorId?: string;
}) {
  return api.get("/api/punch-list/fetch", params);
}

export function createPunchItem(data: {
  zone: string;
  room?: string;
  description: string;
  photo_path?: string;
  assigned_vendor_id?: string | null;
  severity?: "Low" | "Medium" | "High" | "Critical";
}) {
  return api.post("/api/punch-list/create", data);
}

export function updatePunchItemStatus(data: {
  id: string;
  status: "Open" | "In Progress" | "Resolved" | "Verified";
}) {
  return api.post("/api/punch-list/update-status", data);
}

export function getZoneReadinessSummary() {
  return api.get("/api/punch-list/zone-readiness");
}
