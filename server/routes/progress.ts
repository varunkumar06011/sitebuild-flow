import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { supabaseServer } from "../lib/supabase-server.js";
import { requireSessionUser } from "../lib/session.js";
import { logAction } from "../lib/audit.js";

export const progressRouter = Router();

// GET /api/progress/fetch — fetches all block-level progress percentages ordered by block name.
progressRouter.get("/fetch", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);

    const { data, error } = await supabaseServer
      .from("progress")
      .select("id, block, pct, updated_at")
      .order("block", { ascending: true });

    if (error) {
      res.json({ data: [] });
      return;
    }

    res.json({ data: data ?? [] });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("fetchProgress error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch progress" });
  }
});

// POST /api/progress/update — creates or updates a block's progress percentage (admin and above only).
const updateProgressSchema = z.object({
  block: z.string(),
  pct: z.number(),
});

progressRouter.post("/update", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (user.role === "Supervisor") {
      res.json({ success: false, error: "Only administrators and above can update progress" });
      return;
    }

    const data = updateProgressSchema.parse(req.body);

    const { data: existing } = await supabaseServer
      .from("progress")
      .select("id")
      .eq("block", data.block)
      .limit(1)
      .single();

    const now = new Date().toISOString();

    if (existing) {
      const { error } = await supabaseServer
        .from("progress")
        .update({ pct: data.pct, updated_at: now })
        .eq("id", existing.id);

      if (error) {
        res.json({ success: false, error: "Failed to update progress" });
        return;
      }
      await logAction(user, "update_progress", "progress", existing.id, {
        block: data.block,
        pct: data.pct,
      });
      res.json({ success: true });
      return;
    }

    const { data: created, error } = await supabaseServer
      .from("progress")
      .insert({ block: data.block, pct: data.pct, updated_at: now })
      .select("id")
      .single();

    if (error || !created) {
      res.json({ success: false, error: "Failed to create progress" });
      return;
    }
    await logAction(user, "create_progress", "progress", created.id, {
      block: data.block,
      pct: data.pct,
    });
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
    console.error("updateProgress error:", err);
    res.status(500).json({ success: false, error: "Failed to update progress" });
  }
});
