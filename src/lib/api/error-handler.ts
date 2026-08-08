// Centralized error handling wrapper for server functions.
// Catches thrown errors, logs them to the error_log table, and returns a
// standardized { success: false, error } response so callers always get a
// consistent shape.  Failures inside the logger itself are swallowed — error
// logging must never break the request.
import { supabaseServer } from "../supabase-server";
import type { SessionUser } from "./session";

// Standard error response returned by all wrapped handlers on failure.
export type ErrorResponse = { success: false; error: string };

// Logs an error to the error_log table (best-effort, never throws).
async function logToErrorLog(
  err: unknown,
  source: string,
  user: SessionUser | null,
  context?: Record<string, unknown>,
): Promise<void> {
  try {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? (err.stack ?? undefined) : undefined;

    await supabaseServer.from("error_log").insert({
      message,
      stack: stack ?? null,
      source,
      route: null,
      user_id: user?.id ?? null,
      severity: "error",
      context: context ?? {},
    });
  } catch {
    // If error logging fails, there's nothing we can do — don't throw
  }
}

// Wraps a server-function handler so any thrown error is caught, logged to
// error_log, and returned as { success: false, error }.
//
// Usage:
//   .handler(withErrorHandler("myFn", async ({ data }) => {
//     // business logic — can throw freely
//     return { success: true, ... };
//   }))
//
// The wrapper also accepts the session user (if available) to associate the
// error with the user who triggered it.
export function withErrorHandler<TArgs extends { data: any; context: any }, TResult>(
  source: string,
  fn: (args: TArgs) => Promise<TResult>,
): (args: TArgs) => Promise<TResult | ErrorResponse> {
  return async (args: TArgs) => {
    let user: SessionUser | null = null;
    try {
      // Best-effort: resolve the current user for error context.
      // We import lazily to avoid a circular dependency with session.ts.
      const { getSessionUser } = await import("./session");
      user = await getSessionUser();
    } catch {
      // no session — that's fine
    }

    try {
      return await fn(args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await logToErrorLog(err, source, user, { args: args.data });
      return { success: false, error: message } as ErrorResponse;
    }
  };
}

// Logs an error from anywhere in a server function without wrapping the entire
// handler.  Useful for ad-hoc error logging in functions that already have
// their own try/catch but want centralized logging.
export async function logServerError(
  err: unknown,
  source: string,
  user?: SessionUser | null,
  context?: Record<string, unknown>,
): Promise<void> {
  await logToErrorLog(err, source, user ?? null, context);
}
