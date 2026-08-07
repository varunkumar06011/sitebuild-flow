import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseServer } from "../supabase-server";
import { requireSessionUser } from "./session";
import { logAction } from "./audit";

// Fetches a paginated list of material batches with optional status filter.
export const fetchBatches = createServerFn({ method: "GET" })
  .validator((input: { page?: number; limit?: number; status?: string; search?: string }) => input)
  .handler(async ({ data, context }) => {
    await requireSessionUser();
    const page = data.page ?? 1;
    const limit = data.limit ?? 50;
    const offset = (page - 1) * limit;

    let query = supabaseServer
      .from("batches")
      .select(
        "id, batch_number, material, supplier, manufacturer, purchase_date, invoice, challan, mtc, lab_report, photos, status",
        { count: "exact" },
      )
      .order("purchase_date", { ascending: false })
      .range(offset, offset + limit - 1);

    if (data.status) query = query.eq("status", data.status);
    if (data.search) {
      const s = data.search.replace(/[,.()\\]/g, " ").trim();
      if (s) {
        query = query.or(
          `batch_number.ilike.%${s}%,material.ilike.%${s}%,supplier.ilike.%${s}%,manufacturer.ilike.%${s}%`,
        );
      }
    }

    const { data: batches, count } = await query;

    return { data: batches ?? [], total: count ?? 0, page, limit };
  });

// Zod schema validating batch creation fields (number, material, documents, status).
const batchSchema = z.object({
  batch_number: z.string().min(1),
  material: z.string().min(1),
  supplier: z.string().optional(),
  manufacturer: z.string().optional(),
  purchase_date: z.string().optional(),
  invoice: z.string().optional(),
  challan: z.string().optional(),
  mtc: z.string().optional(),
  lab_report: z.string().optional(),
  status: z.enum(["Verified", "Pending MTC", "Under Test"]).default("Pending MTC"),
});

// Creates a new material batch and logs the action to the audit trail.
export const createBatch = createServerFn({ method: "POST" })
  .validator(batchSchema)
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();

    const { data: batch, error } = await supabaseServer
      .from("batches")
      .insert({ ...data, photos: [] })
      .select("id, batch_number")
      .single();

    if (error || !batch) {
      return { success: false, error: "Failed to create batch" };
    }

    await logAction(user, "create_batch", "batch", batch.id, { batch_number: batch.batch_number });
    return { success: true, id: batch.id };
  });

// Updates an existing batch's fields and logs the change to the audit trail.
export const updateBatch = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid(), ...batchSchema.partial().shape }))
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();
    const { id, ...updates } = data;

    const { error } = await supabaseServer.from("batches").update(updates).eq("id", id);

    if (error) return { success: false, error: "Failed to update batch" };

    await logAction(user, "update_batch", "batch", id, updates);
    return { success: true };
  });
