import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseServer } from "../supabase-server";
import { requireSessionUser } from "./session";
import { logAction } from "./audit";

export const fetchVendors = createServerFn({ method: "GET" })
  .validator((input: { page?: number; limit?: number; search?: string }) => input)
  .handler(async ({ data, context }) => {
    await requireSessionUser();
    const page = data.page ?? 1;
    const limit = data.limit ?? 50;
    const offset = (page - 1) * limit;

    let query = supabaseServer
      .from("vendors")
      .select("id, name, gst_number, address, city, state, pincode, phone, email, created_at", { count: "exact" })
      .order("name", { ascending: true })
      .range(offset, offset + limit - 1);

    if (data.search) {
      query = query.or(`name.ilike.%${data.search}%,gst_number.ilike.%${data.search}%`);
    }

    const { data: vendors, count } = await query;

    return { data: vendors ?? [], total: count ?? 0, page, limit };
  });

const vendorSchema = z.object({
  name: z.string().min(1),
  gst_number: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pincode: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
});

export const createVendor = createServerFn({ method: "POST" })
  .validator(vendorSchema)
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();
    if (user.role === "Supervisor") {
      return { success: false, error: "Only administrators and above can create vendors" };
    }

    const { data: vendor, error } = await supabaseServer
      .from("vendors")
      .insert(data)
      .select("id, name")
      .single();

    if (error || !vendor) {
      return { success: false, error: "Failed to create vendor" };
    }

    await logAction(user, "create_vendor", "vendor", vendor.id, { name: vendor.name });
    return { success: true, id: vendor.id };
  });

export const updateVendor = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid(), ...vendorSchema.shape }))
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();
    if (user.role === "Supervisor") {
      return { success: false, error: "Only administrators and above can update vendors" };
    }

    const { id, ...updates } = data;
    const { error } = await supabaseServer
      .from("vendors")
      .update(updates)
      .eq("id", id);

    if (error) {
      return { success: false, error: "Failed to update vendor" };
    }

    await logAction(user, "update_vendor", "vendor", id, updates);
    return { success: true };
  });
