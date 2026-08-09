import { api } from "../api-client";

export function fetchIncidents(params?: {
  page?: number;
  limit?: number;
  type?: string;
  zone?: string;
  severity?: string;
  status?: string;
  contractorName?: string;
}) {
  return api.get("/api/safety/incidents", params);
}

export function reportIncident(data: {
  type?: "Incident" | "Near-miss";
  zone?: string;
  contractor_name?: string;
  description: string;
  photo_path?: string;
  severity?: "Low" | "Medium" | "High" | "Critical";
}) {
  return api.post("/api/safety/report", data);
}

export function updateIncidentStatus(data: { id: string; status: string }) {
  return api.post("/api/safety/update-status", data);
}

export function getSafetyDashboardStats(params?: {
  fromDate?: string;
  toDate?: string;
}) {
  return api.get("/api/safety/dashboard-stats", params);
}
