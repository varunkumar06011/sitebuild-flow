import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseServer } from "../supabase-server";
import { requireSessionUser } from "./session";
import { logAction } from "./audit";

export const fetchInspections = createServerFn({ method: "GET" })
  .validator((input: { page?: number; limit?: number; result?: string }) => input)
  .handler(async ({ data, context }) => {
    await requireSessionUser();
    const page = data.page ?? 1;
    const limit = data.limit ?? 50;
    const offset = (page - 1) * limit;

    let query = supabaseServer
      .from("inspections")
      .select("id, qc_number, activity, location, inspector, date, result, checklist, rectification, photos", { count: "exact" })
      .order("date", { ascending: false })
      .range(offset, offset + limit - 1);

    if (data.result) query = query.eq("result", data.result);

    const { data: inspections, count } = await query;

    return { data: inspections ?? [], total: count ?? 0, page, limit };
  });

const inspectionSchema = z.object({
  qc_number: z.string().min(1),
  activity: z.string().min(1),
  location: z.string().optional(),
  inspector: z.string().optional(),
  date: z.string().optional(),
  result: z.enum(["Pass", "Fail", "Re-inspection"]).default("Pass"),
  checklist: z.array(z.object({ item: z.string(), ok: z.boolean() })).default([]),
  rectification: z.string().nullable().optional(),
});

export const createInspection = createServerFn({ method: "POST" })
  .validator(inspectionSchema)
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();

    const { data: inspection, error } = await supabaseServer
      .from("inspections")
      .insert({ ...data, photos: [] })
      .select("id, qc_number")
      .single();

    if (error || !inspection) {
      return { success: false, error: "Failed to create inspection" };
    }

    await logAction(user, "create_inspection", "inspection", inspection.id, { qc_number: inspection.qc_number });
    return { success: true, id: inspection.id };
  });
