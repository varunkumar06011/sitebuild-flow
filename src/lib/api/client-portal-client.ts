import { api } from "../api-client";

export function fetchClientDashboard(): Promise<{ data: any }> {
  return api.get("/api/client-portal/dashboard");
}

export function fetchClientProgress(): Promise<{ data: any[] }> {
  return api.get("/api/client-portal/progress");
}

export function fetchClientBudget(): Promise<{ data: any[] }> {
  return api.get("/api/client-portal/budget");
}

export function fetchClientQuality(): Promise<{ data: any[] }> {
  return api.get("/api/client-portal/quality");
}

export function fetchClientGatePass(): Promise<{ data: any[] }> {
  return api.get("/api/client-portal/gate-pass");
}
