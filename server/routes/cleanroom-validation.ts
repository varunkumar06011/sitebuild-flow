import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { supabaseServer } from "../lib/supabase-server.js";
import { requireSessionUser } from "../lib/session.js";
import { logAction } from "../lib/audit.js";

export const cleanroomValidationRouter = Router();

// GET /api/cleanroom-validation/fetch — fetches cleanroom validation records with optional result/area filter.
const fetchCleanroomSchema = z.object({
  page: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
  result: z.string().optional(),
  area: z.string().optional(),
  search: z.string().optional(),
});

cleanroomValidationRouter.get("/fetch", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const data = fetchCleanroomSchema.parse(req.query);
    const page = data.page ?? 1;
    const limit = data.limit ?? 50;
    const offset = (page - 1) * limit;

    let query = supabaseServer
      .from("cleanroom_validation")
      .select(
        "id, area, test_type, iso_class, particle_count, ach_value, pressure_diff, filter_type, filter_install_date, filter_replacement_date, test_date, result, notes, photos, created_at",
        { count: "exact" },
      )
      .order("test_date", { ascending: false })
      .range(offset, offset + limit - 1);

    if (data.result) query = query.eq("result", data.result);
    if (data.area) query = query.eq("area", data.area);
    if (data.search) {
      const s = data.search.replace(/[,.()\\]/g, " ").trim();
      if (s) {
        query = query.or(`area.ilike.%${s}%,test_type.ilike.%${s}%,filter_type.ilike.%${s}%`);
      }
    }

    const { data: records, count } = await query;
    res.json({ data: records ?? [], total: count ?? 0, page, limit });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("fetchCleanroomRecords error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch cleanroom validation records" });
  }
});

// POST /api/cleanroom-validation/create — creates a new cleanroom validation record and logs the action.
const cleanroomSchema = z.object({
  area: z.string().min(1),
  test_type: z.string().min(1),
  iso_class: z.string().optional(),
  particle_count: z.number().optional(),
  ach_value: z.number().optional(),
  pressure_diff: z.number().optional(),
  filter_type: z.string().optional(),
  filter_install_date: z.string().optional(),
  filter_replacement_date: z.string().optional(),
  test_date: z.string().optional(),
  result: z.enum(["Pass", "Fail", "Re-test"]).default("Pass"),
  notes: z.string().optional(),
  photos: z.array(z.string()).default([]),
});

cleanroomValidationRouter.post("/create", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = cleanroomSchema.parse(req.body);

    const { data: record, error } = await supabaseServer
      .from("cleanroom_validation")
      .insert(data)
      .select("id, area, test_type")
      .single();

    if (error || !record) {
      res.json({ success: false, error: "Failed to create cleanroom record" });
      return;
    }

    await logAction(user, "create_cleanroom", "cleanroom_validation", record.id, {
      area: record.area,
      test_type: record.test_type,
    });
    res.json({ success: true, id: record.id });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("createCleanroomRecord error:", err);
    res.status(500).json({ success: false, error: "Failed to create cleanroom record" });
  }
});

// POST /api/cleanroom-validation/update — updates an existing cleanroom validation record and logs the change.
const updateCleanroomSchema = z.object({
  id: z.string().uuid(),
  ...cleanroomSchema.partial().shape,
});

cleanroomValidationRouter.post("/update", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = updateCleanroomSchema.parse(req.body);
    const { id, ...updates } = data;

    const { error } = await supabaseServer
      .from("cleanroom_validation")
      .update(updates)
      .eq("id", id);

    if (error) {
      res.json({ success: false, error: "Failed to update cleanroom record" });
      return;
    }

    await logAction(user, "update_cleanroom", "cleanroom_validation", id, updates);
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
    console.error("updateCleanroomRecord error:", err);
    res.status(500).json({ success: false, error: "Failed to update cleanroom record" });
  }
});
