import { api } from "../api-client";

export function fetchBackupLog(params?: { limit?: number }) {
  return api.get("/backup/log", params);
}

export function runBackupVerification(data?: { notes?: string }) {
  return api.post("/backup/run-verification", data ?? {});
}
