import { createServerFn } from "@tanstack/react-start";
import { supabaseServer } from "../supabase-server";
import { requireSessionUser } from "./session";

// Fetches a paginated list of notifications for the current user, optionally unread only.
export const fetchNotifications = createServerFn({ method: "GET" })
  .validator((input: { page?: number; limit?: number; unreadOnly?: boolean }) => input)
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();
    const page = data.page ?? 1;
    const limit = data.limit ?? 20;
    const offset = (page - 1) * limit;

    let query = supabaseServer
      .from("notifications")
      .select("id, type, title, body, data, read, created_at", { count: "exact" })
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (data.unreadOnly) query = query.eq("read", false);

    const { data: notifications, count } = await query;

    return { data: notifications ?? [], total: count ?? 0, page, limit };
  });

// Marks a single notification as read for the current user.
export const markNotificationRead = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();

    const { error } = await supabaseServer
      .from("notifications")
      .update({ read: true })
      .eq("id", data.id)
      .eq("user_id", user.id);

    if (error) return { success: false, error: "Failed to mark notification" };
    return { success: true };
  });

// Marks all unread notifications for the current user as read.
export const markAllNotificationsRead = createServerFn({ method: "POST" })
  .handler(async ({ context }) => {
    const user = await requireSessionUser();

    const { error } = await supabaseServer
      .from("notifications")
      .update({ read: true })
      .eq("user_id", user.id)
      .eq("read", false);

    if (error) return { success: false, error: "Failed to mark all notifications" };
    return { success: true };
  });
