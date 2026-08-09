import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { supabaseServer } from "../lib/supabase-server.js";
import { requireSessionUser } from "../lib/session.js";
import { logAction } from "../lib/audit.js";
import { isSafePath } from "../lib/sanitize.js";

export const safetyRouter = Router();

// GET /api/safety/incidents
safetyRouter.get("/incidents", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const { page, limit, type, zone, severity, status, contractorName } = req.query as Record<string, string>;
    const p = parseInt(page ?? "1", 10);
    const l = parseInt(limit ?? "50", 10);
    const offset = (p - 1) * l;

    let query = supabaseServer
      .from("safety_incidents")
      .select(
        "id, type, zone, contractor_name, description, photo_path, severity, reported_by, reported_by_name, status, created_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(offset, offset + l - 1);

    if (type && type !== "all") query = query.eq("type", type);
    if (zone && zone !== "all") query = query.eq("zone", zone);
    if (severity && severity !== "all") query = query.eq("severity", severity);
    if (status && status !== "all") query = query.eq("status", status);
    if (contractorName) query = query.ilike("contractor_name", `%${contractorName}%`);

    const { data: incidents, count } = await query;
    res.json({ data: incidents ?? [], total: count ?? 0, page: p, limit: l });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ error: err.message });
      return;
    }
    console.error("fetchIncidents error:", err);
    res.status(500).json({ error: "Failed to fetch incidents" });
  }
});

// POST /api/safety/report
const reportIncidentSchema = z.object({
  type: z.enum(["Incident", "Near-miss"]).default("Incident"),
  zone: z.string().optional(),
  contractor_name: z.string().optional(),
  description: z.string().min(1),
  photo_path: z.string().optional(),
  severity: z.enum(["Low", "Medium", "High", "Critical"]).default("Medium"),
});

safetyRouter.post("/report", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = reportIncidentSchema.parse(req.body);

    if (data.photo_path && !isSafePath(data.photo_path)) {
      res.json({ success: false, error: "Invalid photo path" });
      return;
    }

    const { data: incident, error } = await supabaseServer
      .from("safety_incidents")
      .insert({
        type: data.type,
        zone: data.zone ?? null,
        contractor_name: data.contractor_name ?? null,
        description: data.description,
        photo_path: data.photo_path ?? null,
        severity: data.severity,
        reported_by: user.id,
        reported_by_name: user.name,
        status: "Open",
      })
      .select("id, type, severity")
      .single();

    if (error || !incident) {
      res.json({ success: false, error: "Failed to report incident" });
      return;
    }

    await logAction(user, "report_safety_incident", "safety_incidents", incident.id, {
      type: data.type,
      severity: data.severity,
      zone: data.zone,
    });
    res.json({ success: true, id: incident.id });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("reportIncident error:", err);
    res.status(500).json({ success: false, error: "Failed to report incident" });
  }
});

// POST /api/safety/update-status
const updateIncidentStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.string().min(1),
});

safetyRouter.post("/update-status", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = updateIncidentStatusSchema.parse(req.body);

    const { error } = await supabaseServer
      .from("safety_incidents")
      .update({ status: data.status })
      .eq("id", data.id);

    if (error) {
      res.json({ success: false, error: "Failed to update incident status" });
      return;
    }

    await logAction(user, "update_safety_incident_status", "safety_incidents", data.id, {
      status: data.status,
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
    console.error("updateIncidentStatus error:", err);
    res.status(500).json({ success: false, error: "Failed to update status" });
  }
});

// GET /api/safety/dashboard-stats
safetyRouter.get("/dashboard-stats", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (user.role === "Supervisor") {
      res.json({ success: false, error: "Only administrators can view safety dashboard" });
      return;
    }

    const { fromDate, toDate } = req.query as Record<string, string>;
    let query = supabaseServer
      .from("safety_incidents")
      .select("id, type, zone, contractor_name, severity, status, created_at");

    if (fromDate) query = query.gte("created_at", fromDate);
    if (toDate) query = query.lte("created_at", toDate);

    const { data: incidents } = await query;
    const rows = (incidents ?? []) as any[];

    const byMonth: Record<string, { incidents: number; near_miss: number; total: number }> = {};
    const byZone: Record<string, { incidents: number; near_miss: number; total: number }> = {};
    const byContractor: Record<string, { incidents: number; near_miss: number; total: number }> = {};
    const bySeverity: Record<string, number> = {};

    for (const row of rows) {
      const monthKey = (row.created_at ?? "").slice(0, 7);
      const zone = row.zone ?? "Unspecified";
      const contractor = row.contractor_name ?? "Unspecified";
      const severity = row.severity ?? "Medium";
      const isNearMiss = row.type === "Near-miss";

      if (!byMonth[monthKey]) byMonth[monthKey] = { incidents: 0, near_miss: 0, total: 0 };
      if (!byZone[zone]) byZone[zone] = { incidents: 0, near_miss: 0, total: 0 };
      if (!byContractor[contractor]) byContractor[contractor] = { incidents: 0, near_miss: 0, total: 0 };

      byMonth[monthKey].total++;
      byZone[zone].total++;
      byContractor[contractor].total++;
      bySeverity[severity] = (bySeverity[severity] ?? 0) + 1;

      if (isNearMiss) {
        byMonth[monthKey].near_miss++;
        byZone[zone].near_miss++;
        byContractor[contractor].near_miss++;
      } else {
        byMonth[monthKey].incidents++;
        byZone[zone].incidents++;
        byContractor[contractor].incidents++;
      }
    }

    const openCount = rows.filter((r) => r.status === "Open").length;
    const closedCount = rows.filter((r) => r.status === "Closed" || r.status === "Resolved").length;

    res.json({
      summary: {
        total_reports: rows.length,
        total_incidents: rows.filter((r) => r.type === "Incident").length,
        total_near_miss: rows.filter((r) => r.type === "Near-miss").length,
        open_count: openCount,
        closed_count: closedCount,
        critical_count: rows.filter((r) => r.severity === "Critical").length,
      },
      by_month: Object.entries(byMonth)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, counts]) => ({ month, ...counts })),
      by_zone: Object.entries(byZone).map(([zone, counts]) => ({ zone, ...counts })),
      by_contractor: Object.entries(byContractor).map(([contractor, counts]) => ({
        contractor,
        ...counts,
      })),
      by_severity: bySeverity,
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ error: err.message });
      return;
    }
    console.error("getSafetyDashboardStats error:", err);
    res.status(500).json({ error: "Failed to fetch dashboard stats" });
  }
});
