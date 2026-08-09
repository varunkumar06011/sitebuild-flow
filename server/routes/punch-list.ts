import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { supabaseServer } from "../lib/supabase-server.js";
import { requireSessionUser } from "../lib/session.js";
import { logAction } from "../lib/audit.js";
import { isSafePath } from "../lib/sanitize.js";

export const punchListRouter = Router();

// GET /api/punch-list/fetch
punchListRouter.get("/fetch", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const { page, limit, zone, status, severity, assignedVendorId } = req.query as Record<string, string>;
    const p = parseInt(page ?? "1", 10);
    const l = parseInt(limit ?? "50", 10);
    const offset = (p - 1) * l;

    let query = supabaseServer
      .from("punch_items")
      .select(
        "id, zone, room, description, photo_path, raised_by, assigned_vendor_id, status, severity, created_at, resolved_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(offset, offset + l - 1);

    if (zone && zone !== "all") query = query.eq("zone", zone);
    if (status && status !== "all") query = query.eq("status", status);
    if (severity && severity !== "all") query = query.eq("severity", severity);
    if (assignedVendorId) query = query.eq("assigned_vendor_id", assignedVendorId);

    const { data: items, count } = await query;
    res.json({ data: items ?? [], total: count ?? 0, page: p, limit: l });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ error: err.message });
      return;
    }
    console.error("fetchPunchItems error:", err);
    res.status(500).json({ error: "Failed to fetch punch items" });
  }
});

// POST /api/punch-list/create
const createPunchItemSchema = z.object({
  zone: z.string().min(1),
  room: z.string().optional(),
  description: z.string().min(1),
  photo_path: z.string().optional(),
  assigned_vendor_id: z.string().uuid().nullable().optional(),
  severity: z.enum(["Low", "Medium", "High", "Critical"]).default("Medium"),
});

punchListRouter.post("/create", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = createPunchItemSchema.parse(req.body);

    if (data.photo_path && !isSafePath(data.photo_path)) {
      res.json({ success: false, error: "Invalid photo path" });
      return;
    }

    const { data: item, error } = await supabaseServer
      .from("punch_items")
      .insert({
        zone: data.zone,
        room: data.room ?? null,
        description: data.description,
        photo_path: data.photo_path ?? null,
        raised_by: user.id,
        assigned_vendor_id: data.assigned_vendor_id ?? null,
        status: "Open",
        severity: data.severity,
      })
      .select("id, zone, description")
      .single();

    if (error || !item) {
      res.json({ success: false, error: "Failed to create punch item" });
      return;
    }

    await logAction(user, "create_punch_item", "punch_items", item.id, {
      zone: item.zone,
      description: item.description,
      severity: data.severity,
    });
    res.json({ success: true, id: item.id });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("createPunchItem error:", err);
    res.status(500).json({ success: false, error: "Failed to create punch item" });
  }
});

// POST /api/punch-list/update-status
const updatePunchItemStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["Open", "In Progress", "Resolved", "Verified"]),
});

punchListRouter.post("/update-status", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = updatePunchItemStatusSchema.parse(req.body);

    if (data.status === "Verified" && user.role === "Supervisor") {
      res.json({ success: false, error: "Only administrators can verify punch items" });
      return;
    }

    const updateData: Record<string, unknown> = { status: data.status };
    if (data.status === "Resolved" || data.status === "Verified") {
      updateData["resolved_at"] = new Date().toISOString();
    }

    const { error } = await supabaseServer.from("punch_items").update(updateData).eq("id", data.id);
    if (error) {
      res.json({ success: false, error: "Failed to update punch item status" });
      return;
    }

    await logAction(user, "update_punch_item_status", "punch_items", data.id, { status: data.status });
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
    console.error("updatePunchItemStatus error:", err);
    res.status(500).json({ success: false, error: "Failed to update status" });
  }
});

// GET /api/punch-list/zone-readiness
punchListRouter.get("/zone-readiness", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);

    const { data: items } = await supabaseServer.from("punch_items").select("zone, status");
    const zoneMap: Record<string, { total: number; resolved: number; verified: number }> = {};

    for (const item of items ?? []) {
      const zone = (item as any).zone ?? "Unknown";
      const status = (item as any).status as string;
      if (!zoneMap[zone]) zoneMap[zone] = { total: 0, resolved: 0, verified: 0 };
      zoneMap[zone].total++;
      if (status === "Resolved" || status === "Verified") zoneMap[zone].resolved++;
      if (status === "Verified") zoneMap[zone].verified++;
    }

    const zoneSummary = Object.entries(zoneMap).map(([zone, counts]) => ({
      zone,
      total_items: counts.total,
      resolved_items: counts.resolved,
      verified_items: counts.verified,
      readiness_pct: counts.total > 0 ? Math.round((counts.resolved / counts.total) * 100) : 100,
    }));

    const grandTotal = zoneSummary.reduce((s, z) => s + z.total_items, 0);
    const grandResolved = zoneSummary.reduce((s, z) => s + z.resolved_items, 0);

    res.json({
      zones: zoneSummary.sort((a, b) => a.readiness_pct - b.readiness_pct),
      overall: {
        total_items: grandTotal,
        resolved_items: grandResolved,
        overall_readiness_pct: grandTotal > 0 ? Math.round((grandResolved / grandTotal) * 100) : 100,
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ error: err.message });
      return;
    }
    console.error("getZoneReadinessSummary error:", err);
    res.status(500).json({ error: "Failed to fetch zone readiness" });
  }
});
