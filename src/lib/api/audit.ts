import { createServerFn } from "@tanstack/react-start";
import { supabaseServer } from "../supabase-server";
import { requireSessionUser, type SessionUser } from "./session";

// Inserts an audit log entry for a user action.
// Retries up to 3 times with exponential backoff. On permanent failure, logs to
// a fallback error table so audit records are not silently lost.
export async function logAction(
  user: SessionUser,
  action: string,
  entityType: string,
  entityId: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  const payload = {
    user_id: user.id,
    action,
    entity_type: entityType,
    entity_id: entityId,
    details,
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await supabaseServer.from("audit_log").insert(payload);
      return;
    } catch (err) {
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
        continue;
      }
      // Final attempt failed — log to fallback table and console
      console.error("Failed to log audit action after 3 attempts:", err);
      try {
        await supabaseServer.from("audit_log_failures").insert({
          payload,
          error: err instanceof Error ? err.message : String(err),
        });
      } catch {
        // If even the fallback fails, there's nothing more we can do
      }
    }
  }
}

// Fetches a paginated, filterable audit log with user names joined (A1+ only).
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
