// Frontend API wrapper for notification calls.
// These functions call the Express API server instead of TanStack server functions.
import { api } from "../api-client";

// GET /api/notifications/fetch
export function fetchNotifications(data: {
  page?: number;
  limit?: number;
  unreadOnly?: boolean;
}): Promise<{ data: any[]; total: number; page: number; limit: number }> {
  return api.get("/api/notifications/fetch", data);
}

// POST /api/notifications/mark-read
export function markNotificationRead(data: { id: string }): Promise<{ success: boolean }> {
  return api.post("/api/notifications/mark-read", data);
}

// POST /api/notifications/mark-all-read
export function markAllNotificationsRead(): Promise<{ success: boolean }> {
  return api.post("/api/notifications/mark-all-read");
}
