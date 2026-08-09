import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { supabaseServer } from "../lib/supabase-server.js";
import { requireSessionUser } from "../lib/session.js";
import { logAction } from "../lib/audit.js";

export const medicalGasRouter = Router();

// GET /api/medical-gas/fetch — fetches medical gas pipeline records with optional gas_type filter.
const fetchGasPipelinesSchema = z.object({
  page: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
  gas_type: z.string().optional(),
  search: z.string().optional(),
});

medicalGasRouter.get("/fetch", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const data = fetchGasPipelinesSchema.parse(req.query);
    const page = data.page ?? 1;
    const limit = data.limit ?? 50;
    const offset = (page - 1) * limit;

    let query = supabaseServer
      .from("medical_gas_pipeline")
      .select(
        "id, gas_type, pipeline_segment, pressure_test_date, pressure_test_result, leak_test_date, leak_test_result, manifold_installed, cross_connection_verified, batch_id, notes, photos, created_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (data.gas_type) query = query.eq("gas_type", data.gas_type);
    if (data.search) {
      const s = data.search.replace(/[,.()\\]/g, " ").trim();
      if (s) {
        query = query.or(`gas_type.ilike.%${s}%,pipeline_segment.ilike.%${s}%`);
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
    console.error("fetchGasPipelines error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch gas pipelines" });
  }
});

// POST /api/medical-gas/create — creates a new medical gas pipeline record and logs the action.
const gasSchema = z.object({
  gas_type: z.string().min(1),
  pipeline_segment: z.string().min(1),
  pressure_test_date: z.string().optional(),
  pressure_test_result: z.enum(["Pass", "Fail", "Pending"]).default("Pending"),
  leak_test_date: z.string().optional(),
  leak_test_result: z.enum(["Pass", "Fail", "Pending"]).default("Pending"),
  manifold_installed: z.boolean().default(false),
  cross_connection_verified: z.boolean().default(false),
  batch_id: z.string().uuid().optional(),
  notes: z.string().optional(),
  photos: z.array(z.string()).default([]),
});

medicalGasRouter.post("/create", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = gasSchema.parse(req.body);

    const { data: record, error } = await supabaseServer
      .from("medical_gas_pipeline")
      .insert(data)
      .select("id, gas_type, pipeline_segment")
      .single();

    if (error || !record) {
      res.json({ success: false, error: "Failed to create gas pipeline record" });
      return;
    }

    await logAction(user, "create_gas_pipeline", "medical_gas_pipeline", record.id, {
      gas_type: record.gas_type,
      pipeline_segment: record.pipeline_segment,
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
    console.error("createGasPipeline error:", err);
    res.status(500).json({ success: false, error: "Failed to create gas pipeline record" });
  }
});

// POST /api/medical-gas/update — updates an existing medical gas pipeline record and logs the change.
const updateGasPipelineSchema = z.object({
  id: z.string().uuid(),
  ...gasSchema.partial().shape,
});

medicalGasRouter.post("/update", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = updateGasPipelineSchema.parse(req.body);
    const { id, ...updates } = data;

    const { error } = await supabaseServer
      .from("medical_gas_pipeline")
      .update(updates)
      .eq("id", id);

    if (error) {
      res.json({ success: false, error: "Failed to update gas pipeline record" });
      return;
    }

    await logAction(user, "update_gas_pipeline", "medical_gas_pipeline", id, updates);
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
    console.error("updateGasPipeline error:", err);
    res.status(500).json({ success: false, error: "Failed to update gas pipeline record" });
  }
});
