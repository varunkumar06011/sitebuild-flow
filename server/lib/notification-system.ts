// Server-side notification dispatcher — called by route handlers when events occur.
// Resolves user preferences, creates in-app notifications, and enqueues external
// channel deliveries (SMS/WhatsApp/email). All failures are caught and logged
// so notification problems never break the main operation.
import { supabaseServer } from "./supabase-server.js";
import type { Role } from "./erp-data.js";

// Event types that can trigger notifications
const NOTIFICATION_EVENTS = [
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
  "new_pr",
  "approval_request",
  "approval_result",
] as const;

// Deep-link route map: maps an event type to a route template that includes
// the entity ID.  The client uses this to navigate from a notification to the
// relevant record.
const EVENT_DEEP_LINKS: Record<string, (entityId: string) => string> = {
  approval_pending: (id) => `/approvals?id=${id}`,
  approval_approved: (id) => `/procurement?id=${id}`,
  approval_rejected: (id) => `/procurement?id=${id}`,
  gate_pass_otp: (id) => `/gate-pass?id=${id}`,
  gate_pass_created: (id) => `/gate-pass?id=${id}`,
  low_stock: (id) => `/inventory?tab=stock`,
  payment_recorded: (id) => `/procurement?id=${id}`,
  pr_created: (id) => `/procurement?id=${id}`,
  po_issued: (id) => `/procurement?id=${id}`,
  material_received: (id) => `/procurement?id=${id}`,
  qc_failed: (id) => `/quality?id=${id}`,
  escalation_triggered: (id) => `/approvals?id=${id}`,
};

// Dispatches a notification event to the appropriate users.
// - targetRoles: notify all users with these roles
// - targetUserIds: notify specific users by ID
// - Both can be used together; duplicates are de-duplicated.
// - entityType/entityId are used for the deep-link route and audit log.
// All errors are caught — notification dispatch must never break the caller.
export async function dispatchNotification(params: {
  event: string;
  title: string;
  body: string;
  entityType: string;
  entityId: string;
  targetRoles?: Role[];
  targetUserIds?: string[];
}): Promise<void> {
  const { event, title, body, entityType, entityId, targetRoles, targetUserIds } = params;

  try {
    // 1. Resolve target user IDs
    const userIds = new Set<string>();

    if (targetUserIds) {
      for (const id of targetUserIds) userIds.add(id);
    }

    if (targetRoles && targetRoles.length > 0) {
      const { data: roleUsers } = await supabaseServer
        .from("users")
        .select("id")
        .in("role", targetRoles);
      for (const u of roleUsers ?? []) userIds.add(u.id);
    }

    if (userIds.size === 0) return;

    // 2. Fetch user preferences for this event type
    const userIdList = [...userIds];
    const { data: prefs } = await supabaseServer
      .from("notification_preferences")
      .select("user_id, sms, whatsapp, email, in_app")
      .eq("event_type", event)
      .in("user_id", userIdList);

    const prefMap = new Map((prefs ?? []).map((p: any) => [p.user_id, p]));

    // 3. Fetch user contact info for external channels
    const { data: users } = await supabaseServer
      .from("users")
      .select("id, phone, email")
      .in("id", userIdList);

    const userMap = new Map((users ?? []).map((u: any) => [u.id, u]));

    // 4. Build deep-link route
    const linkFn = EVENT_DEEP_LINKS[event];
    const link = linkFn ? linkFn(entityId) : null;
    const notifData = { entity_type: entityType, entity_id: entityId, link, event };

    // 5. Create in-app notifications + enqueue external channel deliveries
    const inAppInserts: any[] = [];
    const queueInserts: any[] = [];

    for (const userId of userIdList) {
      const pref = prefMap.get(userId);
      // Default: in_app=true if no preference is set
      const wantInApp = pref?.in_app ?? true;
      const wantSms = pref?.sms ?? false;
      const wantWhatsapp = pref?.whatsapp ?? false;
      const wantEmail = pref?.email ?? false;

      if (wantInApp) {
        inAppInserts.push({
          user_id: userId,
          type: event,
          title,
          body,
          data: notifData,
        });
      }

      const userInfo = userMap.get(userId);
      if (wantSms && userInfo?.phone) {
        queueInserts.push({
          user_id: userId,
          channel: "sms",
          recipient: userInfo.phone,
          subject: title,
          body,
          metadata: notifData,
          status: "pending",
        });
      }
      if (wantWhatsapp && userInfo?.phone) {
        queueInserts.push({
          user_id: userId,
          channel: "whatsapp",
          recipient: userInfo.phone,
          subject: title,
          body,
          metadata: notifData,
          status: "pending",
        });
      }
      if (wantEmail && userInfo?.email) {
        queueInserts.push({
          user_id: userId,
          channel: "email",
          recipient: userInfo.email,
          subject: title,
          body,
          metadata: notifData,
          status: "pending",
        });
      }
    }

    // Insert in-app notifications
    if (inAppInserts.length > 0) {
      await supabaseServer.from("notifications").insert(inAppInserts);
    }

    // Enqueue external channel deliveries
    if (queueInserts.length > 0) {
      await supabaseServer.from("notification_queue").insert(queueInserts);
    }
  } catch (err) {
    console.error(`dispatchNotification failed (${event}):`, err);
  }
}
