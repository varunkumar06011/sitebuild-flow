import { api } from "../api-client";

export function fetchNotificationPreferences() {
  return api.get("/notification-system/preferences");
}

export function updateNotificationPreference(data: {
  event_type: string;
  sms?: boolean;
  whatsapp?: boolean;
  email?: boolean;
  in_app?: boolean;
}) {
  return api.post("/notification-system/preferences/update", data);
}

export function fetchNotificationQueue(params?: {
  status?: string;
  limit?: number;
}) {
  return api.get("/notification-system/queue", params);
}

export function enqueueNotification(data: {
  user_id?: string;
  channel: "sms" | "whatsapp" | "email" | "in_app";
  recipient: string;
  subject?: string;
  body: string;
  metadata?: Record<string, unknown>;
}) {
  return api.post("/notification-system/enqueue", data);
}

export function processPendingNotifications(data?: { limit?: number }) {
  return api.post("/notification-system/process", data ?? {});
}

export function fetchProviderStatus() {
  return api.get("/notification-system/provider-status");
}
