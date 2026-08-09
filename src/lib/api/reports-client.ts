// Frontend API wrapper for reports — calls the Express API server.
import { api } from "../api-client";

export function fetchProjectStatus(): Promise<any> {
  return api.get("/api/reports/project-status");
}

export function fetchVendorPerformance(): Promise<{ data: any[]; total: number }> {
  return api.get("/api/reports/vendor-performance");
}

export function fetchMaterialConsumption(): Promise<any> {
  return api.get("/api/reports/material-consumption");
}

export function fetchLabourProductivity(): Promise<any> {
  return api.get("/api/reports/labour-productivity");
}

export function fetchComplianceStatus(): Promise<any> {
  return api.get("/api/reports/compliance");
}
