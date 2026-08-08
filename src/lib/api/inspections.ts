import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseServer } from "../supabase-server";
import { requireSessionUser } from "./session";
import { logAction } from "./audit";
import { dispatchNotification } from "./notification-system";

// Fetches a paginated list of QC inspections with optional result filter.
export const fetchInspections = createServerFn({ method: "GET" })
  .validator((input: { page?: number; limit?: number; result?: string }) => input)
  .handler(async ({ data, context }) => {
    await requireSessionUser();
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

    return { data: inspections ?? [], total: count ?? 0, page, limit };
  });

// Zod schema validating inspection creation fields (QC number, activity, checklist, result, photos).
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

// Creates a new QC inspection record and logs the action to the audit trail.
export const createInspection = createServerFn({ method: "POST" })
  .validator(inspectionSchema)
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();

    const { data: inspection, error } = await supabaseServer
      .from("inspections")
      .insert({ ...data, photos: data.photos ?? [] })
      .select("id, qc_number")
      .single();

    if (error || !inspection) {
      return { success: false, error: "Failed to create inspection" };
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

    return { success: true, id: inspection.id };
  });

// Updates an existing inspection's fields (e.g. re-inspection result, rectification, photos) and logs the change.
export const updateInspection = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid(), ...inspectionSchema.partial().shape }))
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();
    const { id, ...updates } = data;

    const { error } = await supabaseServer.from("inspections").update(updates).eq("id", id);

    if (error) return { success: false, error: "Failed to update inspection" };

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

    return { success: true };
  });
