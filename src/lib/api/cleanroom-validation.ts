import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseServer } from "../supabase-server";
import { requireSessionUser } from "./session";
import { logAction } from "./audit";

// Fetches cleanroom validation records with optional result/area filter.
export const fetchCleanroomRecords = createServerFn({ method: "GET" })
  .validator(
    (input: { page?: number; limit?: number; result?: string; area?: string; search?: string }) =>
      input,
  )
  .handler(async ({ data }) => {
    await requireSessionUser();
    const page = data.page ?? 1;
    const limit = data.limit ?? 50;
    const offset = (page - 1) * limit;

    let query = supabaseServer
      .from("cleanroom_validation")
      .select(
        "id, area, test_type, iso_class, particle_count, ach_value, pressure_diff, filter_type, filter_install_date, filter_replacement_date, test_date, result, notes, photos, created_at",
        { count: "exact" },
      )
      .order("test_date", { ascending: false })
      .range(offset, offset + limit - 1);

    if (data.result) query = query.eq("result", data.result);
    if (data.area) query = query.eq("area", data.area);
    if (data.search) {
      const s = data.search.replace(/[,.()\\]/g, " ").trim();
      if (s) {
        query = query.or(`area.ilike.%${s}%,test_type.ilike.%${s}%,filter_type.ilike.%${s}%`);
      }
    }

    const { data: records, count } = await query;
    return { data: records ?? [], total: count ?? 0, page, limit };
  });

const cleanroomSchema = z.object({
  area: z.string().min(1),
  test_type: z.string().min(1),
  iso_class: z.string().optional(),
  particle_count: z.number().optional(),
  ach_value: z.number().optional(),
  pressure_diff: z.number().optional(),
  filter_type: z.string().optional(),
  filter_install_date: z.string().optional(),
  filter_replacement_date: z.string().optional(),
  test_date: z.string().optional(),
  result: z.enum(["Pass", "Fail", "Re-test"]).default("Pass"),
  notes: z.string().optional(),
  photos: z.array(z.string()).default([]),
});

// Creates a new cleanroom validation record and logs the action.
export const createCleanroomRecord = createServerFn({ method: "POST" })
  .validator(cleanroomSchema)
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    const { data: record, error } = await supabaseServer
      .from("cleanroom_validation")
      .insert(data)
      .select("id, area, test_type")
      .single();

    if (error || !record) {
      return { success: false, error: "Failed to create cleanroom record" };
    }

    await logAction(user, "create_cleanroom", "cleanroom_validation", record.id, {
      area: record.area,
      test_type: record.test_type,
    });
    return { success: true, id: record.id };
  });

// Updates an existing cleanroom validation record and logs the change.
export const updateCleanroomRecord = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid(), ...cleanroomSchema.partial().shape }))
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    const { id, ...updates } = data;

    const { error } = await supabaseServer
      .from("cleanroom_validation")
      .update(updates)
      .eq("id", id);

    if (error) return { success: false, error: "Failed to update cleanroom record" };

    await logAction(user, "update_cleanroom", "cleanroom_validation", id, updates);
    return { success: true };
  });
