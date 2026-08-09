import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { supabaseServer } from "../lib/supabase-server.js";
import { requireSessionUser } from "../lib/session.js";

export const notificationsRouter = Router();

// GET /api/notifications/fetch — fetches notifications for the current user.
notificationsRouter.get("/fetch", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const page = parseInt(req.query["page"] as string, 10) || 1;
    const limit = parseInt(req.query["limit"] as string, 10) || 20;
    const unreadOnly = req.query["unreadOnly"] === "true";
    const offset = (page - 1) * limit;

    let query = supabaseServer
      .from("notifications")
      .select("id, type, title, body, data, read, created_at", { count: "exact" })
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (unreadOnly) query = query.eq("read", false);

    const { data: notifications, count } = await query;

    res.json({ data: notifications ?? [], total: count ?? 0, page, limit });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("fetchNotifications error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch notifications" });
  }
});

// POST /api/notifications/mark-read — marks a single notification as read.
notificationsRouter.post("/mark-read", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = z.object({ id: z.string().uuid() }).parse(req.body);

    const { error } = await supabaseServer
      .from("notifications")
      .update({ read: true })
      .eq("id", data.id)
      .eq("user_id", user.id);

    if (error) {
      res.json({ success: false, error: "Failed to mark notification" });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("markNotificationRead error:", err);
    res.status(500).json({ success: false, error: "Failed to mark notification" });
  }
});

// POST /api/notifications/mark-all-read — marks all unread notifications as read.
notificationsRouter.post("/mark-all-read", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);

    const { error } = await supabaseServer
      .from("notifications")
      .update({ read: true })
      .eq("user_id", user.id)
      .eq("read", false);

    if (error) {
      res.json({ success: false, error: "Failed to mark all notifications" });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("markAllNotificationsRead error:", err);
    res.status(500).json({ success: false, error: "Failed to mark all notifications" });
  }
});
