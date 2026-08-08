// Notification system — queue for SMS/WhatsApp/Email delivery + user preferences.
// Actual sending requires provider API keys (Twilio/Gupshup/SES) configured as env vars.
// This module provides the queue, preference management, and a send scaffold.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseServer } from "../supabase-server";
import { requireSessionUser } from "./session";
import { logAction } from "./audit";
import type { Role } from "../erp-data";

const ADMIN_ROLES: Role[] = ["Administrator", "A1", "A1+"];
function isAdmin(role: Role): boolean {
  return ADMIN_ROLES.includes(role);
}

// Event types that can trigger notifications
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

// ---------------------------------------------------------------------------
// Notification preferences
// ---------------------------------------------------------------------------

export const fetchNotificationPreferences = createServerFn({ method: "GET" })
  .validator((input: {}) => input)
  .handler(async () => {
    const user = await requireSessionUser();

    const { data: prefs } = await supabaseServer
      .from("notification_preferences")
      .select("id, event_type, sms, whatsapp, email, in_app")
      .eq("user_id", user.id)
      .order("event_type", { ascending: true });

    // Build a complete list including defaults for events without preferences
    const existingMap = new Map((prefs ?? []).map((p: any) => [p.event_type, p]));
    const complete = NOTIFICATION_EVENTS.map((eventType) => {
      const existing = existingMap.get(eventType);
      return (
        existing ?? {
          id: null,
          event_type: eventType,
          sms: false,
          whatsapp: false,
          email: false,
          in_app: true,
        }
      );
    });

    return { data: complete };
  });

export const updateNotificationPreference = createServerFn({ method: "POST" })
  .validator(
    z.object({
      event_type: z.string(),
      sms: z.boolean().optional(),
      whatsapp: z.boolean().optional(),
      email: z.boolean().optional(),
      in_app: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireSessionUser();

    const { error } = await supabaseServer.from("notification_preferences").upsert(
      {
        user_id: user.id,
        event_type: data.event_type,
        sms: data.sms ?? false,
        whatsapp: data.whatsapp ?? false,
        email: data.email ?? false,
        in_app: data.in_app ?? true,
      },
      { onConflict: "user_id,event_type" },
    );

    if (error) return { success: false, error: "Failed to update preference" };

    return { success: true };
  });

// ---------------------------------------------------------------------------
// Notification queue — admin view
// ---------------------------------------------------------------------------

export const fetchNotificationQueue = createServerFn({ method: "GET" })
  .validator((input: { status?: string; limit?: number }) => input)
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    if (!isAdmin(user.role)) {
      return { data: [] };
    }

    let query = supabaseServer
      .from("notification_queue")
      .select(
        "id, user_id, channel, recipient, subject, body, status, provider, error, attempts, created_at, sent_at",
      )
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 100);

    if (data.status) {
      query = query.eq("status", data.status);
    }

    const { data: items } = await query;

    // Resolve user names
    const userIds = [...new Set((items ?? []).map((n: any) => n.user_id).filter(Boolean))];
    const { data: users } = await supabaseServer.from("users").select("id, name").in("id", userIds);
    const userMap = new Map((users ?? []).map((u: any) => [u.id, u.name]));

    return {
      data: (items ?? []).map((n: any) => ({
        ...n,
        user_name: n.user_id ? (userMap.get(n.user_id) ?? "—") : "—",
      })),
    };
  });

// ---------------------------------------------------------------------------
// Enqueue notification (called by other modules when events occur)
// ---------------------------------------------------------------------------

export const enqueueNotification = createServerFn({ method: "POST" })
  .validator(
    z.object({
      user_id: z.string().uuid().optional(),
      channel: z.enum(["sms", "whatsapp", "email", "in_app"]),
      recipient: z.string(),
      subject: z.string().optional(),
      body: z.string(),
      metadata: z.record(z.any()).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireSessionUser();

    const { error } = await supabaseServer.from("notification_queue").insert({
      user_id: data.user_id ?? null,
      channel: data.channel,
      recipient: data.recipient,
      subject: data.subject ?? null,
      body: data.body,
      metadata: data.metadata ?? {},
      status: "pending",
    });

    if (error) return { success: false, error: "Failed to enqueue notification" };

    await logAction(user, "enqueue_notification", "notification", data.user_id ?? "unknown", {
      channel: data.channel,
      recipient: data.recipient,
    });
    return { success: true };
  });

// ---------------------------------------------------------------------------
// Process pending notifications (would be called by a cron job)
// Actual sending is a stub — requires provider API keys
// ---------------------------------------------------------------------------

export const processPendingNotifications = createServerFn({ method: "POST" })
  .validator(z.object({ limit: z.number().optional() }))
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    if (!isAdmin(user.role)) {
      return { success: false, error: "Only administrators can process notifications" };
    }

    const { data: pending } = await supabaseServer
      .from("notification_queue")
      .select("*")
      .eq("status", "pending")
      .lt("attempts", 3)
      .order("created_at", { ascending: true })
      .limit(data.limit ?? 50);

    let sent = 0;
    let failed = 0;

    for (const notif of pending ?? []) {
      // Attempt to send via the appropriate provider
      // This is a stub — in production, integrate with Twilio/Gupshup/SES
      const providerResult = await sendViaProvider(notif);

      await supabaseServer
        .from("notification_queue")
        .update({
          status: providerResult.success ? "sent" : "failed",
          provider: providerResult.provider,
          provider_msg_id: providerResult.messageId,
          error: providerResult.error,
          attempts: notif.attempts + 1,
          sent_at: providerResult.success ? new Date().toISOString() : null,
        })
        .eq("id", notif.id);

      if (providerResult.success) sent++;
      else failed++;
    }

    return { success: true, sent, failed, total: (pending ?? []).length };
  });

// ---------------------------------------------------------------------------
// Centralized notification dispatcher — called by any module when an event
// occurs.  Resolves user preferences, creates in-app notifications, and
// enqueues external channel deliveries (SMS/WhatsApp/email).  All failures are
// caught and logged so notification problems never break the main operation.
// ---------------------------------------------------------------------------

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
  event: (typeof NOTIFICATION_EVENTS)[number];
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

// Stub: sends a notification via the configured provider.
// In production, this would call Twilio/Gupshup/SES APIs.
async function sendViaProvider(notif: any): Promise<{
  success: boolean;
  provider?: string;
  messageId?: string;
  error?: string;
}> {
  // Check if provider credentials are configured
  const hasTwilio = !!process.env["TWILIO_ACCOUNT_SID"];
  const hasGupshup = !!process.env["GUPSHUP_API_KEY"];
  const hasSES = !!process.env["AWS_SES_ACCESS_KEY"];

  if (notif.channel === "sms" && hasTwilio) {
    // TODO: Integrate Twilio SMS API
    return { success: false, error: "Twilio integration not configured" };
  }
  if (notif.channel === "whatsapp" && hasGupshup) {
    // TODO: Integrate Gupshup WhatsApp API
    return { success: false, error: "Gupshup integration not configured" };
  }
  if (notif.channel === "email" && hasSES) {
    // TODO: Integrate AWS SES API
    return { success: false, error: "SES integration not configured" };
  }
  if (notif.channel === "in_app") {
    // In-app notifications are stored in the notifications table directly
    return { success: true, provider: "in_app", messageId: `in_app_${Date.now()}` };
  }

  return { success: false, error: `No provider configured for channel: ${notif.channel}` };
}
