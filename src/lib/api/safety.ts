import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseServer } from "../supabase-server";
import { requireSessionUser } from "./session";
import { logAction } from "./audit";
import { isSafePath } from "./sanitize";
import type { Role } from "../erp-data";

const ADMIN_ROLES: Role[] = ["Administrator", "A1", "A1+"];
function isAdmin(role: Role): boolean {
  return ADMIN_ROLES.includes(role);
}

// ---------------------------------------------------------------------------
// Fetch safety incidents with optional filters
// ---------------------------------------------------------------------------
export const fetchIncidents = createServerFn({ method: "GET" })
  .validator(
    (input: {
      page?: number;
      limit?: number;
      type?: string;
      zone?: string;
      severity?: string;
      status?: string;
      contractorName?: string;
    }) => input,
  )
  .handler(async ({ data }) => {
    await requireSessionUser();
    const page = data.page ?? 1;
    const limit = data.limit ?? 50;
    const offset = (page - 1) * limit;

    let query = supabaseServer
      .from("safety_incidents")
      .select(
        "id, type, zone, contractor_name, description, photo_path, severity, reported_by, reported_by_name, status, created_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (data.type && data.type !== "all") query = query.eq("type", data.type);
    if (data.zone && data.zone !== "all") query = query.eq("zone", data.zone);
    if (data.severity && data.severity !== "all") query = query.eq("severity", data.severity);
    if (data.status && data.status !== "all") query = query.eq("status", data.status);
    if (data.contractorName) {
      query = query.ilike("contractor_name", `%${data.contractorName}%`);
    }

    const { data: incidents, count } = await query;

    return { data: incidents ?? [], total: count ?? 0, page, limit };
  });

// ---------------------------------------------------------------------------
// Report a safety incident — Supervisors and above
// ---------------------------------------------------------------------------
const reportIncidentSchema = z.object({
  type: z.enum(["Incident", "Near-miss"]).default("Incident"),
  zone: z.string().optional(),
  contractor_name: z.string().optional(),
  description: z.string().min(1),
  photo_path: z.string().optional(),
  severity: z.enum(["Low", "Medium", "High", "Critical"]).default("Medium"),
});

export const reportIncident = createServerFn({ method: "POST" })
  .validator(reportIncidentSchema)
  .handler(async ({ data }) => {
    const user = await requireSessionUser();

    if (data.photo_path && !isSafePath(data.photo_path)) {
      return { success: false, error: "Invalid photo path" };
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
      return { success: false, error: "Failed to report incident" };
    }

    await logAction(user, "report_safety_incident", "safety_incidents", incident.id, {
      type: data.type,
      severity: data.severity,
      zone: data.zone,
    });

    return { success: true, id: incident.id };
  });

// ---------------------------------------------------------------------------
// Update incident status — admins can close/resolve
// ---------------------------------------------------------------------------
const updateIncidentStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.string().min(1),
});

export const updateIncidentStatus = createServerFn({ method: "POST" })
  .validator(updateIncidentStatusSchema)
  .handler(async ({ data }) => {
    const user = await requireSessionUser();

    const { error } = await supabaseServer
      .from("safety_incidents")
      .update({ status: data.status })
      .eq("id", data.id);

    if (error) return { success: false, error: "Failed to update incident status" };

    await logAction(user, "update_safety_incident_status", "safety_incidents", data.id, {
      status: data.status,
    });

    return { success: true };
  });

// ---------------------------------------------------------------------------
// getSafetyDashboardStats — trend by contractor/zone/month, admin only
// ---------------------------------------------------------------------------
export const getSafetyDashboardStats = createServerFn({ method: "GET" })
  .validator((input: { fromDate?: string; toDate?: string }) => input)
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    if (!isAdmin(user.role)) {
      return { success: false, error: "Only administrators can view safety dashboard" };
    }

    let query = supabaseServer
      .from("safety_incidents")
      .select("id, type, zone, contractor_name, severity, status, created_at");

    if (data.fromDate) query = query.gte("created_at", data.fromDate);
    if (data.toDate) query = query.lte("created_at", data.toDate);

    const { data: incidents } = await query;
    const rows = (incidents ?? []) as any[];

    // Trend by month
    const byMonth: Record<string, { incidents: number; near_miss: number; total: number }> = {};
    const byZone: Record<string, { incidents: number; near_miss: number; total: number }> = {};
    const byContractor: Record<string, { incidents: number; near_miss: number; total: number }> =
      {};
    const bySeverity: Record<string, number> = {};

    for (const row of rows) {
      const monthKey = (row.created_at ?? "").slice(0, 7); // YYYY-MM
      const zone = row.zone ?? "Unspecified";
      const contractor = row.contractor_name ?? "Unspecified";
      const severity = row.severity ?? "Medium";
      const isNearMiss = row.type === "Near-miss";

      if (!byMonth[monthKey]) byMonth[monthKey] = { incidents: 0, near_miss: 0, total: 0 };
      if (!byZone[zone]) byZone[zone] = { incidents: 0, near_miss: 0, total: 0 };
      if (!byContractor[contractor])
        byContractor[contractor] = { incidents: 0, near_miss: 0, total: 0 };

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

    return {
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
    };
  });
