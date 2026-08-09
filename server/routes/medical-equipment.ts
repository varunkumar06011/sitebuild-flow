import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { supabaseServer } from "../lib/supabase-server.js";
import { requireSessionUser } from "../lib/session.js";
import { logAction } from "../lib/audit.js";

export const medicalEquipmentRouter = Router();

// GET /api/medical-equipment/fetch — fetches a paginated list of medical equipment with optional status/category filter.
const fetchEquipmentSchema = z.object({
  page: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
  status: z.string().optional(),
  category: z.string().optional(),
  search: z.string().optional(),
});

medicalEquipmentRouter.get("/fetch", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const data = fetchEquipmentSchema.parse(req.query);
    const page = data.page ?? 1;
    const limit = data.limit ?? 50;
    const offset = (page - 1) * limit;

    let query = supabaseServer
      .from("medical_equipment")
      .select(
        "id, eq_number, name, model, serial_number, manufacturer, category, location, vendor_id, requisition_id, status, warranty_start, warranty_end, amc_expiry, handover_date, handover_department, commissioning_checklist, certificates, photos, notes, created_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (data.status) query = query.eq("status", data.status);
    if (data.category) query = query.eq("category", data.category);
    if (data.search) {
      const s = data.search.replace(/[,.()\\]/g, " ").trim();
      if (s) {
        query = query.or(
          `eq_number.ilike.%${s}%,name.ilike.%${s}%,model.ilike.%${s}%,serial_number.ilike.%${s}%,manufacturer.ilike.%${s}%`,
        );
      }
    }

    const { data: equipment, count } = await query;
    res.json({ data: equipment ?? [], total: count ?? 0, page, limit });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("fetchEquipment error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch equipment" });
  }
});

// POST /api/medical-equipment/create — creates a new medical equipment record and logs the action.
const equipmentSchema = z.object({
  eq_number: z.string().min(1),
  name: z.string().min(1),
  model: z.string().optional(),
  serial_number: z.string().optional(),
  manufacturer: z.string().optional(),
  category: z.string().optional(),
  location: z.string().optional(),
  vendor_id: z.string().uuid().optional(),
  requisition_id: z.string().uuid().optional(),
  status: z
    .enum(["Ordered", "Delivered", "Installed", "Testing", "Commissioned", "Handed Over"])
    .default("Ordered"),
  warranty_start: z.string().optional(),
  warranty_end: z.string().optional(),
  amc_expiry: z.string().optional(),
  handover_date: z.string().optional(),
  handover_department: z.string().optional(),
  commissioning_checklist: z.array(z.object({ item: z.string(), ok: z.boolean() })).default([]),
  certificates: z
    .array(
      z.object({
        type: z.string(),
        number: z.string().optional(),
        issued_date: z.string().optional(),
        expiry_date: z.string().optional(),
      }),
    )
    .default([]),
  photos: z.array(z.string()).default([]),
  notes: z.string().optional(),
});

medicalEquipmentRouter.post("/create", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = equipmentSchema.parse(req.body);

    const { data: equipment, error } = await supabaseServer
      .from("medical_equipment")
      .insert(data)
      .select("id, eq_number")
      .single();

    if (error || !equipment) {
      res.json({ success: false, error: "Failed to create equipment" });
      return;
    }

    await logAction(user, "create_equipment", "medical_equipment", equipment.id, {
      eq_number: equipment.eq_number,
    });
    res.json({ success: true, id: equipment.id });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("createEquipment error:", err);
    res.status(500).json({ success: false, error: "Failed to create equipment" });
  }
});

// POST /api/medical-equipment/update — updates an existing equipment record and logs the change.
const updateEquipmentSchema = z.object({
  id: z.string().uuid(),
  ...equipmentSchema.partial().shape,
});

medicalEquipmentRouter.post("/update", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = updateEquipmentSchema.parse(req.body);
    const { id, ...updates } = data;

    const { error } = await supabaseServer.from("medical_equipment").update(updates).eq("id", id);

    if (error) {
      res.json({ success: false, error: "Failed to update equipment" });
      return;
    }

    await logAction(user, "update_equipment", "medical_equipment", id, updates);
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
    console.error("updateEquipment error:", err);
    res.status(500).json({ success: false, error: "Failed to update equipment" });
  }
});
