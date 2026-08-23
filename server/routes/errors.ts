import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { supabaseServer } from "../lib/supabase-server.js";
import { requireSessionUser, getSessionUser } from "../lib/session.js";
import { checkRateLimit, getClientIpFromReq, API_RATE_LIMIT } from "../lib/rate-limiter.js";

export const errorsRouter = Router();

// POST /api/errors/log — logs a production error to the error_log table.
const logErrorSchema = z.object({
  message: z.string().max(2000).optional(),
  stack: z.string().max(10000).optional(),
  source: z.string().max(200).optional(),
  route: z.string().max(500).optional(),
  severity: z.enum(["error", "warning", "info"]).optional(),
  context: z.record(z.unknown()).optional(),
});

errorsRouter.post("/log", async (req: Request, res: Response) => {
  try {
    // Rate-limit unauthenticated error logging to prevent abuse
    const ip = getClientIpFromReq(req);
    const rateLimit = checkRateLimit(
      `error-log:${ip}`,
      10, // 10 per minute
      60 * 1000,
    );
    if (!rateLimit.allowed) {
      res.status(429).json({ success: false });
      return;
    }

    const data = logErrorSchema.parse(req.body);

    // Best-effort: get user ID if session exists (don't require it —
    // errors can happen before login completes)
    let userId: string | null = null;
    try {
      const user = await getSessionUser(req);
      if (user) userId = user.id;
    } catch {
      // no session — that's fine
    }

    await supabaseServer.from("error_log").insert({
      message: data.message ?? "Unknown error",
      stack: data.stack ?? null,
      source: data.source ?? "unknown",
      route: data.route ?? null,
      user_id: userId,
      severity: data.severity ?? "error",
      context: data.context ?? {},
    });

    res.json({ success: true });
  } catch (err) {
    // If error logging fails, there's nothing we can do — don't throw
    console.error("logError failed:", err);
    res.status(500).json({ success: false });
  }
});

// GET /api/errors/fetch — fetches recent errors (A1+ only).
errorsRouter.get("/fetch", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (user.role !== "A1+") {
      res.json({ data: [], total: 0 });
      return;
    }

    const limit = Math.min(parseInt(req.query["limit"] as string, 10) || 50, 100);
    const severity = req.query["severity"] as string | undefined;

    let query = supabaseServer
      .from("error_log")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .limit(limit);

    if (severity) query = query.eq("severity", severity);

    const { data: errors, count } = await query;

    res.json({ data: errors ?? [], total: count ?? 0 });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("fetchErrors error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch errors" });
  }
});
