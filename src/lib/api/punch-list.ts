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
// Fetch punch items with optional zone/status filters
// ---------------------------------------------------------------------------
export const fetchPunchItems = createServerFn({ method: "GET" })
  .validator(
    (input: {
      page?: number;
      limit?: number;
      zone?: string;
      status?: string;
      severity?: string;
      assignedVendorId?: string;
    }) => input,
  )
  .handler(async ({ data }) => {
    await requireSessionUser();
    const page = data.page ?? 1;
    const limit = data.limit ?? 50;
    const offset = (page - 1) * limit;

    let query = supabaseServer
      .from("punch_items")
      .select(
        "id, zone, room, description, photo_path, raised_by, assigned_vendor_id, status, severity, created_at, resolved_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (data.zone && data.zone !== "all") query = query.eq("zone", data.zone);
    if (data.status && data.status !== "all") query = query.eq("status", data.status);
    if (data.severity && data.severity !== "all") query = query.eq("severity", data.severity);
    if (data.assignedVendorId) query = query.eq("assigned_vendor_id", data.assignedVendorId);

    const { data: items, count } = await query;

    return { data: items ?? [], total: count ?? 0, page, limit };
  });

// ---------------------------------------------------------------------------
// Create a punch item — Supervisors and above
// ---------------------------------------------------------------------------
const createPunchItemSchema = z.object({
  zone: z.string().min(1),
  room: z.string().optional(),
  description: z.string().min(1),
  photo_path: z.string().optional(),
  assigned_vendor_id: z.string().uuid().nullable().optional(),
  severity: z.enum(["Low", "Medium", "High", "Critical"]).default("Medium"),
});

export const createPunchItem = createServerFn({ method: "POST" })
  .validator(createPunchItemSchema)
  .handler(async ({ data }) => {
    const user = await requireSessionUser();

    if (data.photo_path && !isSafePath(data.photo_path)) {
      return { success: false, error: "Invalid photo path" };
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
      return { success: false, error: "Failed to create punch item" };
    }

    await logAction(user, "create_punch_item", "punch_items", item.id, {
      zone: item.zone,
      description: item.description,
      severity: data.severity,
    });

    return { success: true, id: item.id };
  });

// ---------------------------------------------------------------------------
// Update punch item status — Supervisors can set In Progress/Resolved, admins can Verify
// ---------------------------------------------------------------------------
const updatePunchItemStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["Open", "In Progress", "Resolved", "Verified"]),
});

export const updatePunchItemStatus = createServerFn({ method: "POST" })
  .validator(updatePunchItemStatusSchema)
  .handler(async ({ data }) => {
    const user = await requireSessionUser();

    // Only admins can mark as Verified
    if (data.status === "Verified" && !isAdmin(user.role)) {
      return { success: false, error: "Only administrators can verify punch items" };
    }

    const updateData: Record<string, unknown> = { status: data.status };
    if (data.status === "Resolved" || data.status === "Verified") {
      updateData["resolved_at"] = new Date().toISOString();
    }

    const { error } = await supabaseServer.from("punch_items").update(updateData).eq("id", data.id);

    if (error) return { success: false, error: "Failed to update punch item status" };

    await logAction(user, "update_punch_item_status", "punch_items", data.id, {
      status: data.status,
    });

    return { success: true };
  });

// ---------------------------------------------------------------------------
// getZoneReadinessSummary — percent resolved per zone, for the handover dashboard
// ---------------------------------------------------------------------------
export const getZoneReadinessSummary = createServerFn({ method: "GET" })
  .validator((input: Record<string, never>) => input)
  .handler(async () => {
    await requireSessionUser();

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

    return {
      zones: zoneSummary.sort((a, b) => a.readiness_pct - b.readiness_pct),
      overall: {
        total_items: grandTotal,
        resolved_items: grandResolved,
        overall_readiness_pct:
          grandTotal > 0 ? Math.round((grandResolved / grandTotal) * 100) : 100,
      },
    };
  });
