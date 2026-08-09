import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { supabaseServer } from "../lib/supabase-server.js";
import { requireSessionUser } from "../lib/session.js";
import { logAction } from "../lib/audit.js";

export const nabhChecklistRouter = Router();

// GET /api/nabh-checklist/fetch — fetches NABH checklist items with optional status/category filter.
const fetchNabhChecklistSchema = z.object({
  page: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
  status: z.string().optional(),
  category: z.string().optional(),
  search: z.string().optional(),
});

nabhChecklistRouter.get("/fetch", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const data = fetchNabhChecklistSchema.parse(req.query);
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
    res.json({ data: items ?? [], total: count ?? 0, page, limit });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("fetchNabhChecklist error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch NABH checklist" });
  }
});

// POST /api/nabh-checklist/create — creates a new NABH checklist item and logs the action.
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

nabhChecklistRouter.post("/create", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = nabhSchema.parse(req.body);

    const { data: item, error } = await supabaseServer
      .from("nabh_checklist")
      .insert(data)
      .select("id, item")
      .single();

    if (error || !item) {
      res.json({ success: false, error: "Failed to create NABH checklist item" });
      return;
    }

    await logAction(user, "create_nabh_item", "nabh_checklist", item.id, { item: item.item });
    res.json({ success: true, id: item.id });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("createNabhItem error:", err);
    res.status(500).json({ success: false, error: "Failed to create NABH checklist item" });
  }
});

// POST /api/nabh-checklist/update — updates an existing NABH checklist item and logs the change.
const updateNabhSchema = z.object({
  id: z.string().uuid(),
  ...nabhSchema.partial().shape,
});

nabhChecklistRouter.post("/update", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = updateNabhSchema.parse(req.body);
    const { id, ...updates } = data;

    const { error } = await supabaseServer.from("nabh_checklist").update(updates).eq("id", id);

    if (error) {
      res.json({ success: false, error: "Failed to update NABH checklist item" });
      return;
    }

    await logAction(user, "update_nabh_item", "nabh_checklist", id, updates);
    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("updateNabhItem error:", err);
    res.status(500).json({ success: false, error: "Failed to update NABH checklist item" });
  }
});

// POST /api/nabh-checklist/delete — deletes a NABH checklist item and logs the action.
const deleteNabhSchema = z.object({
  id: z.string().uuid(),
});

nabhChecklistRouter.post("/delete", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = deleteNabhSchema.parse(req.body);

    const { error } = await supabaseServer.from("nabh_checklist").delete().eq("id", data.id);

    if (error) {
      res.json({ success: false, error: "Failed to delete NABH checklist item" });
      return;
    }

    await logAction(user, "delete_nabh_item", "nabh_checklist", data.id, {});
    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("deleteNabhItem error:", err);
    res.status(500).json({ success: false, error: "Failed to delete NABH checklist item" });
  }
});
