import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { supabaseServer } from "../lib/supabase-server.js";
import { requireSessionUser } from "../lib/session.js";
import { logAction } from "../lib/audit.js";
import { dispatchNotification } from "../lib/notification-system.js";

export const inspectionsRouter = Router();

// GET /api/inspections/fetch — fetches a paginated list of QC inspections with optional result filter.
const fetchInspectionsSchema = z.object({
  page: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
  result: z.string().optional(),
});

inspectionsRouter.get("/fetch", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const data = fetchInspectionsSchema.parse(req.query);
    const page = data.page ?? 1;
    const limit = data.limit ?? 50;
    const offset = (page - 1) * limit;

    let query = supabaseServer
      .from("inspections")
      .select(
        "id, qc_number, activity, location, inspector, date, result, checklist, rectification, photos",
        { count: "exact" },
      )
      .order("date", { ascending: false })
      .range(offset, offset + limit - 1);

    if (data.result) query = query.eq("result", data.result);

    const { data: inspections, count } = await query;

    res.json({ data: inspections ?? [], total: count ?? 0, page, limit });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("fetchInspections error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch inspections" });
  }
});

// POST /api/inspections/create — creates a new QC inspection record and logs the action to the audit trail.
const inspectionSchema = z.object({
  qc_number: z.string().min(1),
  activity: z.string().min(1),
  location: z.string().optional(),
  inspector: z.string().optional(),
  date: z.string().optional(),
  result: z.enum(["Pass", "Fail", "Re-inspection"]).default("Pass"),
  checklist: z.array(z.object({ item: z.string(), ok: z.boolean() })).default([]),
  rectification: z.string().nullable().optional(),
  photos: z.array(z.string()).default([]),
});

inspectionsRouter.post("/create", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = inspectionSchema.parse(req.body);

    const { data: inspection, error } = await supabaseServer
      .from("inspections")
      .insert({ ...data, photos: data.photos ?? [] })
      .select("id, qc_number")
      .single();

    if (error || !inspection) {
      res.json({ success: false, error: "Failed to create inspection" });
      return;
    }

    await logAction(user, "create_inspection", "inspection", inspection.id, {
      qc_number: inspection.qc_number,
    });

    // Notify admins if the inspection failed
    if (data.result === "Fail") {
      await dispatchNotification({
        event: "qc_failed",
        title: "QC inspection failed",
        body: `Inspection ${inspection.qc_number} for ${data.activity} has failed.`,
        entityType: "inspection",
        entityId: inspection.id,
        targetRoles: ["Administrator", "A1", "A1+"],
      });
    }

    res.json({ success: true, id: inspection.id });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("createInspection error:", err);
    res.status(500).json({ success: false, error: "Failed to create inspection" });
  }
});

// POST /api/inspections/update — updates an existing inspection's fields and logs the change.
inspectionsRouter.post("/update", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = z
      .object({ id: z.string().uuid(), ...inspectionSchema.partial().shape })
      .parse(req.body);
    const { id, ...updates } = data;

    const { error } = await supabaseServer.from("inspections").update(updates).eq("id", id);

    if (error) {
      res.json({ success: false, error: "Failed to update inspection" });
      return;
    }

    await logAction(user, "update_inspection", "inspection", id, updates);

    // Notify admins if the updated inspection result is Fail
    if (updates.result === "Fail") {
      await dispatchNotification({
        event: "qc_failed",
        title: "QC inspection failed",
        body: `Inspection ${id} has been updated with a Fail result.`,
        entityType: "inspection",
        entityId: id,
        targetRoles: ["Administrator", "A1", "A1+"],
      });
    }

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
    console.error("updateInspection error:", err);
    res.status(500).json({ success: false, error: "Failed to update inspection" });
  }
});
