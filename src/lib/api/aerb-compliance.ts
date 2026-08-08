import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseServer } from "../supabase-server";
import { requireSessionUser } from "./session";
import { logAction } from "./audit";

// Fetches AERB compliance records with optional result filter.
export const fetchAerbCompliance = createServerFn({ method: "GET" })
  .validator((input: { page?: number; limit?: number; result?: string; search?: string }) => input)
  .handler(async ({ data }) => {
    await requireSessionUser();
    const page = data.page ?? 1;
    const limit = data.limit ?? 50;
    const offset = (page - 1) * limit;

    let query = supabaseServer
      .from("aerb_compliance")
      .select(
        "id, area, shielding_type, material, thickness, batch_id, inspection_date, result, dose_survey_value, dose_survey_unit, license_number, license_expiry, notes, photos, created_at",
        { count: "exact" },
      )
      .order("inspection_date", { ascending: false })
      .range(offset, offset + limit - 1);

    if (data.result) query = query.eq("result", data.result);
    if (data.search) {
      const s = data.search.replace(/[,.()\\]/g, " ").trim();
      if (s) {
        query = query.or(
          `area.ilike.%${s}%,shielding_type.ilike.%${s}%,material.ilike.%${s}%,license_number.ilike.%${s}%`,
        );
      }
    }

    const { data: records, count } = await query;
    return { data: records ?? [], total: count ?? 0, page, limit };
  });

const aerbSchema = z.object({
  area: z.string().min(1),
  shielding_type: z.string().optional(),
  material: z.string().optional(),
  thickness: z.string().optional(),
  batch_id: z.string().uuid().optional(),
  inspection_date: z.string().optional(),
  result: z.enum(["Pass", "Fail", "Re-test"]).default("Pass"),
  dose_survey_value: z.number().optional(),
  dose_survey_unit: z.string().optional(),
  license_number: z.string().optional(),
  license_expiry: z.string().optional(),
  notes: z.string().optional(),
  photos: z.array(z.string()).default([]),
});

// Creates a new AERB compliance record and logs the action.
export const createAerbRecord = createServerFn({ method: "POST" })
  .validator(aerbSchema)
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    const { data: record, error } = await supabaseServer
      .from("aerb_compliance")
      .insert(data)
      .select("id, area")
      .single();

    if (error || !record) {
      return { success: false, error: "Failed to create AERB record" };
    }

    await logAction(user, "create_aerb", "aerb_compliance", record.id, { area: record.area });
    return { success: true, id: record.id };
  });

// Updates an existing AERB compliance record and logs the change.
export const updateAerbRecord = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid(), ...aerbSchema.partial().shape }))
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    const { id, ...updates } = data;

    const { error } = await supabaseServer.from("aerb_compliance").update(updates).eq("id", id);

    if (error) return { success: false, error: "Failed to update AERB record" };

    await logAction(user, "update_aerb", "aerb_compliance", id, updates);
    return { success: true };
  });
