import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { supabaseServer } from "../lib/supabase-server.js";
import { requireSessionUser } from "../lib/session.js";
import { logAction } from "../lib/audit.js";

export const aerbComplianceRouter = Router();

// GET /api/aerb-compliance/fetch — fetches AERB compliance records with optional result filter.
const fetchAerbSchema = z.object({
  page: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
  result: z.string().optional(),
  search: z.string().optional(),
});

aerbComplianceRouter.get("/fetch", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const data = fetchAerbSchema.parse(req.query);
    const page = data.page ?? 1;
    const limit = data.limit ?? 50;
    const offset = (page - 1) * limit;

    let query = supabaseServer
      .from("aerb_compliance")
      .select(
        "id, area, shielding_type, material, thickness, batch_id, inspection_date, result, dose_survey_value, dose_survey_unit, license_number, license_expiry, notes, photos, created_at",
        { count: "exact" },
      )
      .order("inspection_date", { ascending: false })
      .range(offset, offset + limit - 1);

    if (data.result) query = query.eq("result", data.result);
    if (data.search) {
      const s = data.search.replace(/[,.()\\]/g, " ").trim();
      if (s) {
        query = query.or(
          `area.ilike.%${s}%,shielding_type.ilike.%${s}%,material.ilike.%${s}%,license_number.ilike.%${s}%`,
        );
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
    console.error("fetchAerbCompliance error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch AERB compliance records" });
  }
});

// POST /api/aerb-compliance/create — creates a new AERB compliance record and logs the action.
const aerbSchema = z.object({
  area: z.string().min(1),
  shielding_type: z.string().optional(),
  material: z.string().optional(),
  thickness: z.string().optional(),
  batch_id: z.string().uuid().optional(),
  inspection_date: z.string().optional(),
  result: z.enum(["Pass", "Fail", "Re-test"]).default("Pass"),
  dose_survey_value: z.number().optional(),
  dose_survey_unit: z.string().optional(),
  license_number: z.string().optional(),
  license_expiry: z.string().optional(),
  notes: z.string().optional(),
  photos: z.array(z.string()).default([]),
});

aerbComplianceRouter.post("/create", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = aerbSchema.parse(req.body);

    const { data: record, error } = await supabaseServer
      .from("aerb_compliance")
      .insert(data)
      .select("id, area")
      .single();

    if (error || !record) {
      res.json({ success: false, error: "Failed to create AERB record" });
      return;
    }

    await logAction(user, "create_aerb", "aerb_compliance", record.id, { area: record.area });
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
    console.error("createAerbRecord error:", err);
    res.status(500).json({ success: false, error: "Failed to create AERB record" });
  }
});

// POST /api/aerb-compliance/update — updates an existing AERB compliance record and logs the change.
const updateAerbSchema = z.object({
  id: z.string().uuid(),
  ...aerbSchema.partial().shape,
});

aerbComplianceRouter.post("/update", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = updateAerbSchema.parse(req.body);
    const { id, ...updates } = data;

    const { error } = await supabaseServer.from("aerb_compliance").update(updates).eq("id", id);

    if (error) {
      res.json({ success: false, error: "Failed to update AERB record" });
      return;
    }

    await logAction(user, "update_aerb", "aerb_compliance", id, updates);
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
    console.error("updateAerbRecord error:", err);
    res.status(500).json({ success: false, error: "Failed to update AERB record" });
  }
});
