import { createServerFn } from "@tanstack/react-start";
import { supabaseServer } from "../supabase-server";
import { getSessionUser } from "./session";

// Logs a production error to the error_log table for monitoring and debugging.
// Uses service_role so it works regardless of the user's auth state.
// Failures are swallowed — error logging must never break the app.
export const logError = createServerFn({ method: "POST" })
  .validator((input: {
    message: string;
    stack?: string | undefined;
    source?: string | undefined;
    route?: string | undefined;
    severity?: "error" | "warning" | "info";
    context?: Record<string, unknown>;
  }) => input)
  .handler(async ({ data }) => {
    try {
      // Best-effort: get user ID if session exists (don't require it)
      let userId: string | null = null;
      try {
        const user = await getSessionUser();
        if (user) userId = user.id;
      } catch {
        // no session — that's fine
      }

      await supabaseServer.from("error_log").insert({
        message: data.message,
        stack: data.stack ?? null,
        source: data.source ?? "unknown",
        route: data.route ?? null,
        user_id: userId,
        severity: data.severity ?? "error",
        context: data.context ?? {},
      });
    } catch {
      // If error logging fails, there's nothing we can do — don't throw
    }
  });

// Fetches recent errors from the error_log table (A1+ only).
export const fetchErrors = createServerFn({ method: "GET" })
  .validator((input: { limit?: number; severity?: string }) => input)
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    if (user.role !== "A1+") {
      return { data: [], total: 0 };
    }

    const limit = Math.min(data.limit ?? 50, 100);
    let query = supabaseServer
      .from("error_log")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .limit(limit);

    if (data.severity) query = query.eq("severity", data.severity);

    const { data: errors, count } = await query;
    return { data: errors ?? [], total: count ?? 0 };
  });

// Re-export to avoid circular dependency issues
async function requireSessionUser() {
  const { requireSessionUser: rsu } = await import("./session");
  return rsu();
}
