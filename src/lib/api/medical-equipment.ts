import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseServer } from "../supabase-server";
import { requireSessionUser } from "./session";
import { logAction } from "./audit";

// Fetches a paginated list of medical equipment with optional status/category filter.
export const fetchEquipment = createServerFn({ method: "GET" })
  .validator(
    (input: {
      page?: number;
      limit?: number;
      status?: string;
      category?: string;
      search?: string;
    }) => input,
  )
  .handler(async ({ data }) => {
    await requireSessionUser();
    const page = data.page ?? 1;
    const limit = data.limit ?? 50;
    const offset = (page - 1) * limit;

    let query = supabaseServer
      .from("medical_equipment")
      .select(
        "id, eq_number, name, model, serial_number, manufacturer, category, location, vendor_id, requisition_id, status, warranty_start, warranty_end, amc_expiry, handover_date, handover_department, commissioning_checklist, certificates, photos, notes, created_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (data.status) query = query.eq("status", data.status);
    if (data.category) query = query.eq("category", data.category);
    if (data.search) {
      const s = data.search.replace(/[,.()\\]/g, " ").trim();
      if (s) {
        query = query.or(
          `eq_number.ilike.%${s}%,name.ilike.%${s}%,model.ilike.%${s}%,serial_number.ilike.%${s}%,manufacturer.ilike.%${s}%`,
        );
      }
    }

    const { data: equipment, count } = await query;
    return { data: equipment ?? [], total: count ?? 0, page, limit };
  });

// Zod schema validating equipment creation fields.
const equipmentSchema = z.object({
  eq_number: z.string().min(1),
  name: z.string().min(1),
  model: z.string().optional(),
  serial_number: z.string().optional(),
  manufacturer: z.string().optional(),
  category: z.string().optional(),
  location: z.string().optional(),
  vendor_id: z.string().uuid().optional(),
  requisition_id: z.string().uuid().optional(),
  status: z
    .enum(["Ordered", "Delivered", "Installed", "Testing", "Commissioned", "Handed Over"])
    .default("Ordered"),
  warranty_start: z.string().optional(),
  warranty_end: z.string().optional(),
  amc_expiry: z.string().optional(),
  handover_date: z.string().optional(),
  handover_department: z.string().optional(),
  commissioning_checklist: z.array(z.object({ item: z.string(), ok: z.boolean() })).default([]),
  certificates: z
    .array(
      z.object({
        type: z.string(),
        number: z.string().optional(),
        issued_date: z.string().optional(),
        expiry_date: z.string().optional(),
      }),
    )
    .default([]),
  photos: z.array(z.string()).default([]),
  notes: z.string().optional(),
});

// Creates a new medical equipment record and logs the action.
export const createEquipment = createServerFn({ method: "POST" })
  .validator(equipmentSchema)
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    const { data: equipment, error } = await supabaseServer
      .from("medical_equipment")
      .insert(data)
      .select("id, eq_number")
      .single();

    if (error || !equipment) {
      return { success: false, error: "Failed to create equipment" };
    }

    await logAction(user, "create_equipment", "medical_equipment", equipment.id, {
      eq_number: equipment.eq_number,
    });
    return { success: true, id: equipment.id };
  });

// Updates an existing equipment record and logs the change.
export const updateEquipment = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid(), ...equipmentSchema.partial().shape }))
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    const { id, ...updates } = data;

    const { error } = await supabaseServer.from("medical_equipment").update(updates).eq("id", id);

    if (error) return { success: false, error: "Failed to update equipment" };

    await logAction(user, "update_equipment", "medical_equipment", id, updates);
    return { success: true };
  });
