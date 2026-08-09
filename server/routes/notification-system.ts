import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { supabaseServer } from "../lib/supabase-server.js";
import { requireSessionUser } from "../lib/session.js";
import { logAction } from "../lib/audit.js";

export const notificationSystemRouter = Router();

const NOTIFICATION_EVENTS = [
  "approval_pending", "approval_approved", "approval_rejected",
  "gate_pass_otp", "gate_pass_created", "low_stock", "payment_recorded",
  "pr_created", "po_issued", "material_received", "qc_failed", "escalation_triggered",
] as const;

// GET /api/notification-system/preferences
notificationSystemRouter.get("/preferences", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);

    const { data: prefs } = await supabaseServer
      .from("notification_preferences")
      .select("id, event_type, sms, whatsapp, email, in_app")
      .eq("user_id", user.id)
      .order("event_type", { ascending: true });

    const existingMap = new Map((prefs ?? []).map((p: any) => [p.event_type, p]));
    const complete = NOTIFICATION_EVENTS.map((eventType) => {
      const existing = existingMap.get(eventType);
      return existing ?? { id: null, event_type: eventType, sms: false, whatsapp: false, email: false, in_app: true };
    });

    res.json({ data: complete });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ data: [], error: err.message });
      return;
    }
    console.error("fetchNotificationPreferences error:", err);
    res.status(500).json({ data: [], error: "Failed to fetch preferences" });
  }
});

// POST /api/notification-system/preferences/update
notificationSystemRouter.post("/preferences/update", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const { event_type, sms, whatsapp, email, in_app } = req.body as Record<string, any>;

    const { error } = await supabaseServer.from("notification_preferences").upsert(
      {
        user_id: user.id,
        event_type,
        sms: sms ?? false,
        whatsapp: whatsapp ?? false,
        email: email ?? false,
        in_app: in_app ?? true,
      },
      { onConflict: "user_id,event_type" },
    );

    if (error) {
      res.json({ success: false, error: "Failed to update preference" });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("updateNotificationPreference error:", err);
    res.status(500).json({ success: false, error: "Failed to update preference" });
  }
});

// GET /api/notification-system/queue
notificationSystemRouter.get("/queue", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (user.role === "Supervisor") {
      res.json({ data: [] });
      return;
    }

    const { status, limit } = req.query as Record<string, string>;
    let query = supabaseServer
      .from("notification_queue")
      .select("id, user_id, channel, recipient, subject, body, status, provider, error, attempts, created_at, sent_at")
      .order("created_at", { ascending: false })
      .limit(parseInt(limit ?? "100", 10));

    if (status) query = query.eq("status", status);

    const { data: items } = await query;

    const userIds = [...new Set((items ?? []).map((n: any) => n.user_id).filter(Boolean))];
    const { data: users } = await supabaseServer.from("users").select("id, name").in("id", userIds);
    const userMap = new Map((users ?? []).map((u: any) => [u.id, u.name]));

    res.json({
      data: (items ?? []).map((n: any) => ({
        ...n,
        user_name: n.user_id ? (userMap.get(n.user_id) ?? "—") : "—",
      })),
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ data: [], error: err.message });
      return;
    }
    console.error("fetchNotificationQueue error:", err);
    res.status(500).json({ data: [], error: "Failed to fetch queue" });
  }
});

// POST /api/notification-system/enqueue
notificationSystemRouter.post("/enqueue", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const { user_id, channel, recipient, subject, body, metadata } = req.body as Record<string, any>;

    const { error } = await supabaseServer.from("notification_queue").insert({
      user_id: user_id ?? null,
      channel,
      recipient,
      subject: subject ?? null,
      body,
      metadata: metadata ?? {},
      status: "pending",
    });

    if (error) {
      res.json({ success: false, error: "Failed to enqueue notification" });
      return;
    }

    await logAction(user, "enqueue_notification", "notification", user_id ?? "unknown", {
      channel,
      recipient,
    });
    res.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("enqueueNotification error:", err);
    res.status(500).json({ success: false, error: "Failed to enqueue notification" });
  }
});

// POST /api/notification-system/process
notificationSystemRouter.post("/process", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (user.role === "Supervisor") {
      res.json({ success: false, error: "Only administrators can process notifications" });
      return;
    }
    const { limit } = req.body as { limit?: number };

    const { data: pending } = await supabaseServer
      .from("notification_queue")
      .select("*")
      .eq("status", "pending")
      .lt("attempts", 3)
      .order("created_at", { ascending: true })
      .limit(limit ?? 50);

    let sent = 0;
    let failed = 0;

    for (const notif of pending ?? []) {
      // Stub — actual provider integration requires API keys
      const success = false;
      const errorMsg = "Provider not configured";

      await supabaseServer
        .from("notification_queue")
        .update({
          status: success ? "sent" : "failed",
          error: success ? null : errorMsg,
          attempts: notif.attempts + 1,
          sent_at: success ? new Date().toISOString() : null,
        })
        .eq("id", notif.id);

      if (success) sent++;
      else failed++;
    }

    res.json({ success: true, sent, failed, total: (pending ?? []).length });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("processPendingNotifications error:", err);
    res.status(500).json({ success: false, error: "Failed to process notifications" });
  }
});

// GET /api/notification-system/provider-status
notificationSystemRouter.get("/provider-status", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (user.role === "Supervisor") {
      res.json({ data: {} });
      return;
    }

    const sms = {
      configured: !!(process.env["TWILIO_ACCOUNT_SID"] && process.env["TWILIO_AUTH_TOKEN"] && process.env["TWILIO_FROM_NUMBER"]),
      provider: "Twilio",
      missing: [
        !process.env["TWILIO_ACCOUNT_SID"] && "TWILIO_ACCOUNT_SID",
        !process.env["TWILIO_AUTH_TOKEN"] && "TWILIO_AUTH_TOKEN",
        !process.env["TWILIO_FROM_NUMBER"] && "TWILIO_FROM_NUMBER",
      ].filter(Boolean) as string[],
    };

    const whatsapp = {
      configured: !!(process.env["GUPSHUP_API_KEY"] && process.env["GUPSHUP_FROM_NUMBER"]),
      provider: "Gupshup",
      missing: [
        !process.env["GUPSHUP_API_KEY"] && "GUPSHUP_API_KEY",
        !process.env["GUPSHUP_FROM_NUMBER"] && "GUPSHUP_FROM_NUMBER",
      ].filter(Boolean) as string[],
    };

    const email = {
      configured: !!(process.env["AWS_SES_ACCESS_KEY"] && process.env["AWS_SES_SECRET_KEY"] && process.env["AWS_SES_FROM_EMAIL"]),
      provider: "AWS SES",
      missing: [
        !process.env["AWS_SES_ACCESS_KEY"] && "AWS_SES_ACCESS_KEY",
        !process.env["AWS_SES_SECRET_KEY"] && "AWS_SES_SECRET_KEY",
        !process.env["AWS_SES_FROM_EMAIL"] && "AWS_SES_FROM_EMAIL",
      ].filter(Boolean) as string[],
    };

    res.json({ data: { sms, whatsapp, email } });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ data: {}, error: err.message });
      return;
    }
    console.error("fetchProviderStatus error:", err);
    res.status(500).json({ data: {}, error: "Failed to fetch provider status" });
  }
});
