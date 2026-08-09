// Frontend API wrapper for daily diary calls.
// These functions call the Express API server instead of TanStack server functions.
import { api } from "../api-client";

// GET /api/daily-diary/fetch
export function fetchDailyDiary(data: {
  date?: string;
}): Promise<any> {
  return api.get("/api/daily-diary/fetch", data);
}
