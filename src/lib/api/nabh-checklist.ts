import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseServer } from "../supabase-server";
import { requireSessionUser } from "./session";
import { logAction } from "./audit";

// Fetches NABH checklist items with optional status/category filter.
export const fetchNabhChecklist = createServerFn({ method: "GET" })
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
    const limit = data.limit ?? 100;
    const offset = (page - 1) * limit;

    let query = supabaseServer
      .from("nabh_checklist")
      .select(
        "id, category, item, status, responsible_party, document_path, expiry_date, completed_date, notes, created_at",
        { count: "exact" },
      )
      .order("category", { ascending: true })
      .range(offset, offset + limit - 1);

    if (data.status) query = query.eq("status", data.status);
    if (data.category) query = query.eq("category", data.category);
    if (data.search) {
      const s = data.search.replace(/[,.()\\]/g, " ").trim();
      if (s) {
        query = query.or(`item.ilike.%${s}%,category.ilike.%${s}%,responsible_party.ilike.%${s}%`);
      }
    }

    const { data: items, count } = await query;
    return { data: items ?? [], total: count ?? 0, page, limit };
  });

const nabhSchema = z.object({
  category: z.string().min(1),
  item: z.string().min(1),
  status: z.enum(["Pending", "In Progress", "Completed", "Not Applicable"]).default("Pending"),
  responsible_party: z.string().optional(),
  document_path: z.string().optional(),
  expiry_date: z.string().optional(),
  completed_date: z.string().optional(),
  notes: z.string().optional(),
});

// Creates a new NABH checklist item and logs the action.
export const createNabhItem = createServerFn({ method: "POST" })
  .validator(nabhSchema)
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    const { data: item, error } = await supabaseServer
      .from("nabh_checklist")
      .insert(data)
      .select("id, item")
      .single();

    if (error || !item) {
      return { success: false, error: "Failed to create NABH checklist item" };
    }

    await logAction(user, "create_nabh_item", "nabh_checklist", item.id, { item: item.item });
    return { success: true, id: item.id };
  });

// Updates an existing NABH checklist item and logs the change.
export const updateNabhItem = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid(), ...nabhSchema.partial().shape }))
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    const { id, ...updates } = data;

    const { error } = await supabaseServer.from("nabh_checklist").update(updates).eq("id", id);

    if (error) return { success: false, error: "Failed to update NABH checklist item" };

    await logAction(user, "update_nabh_item", "nabh_checklist", id, updates);
    return { success: true };
  });

// Deletes a NABH checklist item and logs the action.
export const deleteNabhItem = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    const { error } = await supabaseServer.from("nabh_checklist").delete().eq("id", data.id);

    if (error) return { success: false, error: "Failed to delete NABH checklist item" };

    await logAction(user, "delete_nabh_item", "nabh_checklist", data.id, {});
    return { success: true };
  });
