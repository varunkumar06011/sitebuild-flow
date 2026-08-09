// Frontend API wrapper for offline-sync — calls the Express API server.
import { api } from "../api-client";

export function enqueueOfflineWrite(data: {
  entity_type: string;
  payload: Record<string, unknown>;
  device_id?: string;
}): Promise<{ success: boolean; error?: string; id?: string }> {
  return api.post("/api/offline-sync/enqueue", data);
}

export function processSyncQueue(data: { batchSize?: number }): Promise<{
  success: boolean;
  processed: number;
  succeeded: number;
  failed: number;
  results: any[];
}> {
  return api.post("/api/offline-sync/process", data);
}

export function getPendingSyncCount(): Promise<{ pending_count: number }> {
  return api.get("/api/offline-sync/pending-count");
}

export function fetchSyncQueue(data: { status?: string; limit?: number }): Promise<{
  data: any[];
  total_count: number;
}> {
  return api.get("/api/offline-sync/queue", data as any);
}
