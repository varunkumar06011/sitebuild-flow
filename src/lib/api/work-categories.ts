import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseServer } from "../supabase-server";
import { requireSessionUser } from "./session";
import { logAction } from "./audit";
import type { Role } from "../erp-data";

const ADMIN_ROLES: Role[] = ["Administrator", "A1", "A1+"];
function isAdmin(role: Role): boolean {
  return ADMIN_ROLES.includes(role);
}

export type WorkCategory = {
  id: string;
  name: string;
  label: string;
  description: string | null;
  sort_order: number;
};

// ---------------------------------------------------------------------------
// Fetch all work categories (any authenticated user)
// ---------------------------------------------------------------------------
export const fetchWorkCategories = createServerFn({ method: "GET" })
  .validator((input: {}) => input)
  .handler(async () => {
    await requireSessionUser();

    const { data: categories } = await supabaseServer
      .from("work_categories")
      .select("id, name, label, description, sort_order")
      .order("sort_order", { ascending: true });

    return { data: categories ?? [] };
  });

// ---------------------------------------------------------------------------
// Create a new work category (admin only)
// ---------------------------------------------------------------------------
const workCategorySchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z0-9_-]+$/),
  label: z.string().min(1),
  description: z.string().optional(),
  sort_order: z.number().optional(),
});

export const createWorkCategory = createServerFn({ method: "POST" })
  .validator(workCategorySchema)
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    if (!isAdmin(user.role)) {
      return { success: false, error: "Only administrators can create work categories" };
    }

    const { data: cat, error } = await supabaseServer
      .from("work_categories")
      .insert({
        name: data.name.trim().toLowerCase(),
        label: data.label.trim(),
        description: data.description ?? null,
        sort_order: data.sort_order ?? 99,
      })
      .select("id, name, label")
      .single();

    if (error || !cat) {
      return { success: false, error: "Failed to create work category" };
    }

    await logAction(user, "create_work_category", "work_category", cat.id, {
      name: cat.name,
      label: cat.label,
    });
    return { success: true, category: cat };
  });
