import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { supabaseServer } from "../lib/supabase-server.js";
import { requireSessionUser } from "../lib/session.js";
import { logAction } from "../lib/audit.js";
import { sanitizeSearch } from "../lib/sanitize.js";

export const batchesRouter = Router();

// GET /api/batches/fetch — fetches a paginated list of material batches with optional status filter.
const fetchBatchesSchema = z.object({
  page: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
  status: z.string().optional(),
  search: z.string().optional(),
});

batchesRouter.get("/fetch", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const data = fetchBatchesSchema.parse(req.query);
    const page = data.page ?? 1;
    const limit = data.limit ?? 50;
    const offset = (page - 1) * limit;

    let query = supabaseServer
      .from("batches")
      .select(
        "id, batch_number, material, supplier, manufacturer, purchase_date, invoice, challan, mtc, lab_report, photos, status",
        { count: "exact" },
      )
      .order("purchase_date", { ascending: false })
      .range(offset, offset + limit - 1);

    if (data.status) query = query.eq("status", data.status);
    if (data.search) {
      const s = sanitizeSearch(data.search);
      if (s) {
        query = query.or(
          `batch_number.ilike.%${s}%,material.ilike.%${s}%,supplier.ilike.%${s}%,manufacturer.ilike.%${s}%`,
        );
      }
    }

    const { data: batches, count } = await query;

    res.json({ data: batches ?? [], total: count ?? 0, page, limit });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("fetchBatches error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch batches" });
  }
});

// POST /api/batches/create — creates a new material batch and logs the action to the audit trail.
const batchSchema = z.object({
  batch_number: z.string().min(1),
  material: z.string().min(1),
  supplier: z.string().optional(),
  manufacturer: z.string().optional(),
  purchase_date: z.string().optional(),
  invoice: z.string().optional(),
  challan: z.string().optional(),
  mtc: z.string().optional(),
  lab_report: z.string().optional(),
  status: z.enum(["Verified", "Pending MTC", "Under Test"]).default("Pending MTC"),
  photos: z.array(z.string()).default([]),
});

batchesRouter.post("/create", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = batchSchema.parse(req.body);

    const { data: batch, error } = await supabaseServer
      .from("batches")
      .insert({ ...data, photos: data.photos ?? [] })
      .select("id, batch_number")
      .single();

    if (error || !batch) {
      res.json({ success: false, error: "Failed to create batch" });
      return;
    }

    await logAction(user, "create_batch", "batch", batch.id, { batch_number: batch.batch_number });
    res.json({ success: true, id: batch.id });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("createBatch error:", err);
    res.status(500).json({ success: false, error: "Failed to create batch" });
  }
});

// POST /api/batches/update — updates an existing batch's fields and logs the change to the audit trail.
batchesRouter.post("/update", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = z.object({ id: z.string().uuid(), ...batchSchema.partial().shape }).parse(req.body);
    const { id, ...updates } = data;

    const { error } = await supabaseServer.from("batches").update(updates).eq("id", id);

    if (error) {
      res.json({ success: false, error: "Failed to update batch" });
      return;
    }

    await logAction(user, "update_batch", "batch", id, updates);
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
    console.error("updateBatch error:", err);
    res.status(500).json({ success: false, error: "Failed to update batch" });
  }
});
