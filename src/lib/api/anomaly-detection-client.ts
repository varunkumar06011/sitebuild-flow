import { api } from "../api-client";

export function runAnomalyDetection() {
  return api.post("/anomaly-detection/run", {});
}

export function fetchAnomalies(params?: {
  dismissed?: boolean;
  type?: string;
  severity?: string;
}) {
  return api.get("/anomaly-detection/fetch", params);
}

export function dismissAnomaly(data: { id: string }) {
  return api.post("/anomaly-detection/dismiss", data);
}
