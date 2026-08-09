import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { supabaseServer } from "../lib/supabase-server.js";
import { requireSessionUser } from "../lib/session.js";
import { logAction } from "../lib/audit.js";
import type { Role } from "../lib/erp-data.js";

export const workCategoriesRouter = Router();

const ADMIN_ROLES: Role[] = ["Administrator", "A1", "A1+"];
function isAdmin(role: Role): boolean {
  return ADMIN_ROLES.includes(role);
}

// GET /api/work-categories/fetch — fetches all work categories (any authenticated user).
workCategoriesRouter.get("/fetch", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);

    const { data: categories } = await supabaseServer
      .from("work_categories")
      .select("id, name, label, description, sort_order")
      .order("sort_order", { ascending: true });

    res.json({ data: categories ?? [] });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("fetchWorkCategories error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch work categories" });
  }
});

// POST /api/work-categories/create — creates a new work category (admin only).
const workCategorySchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z0-9_-]+$/),
  label: z.string().min(1),
  description: z.string().optional(),
  sort_order: z.number().optional(),
});

workCategoriesRouter.post("/create", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (!isAdmin(user.role)) {
      res.json({ success: false, error: "Only administrators can create work categories" });
      return;
    }

    const data = workCategorySchema.parse(req.body);

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
      res.json({ success: false, error: "Failed to create work category" });
      return;
    }

    await logAction(user, "create_work_category", "work_category", cat.id, {
      name: cat.name,
      label: cat.label,
    });
    res.json({ success: true, category: cat });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("createWorkCategory error:", err);
    res.status(500).json({ success: false, error: "Failed to create work category" });
  }
});
