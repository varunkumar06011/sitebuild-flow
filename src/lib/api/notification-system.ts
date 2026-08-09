export {
  fetchNotificationPreferences,
  updateNotificationPreference,
  fetchNotificationQueue,
  enqueueNotification,
  processPendingNotifications,
  fetchProviderStatus,
} from "./notification-system-client";

export const NOTIFICATION_EVENTS = [
  "approval_pending",
  "approval_approved",
  "approval_rejected",
  "gate_pass_otp",
  "gate_pass_created",
  "low_stock",
  "payment_recorded",
  "pr_created",
  "po_issued",
  "material_received",
  "qc_failed",
  "escalation_triggered",
] as const;
