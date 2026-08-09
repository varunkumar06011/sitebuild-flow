import { api } from "../api-client";

export function fetchBackupLog(params?: { limit?: number }) {
  return api.get("/api/backup/log", params);
}

export function runBackupVerification(data?: { notes?: string }) {
  return api.post("/api/backup/run-verification", data ?? {});
}
