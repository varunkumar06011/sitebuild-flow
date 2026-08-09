import { api } from "../api-client";

export function runAnomalyDetection() {
  return api.post("/api/anomaly-detection/run", {});
}

export function fetchAnomalies(params?: {
  dismissed?: boolean;
  type?: string;
  severity?: string;
}) {
  return api.get("/api/anomaly-detection/fetch", params);
}

export function dismissAnomaly(data: { id: string }) {
  return api.post("/api/anomaly-detection/dismiss", data);
}
