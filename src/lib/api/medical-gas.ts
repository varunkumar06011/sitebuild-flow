import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseServer } from "../supabase-server";
import { requireSessionUser } from "./session";
import { logAction } from "./audit";

// Fetches medical gas pipeline records with optional gas_type filter.
export const fetchGasPipelines = createServerFn({ method: "GET" })
  .validator(
    (input: { page?: number; limit?: number; gas_type?: string; search?: string }) => input,
  )
  .handler(async ({ data }) => {
    await requireSessionUser();
    const page = data.page ?? 1;
    const limit = data.limit ?? 50;
    const offset = (page - 1) * limit;

    let query = supabaseServer
      .from("medical_gas_pipeline")
      .select(
        "id, gas_type, pipeline_segment, pressure_test_date, pressure_test_result, leak_test_date, leak_test_result, manifold_installed, cross_connection_verified, batch_id, notes, photos, created_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (data.gas_type) query = query.eq("gas_type", data.gas_type);
    if (data.search) {
      const s = data.search.replace(/[,.()\\]/g, " ").trim();
      if (s) {
        query = query.or(`gas_type.ilike.%${s}%,pipeline_segment.ilike.%${s}%`);
      }
    }

    const { data: records, count } = await query;
    return { data: records ?? [], total: count ?? 0, page, limit };
  });

const gasSchema = z.object({
  gas_type: z.string().min(1),
  pipeline_segment: z.string().min(1),
  pressure_test_date: z.string().optional(),
  pressure_test_result: z.enum(["Pass", "Fail", "Pending"]).default("Pending"),
  leak_test_date: z.string().optional(),
  leak_test_result: z.enum(["Pass", "Fail", "Pending"]).default("Pending"),
  manifold_installed: z.boolean().default(false),
  cross_connection_verified: z.boolean().default(false),
  batch_id: z.string().uuid().optional(),
  notes: z.string().optional(),
  photos: z.array(z.string()).default([]),
});

// Creates a new medical gas pipeline record and logs the action.
export const createGasPipeline = createServerFn({ method: "POST" })
  .validator(gasSchema)
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    const { data: record, error } = await supabaseServer
      .from("medical_gas_pipeline")
      .insert(data)
      .select("id, gas_type, pipeline_segment")
      .single();

    if (error || !record) {
      return { success: false, error: "Failed to create gas pipeline record" };
    }

    await logAction(user, "create_gas_pipeline", "medical_gas_pipeline", record.id, {
      gas_type: record.gas_type,
      pipeline_segment: record.pipeline_segment,
    });
    return { success: true, id: record.id };
  });

// Updates an existing medical gas pipeline record and logs the change.
export const updateGasPipeline = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid(), ...gasSchema.partial().shape }))
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    const { id, ...updates } = data;

    const { error } = await supabaseServer
      .from("medical_gas_pipeline")
      .update(updates)
      .eq("id", id);

    if (error) return { success: false, error: "Failed to update gas pipeline record" };

    await logAction(user, "update_gas_pipeline", "medical_gas_pipeline", id, updates);
    return { success: true };
  });
