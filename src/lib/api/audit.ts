import { createServerFn } from "@tanstack/react-start";
import { supabaseServer } from "../supabase-server";
import { requireSessionUser, type SessionUser } from "./session";

export async function logAction(
  user: SessionUser,
  action: string,
  entityType: string,
  entityId: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  try {
    await supabaseServer.from("audit_log").insert({
      user_id: user.id,
      action,
      entity_type: entityType,
      entity_id: entityId,
      details,
    });
  } catch (err) {
    console.error("Failed to log audit action:", err);
  }
}

export const fetchAuditLog = createServerFn({ method: "GET" })
  .validator((input: { page?: number; limit?: number; entityType?: string; entityId?: string }) => input)
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();
    if (user.role !== "A1+") {
      return { data: [], total: 0, page: 1, limit: 20 };
    }

    const page = data.page ?? 1;
    const limit = data.limit ?? 20;
    const offset = (page - 1) * limit;

    let query = supabaseServer
      .from("audit_log")
      .select("id, user_id, action, entity_type, entity_id, details, created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (data.entityType) query = query.eq("entity_type", data.entityType);
    if (data.entityId) query = query.eq("entity_id", data.entityId);

    const { data: logs, count } = await query;

    const userIds = [...new Set((logs ?? []).map((l: any) => l.user_id))];
    const { data: users } = await supabaseServer
      .from("users")
      .select("id, name, role")
      .in("id", userIds);

    const userMap = new Map((users ?? []).map((u: any) => [u.id, u]));

    return {
      data: (logs ?? []).map((l: any) => ({
        ...l,
        user_name: userMap.get(l.user_id)?.name ?? "Unknown",
        user_role: userMap.get(l.user_id)?.role ?? "Supervisor",
      })),
      total: count ?? 0,
      page,
      limit,
    };
  });
