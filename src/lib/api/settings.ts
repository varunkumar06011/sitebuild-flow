import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseServer } from "../supabase-server";
import { requireSessionUser } from "./session";
import { logAction } from "./audit";

// Fetches the single organization settings row (name, GST, address, logo, etc.).
export const fetchOrgSettings = createServerFn({ method: "GET" }).handler(async ({ context }) => {
  await requireSessionUser();

  const { data, error } = await supabaseServer
    .from("organization_settings")
    .select("id, name, gst_number, address, city, state, pincode, phone, email, logo_url")
    .limit(1)
    .single();

  if (error || !data) {
    return { success: false, error: "Failed to fetch settings" };
  }

  return { success: true, data };
});

// Zod schema validating organization settings fields (name, GST, address, contact, logo).
const settingsSchema = z.object({
  name: z.string().min(1),
  gst_number: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pincode: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  logo_url: z.string().optional(),
});

// Creates or updates the organization settings row (A1/A1+ only) and logs the action.
export const updateOrgSettings = createServerFn({ method: "POST" })
  .validator(settingsSchema)
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();
    if (user.role !== "A1+" && user.role !== "A1") {
      return { success: false, error: "Only A1+ and A1 can update organization settings" };
    }

    const { data: existing } = await supabaseServer
      .from("organization_settings")
      .select("id")
      .limit(1)
      .single();

    if (existing) {
      const { error } = await supabaseServer
        .from("organization_settings")
        .update(data)
        .eq("id", existing.id);

      if (error) return { success: false, error: "Failed to update settings" };
      await logAction(user, "update_org_settings", "organization_settings", existing.id, data);
      return { success: true };
    }

    const { data: created, error } = await supabaseServer
      .from("organization_settings")
      .insert(data)
      .select("id")
      .single();

    if (error || !created) return { success: false, error: "Failed to create settings" };
    await logAction(user, "create_org_settings", "organization_settings", created.id, data);
    return { success: true };
  });
