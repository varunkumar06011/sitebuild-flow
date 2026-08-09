import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { supabaseServer } from "../lib/supabase-server.js";
import { requireSessionUser, type SessionUser } from "../lib/session.js";
import { logAction } from "../lib/audit.js";
import type { Role } from "../lib/erp-data.js";

export const progressTrackingRouter = Router();

const ADMIN_ROLES: Role[] = ["Administrator", "A1", "A1+"];
function isAdmin(role: Role): boolean {
  return ADMIN_ROLES.includes(role);
}

function handleErr(res: Response, err: unknown, label: string) {
  if (err instanceof z.ZodError) {
    res.status(400).json({ success: false, error: "Invalid input" });
    return;
  }
  if (err instanceof Error && err.message.startsWith("Unauthorized")) {
    res.status(401).json({ success: false, error: err.message });
    return;
  }
  console.error(`${label} error:`, err);
  res.status(500).json({ success: false, error: "Internal server error" });
}

// ---------------------------------------------------------------------------
// Helper: can a supervisor edit a specific cell?
// ---------------------------------------------------------------------------

async function canSupervisorEditCell(user: SessionUser, cellId: string): Promise<boolean> {
  if (isAdmin(user.role)) return true;
  if (user.role !== "Supervisor") return false;

  const { data: cell } = await supabaseServer
    .from("progress_cells")
    .select("cell_group_id")
    .eq("id", cellId)
    .single();
  if (!cell) return false;

  const { data: group } = await supabaseServer
    .from("progress_cell_groups")
    .select("block_id, floor_id")
    .eq("id", cell.cell_group_id)
    .single();
  if (!group) return false;

  const { data: assignments } = await supabaseServer
    .from("progress_supervisor_assignments")
    .select("block_id, floor_id")
    .eq("supervisor_id", user.id)
    .eq("block_id", group.block_id);

  if (!assignments || assignments.length === 0) return false;

  for (const a of assignments) {
    if (a.floor_id === null) return true;
    if (a.floor_id === group.floor_id) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Work Views CRUD — Admin only
// ---------------------------------------------------------------------------

// POST /api/progress-tracking/work-views/create
const createWorkViewSchema = z.object({
  name: z.string().min(1),
  scope: z.enum(["flat", "floor", "block"]),
  sort_order: z.number().int().default(0),
});

progressTrackingRouter.post("/work-views/create", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (!isAdmin(user.role)) {
      res.json({ success: false, error: "Admin only" });
      return;
    }
    const data = createWorkViewSchema.parse(req.body);
    const { data: wv, error } = await supabaseServer
      .from("progress_work_views")
      .insert({
        name: data.name,
        scope: data.scope,
        sort_order: data.sort_order,
        created_by: user.id,
      })
      .select("id, name, scope, sort_order")
      .single();

    if (error || !wv) {
      res.json({ success: false, error: error?.message || "Failed to create work view" });
      return;
    }
    await logAction(user, "create_work_view", "progress_work_view", wv.id, { name: data.name, scope: data.scope });
    res.json({ success: true, data: wv });
  } catch (err) {
    handleErr(res, err, "createWorkView");
  }
});

// GET /api/progress-tracking/work-views
progressTrackingRouter.get("/work-views", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const { data: workViews, error } = await supabaseServer
      .from("progress_work_views")
      .select("id, name, scope, sort_order")
      .order("sort_order");

    if (error) {
      res.json({ success: false, error: error.message });
      return;
    }
    res.json({ data: workViews ?? [] });
  } catch (err) {
    handleErr(res, err, "fetchWorkViews");
  }
});

// POST /api/progress-tracking/work-views/update
const updateWorkViewSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).optional(),
  scope: z.enum(["flat", "floor", "block"]).optional(),
  sort_order: z.number().int().optional(),
});

progressTrackingRouter.post("/work-views/update", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (!isAdmin(user.role)) {
      res.json({ success: false, error: "Admin only" });
      return;
    }
    const data = updateWorkViewSchema.parse(req.body);
    const updates: Record<string, unknown> = {};
    if (data.name !== undefined) updates.name = data.name;
    if (data.scope !== undefined) updates.scope = data.scope;
    if (data.sort_order !== undefined) updates.sort_order = data.sort_order;

    if (Object.keys(updates).length === 0) {
      res.json({ success: false, error: "No fields to update" });
      return;
    }

    const { data: wv, error } = await supabaseServer
      .from("progress_work_views")
      .update(updates)
      .eq("id", data.id)
      .select("id, name, scope, sort_order")
      .single();

    if (error || !wv) {
      res.json({ success: false, error: error?.message || "Failed to update work view" });
      return;
    }
    await logAction(user, "update_work_view", "progress_work_view", wv.id, updates);
    res.json({ success: true, data: wv });
  } catch (err) {
    handleErr(res, err, "updateWorkView");
  }
});

// POST /api/progress-tracking/work-views/delete
progressTrackingRouter.post("/work-views/delete", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (!isAdmin(user.role)) {
      res.json({ success: false, error: "Admin only" });
      return;
    }
    const { id } = z.object({ id: z.string().uuid() }).parse(req.body);

    const { error } = await supabaseServer
      .from("progress_work_views")
      .delete()
      .eq("id", id);

    if (error) {
      res.json({ success: false, error: error.message });
      return;
    }
    await logAction(user, "delete_work_view", "progress_work_view", id, {});
    res.json({ success: true });
  } catch (err) {
    handleErr(res, err, "deleteWorkView");
  }
});

// ---------------------------------------------------------------------------
// Hierarchy CRUD — Admin only
// ---------------------------------------------------------------------------

// POST /api/progress-tracking/blocks/create
const createBlockSchema = z.object({
  name: z.string().min(1),
  sort_order: z.number().optional(),
  work_category: z.string().optional(),
});

progressTrackingRouter.post("/blocks/create", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (!isAdmin(user.role)) {
      res.json({ success: false, error: "Admin only" });
      return;
    }
    const data = createBlockSchema.parse(req.body);
    const sortOrder = Math.max(0, Math.floor(Number(data?.sort_order) || 0));
    const { data: block, error } = await supabaseServer
      .from("progress_blocks")
      .insert({
        name: data?.name,
        sort_order: sortOrder,
        work_category: data?.work_category ?? "uncategorized",
        created_by: user.id,
      })
      .select("id, name, sort_order, work_category")
      .single();

    if (error || !block) {
      res.json({ success: false, error: error?.message || "Failed to create block" });
      return;
    }
    await logAction(user, "create_block", "progress_block", block.id, { name: data?.name ?? "" });
    res.json({ success: true, data: block });
  } catch (err) {
    handleErr(res, err, "createBlock");
  }
});

// POST /api/progress-tracking/floors/create
const createFloorSchema = z.object({
  block_id: z.string().uuid(),
  name: z.string().min(1),
  sort_order: z.number().int().default(0),
});

progressTrackingRouter.post("/floors/create", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (!isAdmin(user.role)) {
      res.json({ success: false, error: "Admin only" });
      return;
    }
    const data = createFloorSchema.parse(req.body);
    const { data: floor, error } = await supabaseServer
      .from("progress_floors")
      .insert({
        block_id: data.block_id,
        name: data.name,
        sort_order: data.sort_order,
        created_by: user.id,
      })
      .select("id, block_id, name, sort_order")
      .single();

    if (error || !floor) {
      res.json({ success: false, error: "Failed to create floor" });
      return;
    }
    await logAction(user, "create_floor", "progress_floor", floor.id, {
      name: data.name,
      block_id: data.block_id,
    });
    res.json({ success: true, data: floor });
  } catch (err) {
    handleErr(res, err, "createFloor");
  }
});

// POST /api/progress-tracking/categories/create
const createCategorySchema = z.object({
  name: z.string().min(1),
  work_view_id: z.string().uuid(),
  sort_order: z.number().int().default(0),
});

progressTrackingRouter.post("/categories/create", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (!isAdmin(user.role)) {
      res.json({ success: false, error: "Admin only" });
      return;
    }
    const data = createCategorySchema.parse(req.body);
    const { data: cat, error } = await supabaseServer
      .from("progress_categories")
      .insert({
        name: data.name,
        work_view_id: data.work_view_id,
        sort_order: data.sort_order,
        created_by: user.id,
      })
      .select("id, name, work_view_id, sort_order")
      .single();

    if (error || !cat) {
      res.json({ success: false, error: "Failed to create category" });
      return;
    }
    await logAction(user, "create_category", "progress_category", cat.id, { name: data.name, work_view_id: data.work_view_id });
    res.json({ success: true, data: cat });
  } catch (err) {
    handleErr(res, err, "createCategory");
  }
});

// POST /api/progress-tracking/work-items/create
const createWorkItemSchema = z.object({
  category_id: z.string().uuid(),
  name: z.string().min(1),
  sort_order: z.number().int().default(0),
});

progressTrackingRouter.post("/work-items/create", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (!isAdmin(user.role)) {
      res.json({ success: false, error: "Admin only" });
      return;
    }
    const data = createWorkItemSchema.parse(req.body);
    const { data: item, error } = await supabaseServer
      .from("progress_work_items")
      .insert({
        category_id: data.category_id,
        name: data.name,
        sort_order: data.sort_order,
        created_by: user.id,
      })
      .select("id, category_id, name, sort_order")
      .single();

    if (error || !item) {
      res.json({ success: false, error: "Failed to create work item" });
      return;
    }
    await logAction(user, "create_work_item", "progress_work_item", item.id, {
      name: data.name,
      category_id: data.category_id,
    });
    res.json({ success: true, data: item });
  } catch (err) {
    handleErr(res, err, "createWorkItem");
  }
});

// POST /api/progress-tracking/cell-groups/create
const createCellGroupSchema = z.object({
  block_id: z.string().uuid(),
  floor_id: z.string().uuid(),
  work_item_id: z.string().uuid(),
  cell_count: z.number().int().min(1).max(500),
  unit_numbers: z.array(z.string()).optional(),
});

progressTrackingRouter.post("/cell-groups/create", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (!isAdmin(user.role)) {
      res.json({ success: false, error: "Admin only" });
      return;
    }
    const data = createCellGroupSchema.parse(req.body);
    const { data: group, error } = await supabaseServer
      .from("progress_cell_groups")
      .insert({
        block_id: data.block_id,
        floor_id: data.floor_id,
        work_item_id: data.work_item_id,
        cell_count: data.cell_count,
        created_by: user.id,
      })
      .select("id")
      .single();

    if (error || !group) {
      res.json({ success: false, error: "Failed to create cell group" });
      return;
    }

    const unitNumbers = data.unit_numbers;
    if (unitNumbers && unitNumbers.length !== data.cell_count) {
      res.json({ success: false, error: "unit_numbers length must equal cell_count" });
      return;
    }

    const cells = Array.from({ length: data.cell_count }, (_, i) => ({
      cell_group_id: group.id,
      cell_number: i + 1,
      unit_number: unitNumbers ? unitNumbers[i] ?? null : null,
    }));

    const { error: cellError } = await supabaseServer.from("progress_cells").insert(cells);

    if (cellError) {
      res.json({ success: false, error: "Failed to generate cells" });
      return;
    }

    await logAction(user, "create_cell_group", "progress_cell_group", group.id, {
      block_id: data.block_id,
      floor_id: data.floor_id,
      work_item_id: data.work_item_id,
      cell_count: data.cell_count,
    });

    res.json({ success: true, id: group.id });
  } catch (err) {
    handleErr(res, err, "createCellGroup");
  }
});

// POST /api/progress-tracking/supervisors/assign
const assignSupervisorSchema = z.object({
  supervisor_id: z.string().uuid(),
  block_id: z.string().uuid(),
  floor_id: z.string().uuid().nullable(),
});

progressTrackingRouter.post("/supervisors/assign", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (!isAdmin(user.role)) {
      res.json({ success: false, error: "Admin only" });
      return;
    }
    const data = assignSupervisorSchema.parse(req.body);
    const { error } = await supabaseServer.from("progress_supervisor_assignments").insert({
      supervisor_id: data.supervisor_id,
      block_id: data.block_id,
      floor_id: data.floor_id,
    });

    if (error) {
      res.json({ success: false, error: error.message });
      return;
    }

    await logAction(
      user,
      "assign_supervisor",
      "progress_supervisor_assignment",
      data.supervisor_id,
      {
        block_id: data.block_id,
        floor_id: data.floor_id,
      },
    );

    res.json({ success: true });
  } catch (err) {
    handleErr(res, err, "assignSupervisor");
  }
});

// GET /api/progress-tracking/hierarchy
progressTrackingRouter.get("/hierarchy", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);

    const [blocks, floors, workViews, categories, workItems] = await Promise.all([
      supabaseServer
        .from("progress_blocks")
        .select("id, name, sort_order, work_category")
        .order("sort_order"),
      supabaseServer
        .from("progress_floors")
        .select("id, block_id, name, sort_order")
        .order("sort_order"),
      supabaseServer
        .from("progress_work_views")
        .select("id, name, scope, sort_order")
        .order("sort_order"),
      supabaseServer
        .from("progress_categories")
        .select("id, name, work_view_id, sort_order")
        .order("sort_order"),
      supabaseServer
        .from("progress_work_items")
        .select("id, category_id, name, sort_order")
        .order("sort_order"),
    ]);

    res.json({
      blocks: blocks.data ?? [],
      floors: floors.data ?? [],
      workViews: workViews.data ?? [],
      categories: categories.data ?? [],
      workItems: workItems.data ?? [],
    });
  } catch (err) {
    handleErr(res, err, "fetchHierarchy");
  }
});

// GET /api/progress-tracking/supervisors
progressTrackingRouter.get("/supervisors", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (!isAdmin(user.role)) {
      res.json({ data: [] });
      return;
    }

    const { data: supervisors } = await supabaseServer
      .from("users")
      .select("id, name")
      .eq("role", "Supervisor")
      .order("name");

    res.json({ data: supervisors ?? [] });
  } catch (err) {
    handleErr(res, err, "fetchSupervisors");
  }
});

// GET /api/progress-tracking/my-cells
progressTrackingRouter.get("/my-cells", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const status = req.query["status"] as string | undefined;

    const { data: assignments } = await supabaseServer
      .from("progress_supervisor_assignments")
      .select("block_id, floor_id")
      .eq("supervisor_id", user.id);

    if (!assignments || assignments.length === 0) {
      res.json({ data: [] });
      return;
    }

    const blockIds = [...new Set(assignments.map((a: any) => a.block_id))];
    const blockFloorMap = new Map<string, (string | null)[]>();
    for (const a of assignments) {
      const existing = blockFloorMap.get(a.block_id) ?? [];
      existing.push(a.floor_id);
      blockFloorMap.set(a.block_id, existing);
    }

    const { data: groups } = await supabaseServer
      .from("progress_cell_groups")
      .select("id, block_id, floor_id, work_item_id")
      .in("block_id", blockIds);

    if (!groups || groups.length === 0) {
      res.json({ data: [] });
      return;
    }

    const validGroupIds: string[] = [];
    for (const g of groups) {
      const floors = blockFloorMap.get(g.block_id) ?? [];
      if (floors.includes(null)) {
        validGroupIds.push(g.id);
      } else if (floors.includes(g.floor_id)) {
        validGroupIds.push(g.id);
      }
    }

    if (validGroupIds.length === 0) {
      res.json({ data: [] });
      return;
    }

    const workItemIds = [...new Set(groups.map((g: any) => g.work_item_id))];
    const [{ data: workItems }, { data: cats }] = await Promise.all([
      supabaseServer
        .from("progress_work_items")
        .select("id, name, category_id")
        .in("id", workItemIds),
      supabaseServer
        .from("progress_categories")
        .select("id, name, work_view_id, sort_order, progress_work_views!inner(scope)")
        .order("sort_order"),
    ]);
    const wiMap = new Map((workItems ?? []).map((w: any) => [w.id, w]));
    const catMap = new Map((cats ?? []).map((c: any) => [c.id, c]));

    const { data: blocks } = await supabaseServer
      .from("progress_blocks")
      .select("id, name")
      .in("id", blockIds);
    const { data: floorsData } = await supabaseServer
      .from("progress_floors")
      .select("id, name")
      .in("block_id", blockIds);
    const blockMap = new Map((blocks ?? []).map((b: any) => [b.id, b.name]));
    const floorMap = new Map((floorsData ?? []).map((f: any) => [f.id, f.name]));

    const groupMap = new Map(groups.map((g: any) => [g.id, g]));

    let cellQuery = supabaseServer
      .from("progress_cells")
      .select(
        "id, cell_group_id, cell_number, unit_number, status, completion_pct, remarks, updated_by, updated_at",
      )
      .in("cell_group_id", validGroupIds)
      .order("cell_number");

    if (status) cellQuery = cellQuery.eq("status", status);

    const { data: cells } = await cellQuery;

    const result = (cells ?? []).map((c: any) => {
      const g = groupMap.get(c.cell_group_id);
      const wi = g ? wiMap.get(g.work_item_id) : null;
      const cat = wi ? catMap.get(wi.category_id) : null;
      return {
        id: c.id,
        cell_group_id: c.cell_group_id,
        cell_number: c.cell_number,
        unit_number: c.unit_number ?? null,
        status: c.status,
        completion_pct: Number(c.completion_pct),
        remarks: c.remarks,
        assigned_supervisor_id: null,
        updated_by: c.updated_by,
        updated_at: c.updated_at,
        block_name: g ? (blockMap.get(g.block_id) ?? "") : "",
        floor_name: g ? (floorMap.get(g.floor_id) ?? "") : "",
        work_item_name: wi?.name ?? "",
        category_name: cat?.name ?? "",
        work_view_scope: cat?.progress_work_views?.scope ?? "flat",
      };
    });

    res.json({ data: result });
  } catch (err) {
    handleErr(res, err, "fetchMyCells");
  }
});

// POST /api/progress-tracking/cells/update
const updateCellSchema = z.object({
  cell_id: z.string().uuid(),
  status: z.enum(["not_started", "in_progress", "completed", "on_hold"]),
  completion_pct: z.number().min(0).max(100),
  remarks: z.string().nullable(),
});

progressTrackingRouter.post("/cells/update", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = updateCellSchema.parse(req.body);

    const canEdit = await canSupervisorEditCell(user, data.cell_id);
    if (!canEdit) {
      res.json({ success: false, error: "You are not assigned to this cell" });
      return;
    }

    const { data: cell } = await supabaseServer
      .from("progress_cells")
      .select("id, status, completion_pct, remarks")
      .eq("id", data.cell_id)
      .single();

    if (!cell) {
      res.json({ success: false, error: "Cell not found" });
      return;
    }

    const now = new Date().toISOString();

    const { error } = await supabaseServer
      .from("progress_cells")
      .update({
        status: data.status,
        completion_pct: data.completion_pct,
        remarks: data.remarks,
        updated_by: user.id,
        updated_at: now,
      })
      .eq("id", data.cell_id);

    if (error) {
      res.json({ success: false, error: "Failed to update cell" });
      return;
    }

    await supabaseServer.from("progress_cell_history").insert({
      cell_id: data.cell_id,
      changed_by: user.id,
      previous_status: cell.status,
      new_status: data.status,
      previous_pct: Number(cell.completion_pct),
      new_pct: data.completion_pct,
      remarks: data.remarks,
    });

    await logAction(user, "update_cell", "progress_cell", data.cell_id, {
      from_status: cell.status,
      to_status: data.status,
      from_pct: Number(cell.completion_pct),
      to_pct: data.completion_pct,
    });

    res.json({ success: true });
  } catch (err) {
    handleErr(res, err, "updateCell");
  }
});

// POST /api/progress-tracking/cells/upload-photo
const uploadCellPhotoSchema = z.object({
  cell_id: z.string().uuid(),
  contentType: z.string(),
  fileData: z.string(),
  caption: z.string().optional(),
});

progressTrackingRouter.post("/cells/upload-photo", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = uploadCellPhotoSchema.parse(req.body);

    const canEdit = await canSupervisorEditCell(user, data.cell_id);
    if (!canEdit) {
      res.json({ success: false, error: "You are not assigned to this cell" });
      return;
    }

    const PHOTO_MIMES = ["image/jpeg", "image/png", "image/webp"];
    if (!PHOTO_MIMES.includes(data.contentType)) {
      res.json({ success: false, error: "File type not allowed" });
      return;
    }

    const buffer = Buffer.from(data.fileData, "base64");
    if (buffer.length > 5 * 1024 * 1024) {
      res.json({ success: false, error: "File exceeds 5MB limit" });
      return;
    }

    const timestamp = Date.now();
    const ext = data.contentType.split("/")[1] ?? "jpg";
    const path = `progress/${data.cell_id}/${timestamp}.${ext}`;

    const { error: uploadError } = await supabaseServer.storage
      .from("photos")
      .upload(path, buffer, { contentType: data.contentType, upsert: false });

    if (uploadError) {
      res.json({ success: false, error: `Upload failed: ${uploadError.message}` });
      return;
    }

    const { data: photo, error: dbError } = await supabaseServer
      .from("progress_cell_photos")
      .insert({
        cell_id: data.cell_id,
        storage_path: path,
        caption: data.caption ?? null,
        uploaded_by: user.id,
      })
      .select("id, storage_path, caption, uploaded_at")
      .single();

    if (dbError || !photo) {
      res.json({ success: false, error: "Failed to save photo record" });
      return;
    }

    await logAction(user, "upload_cell_photo", "progress_cell_photo", photo.id, {
      cell_id: data.cell_id,
      path,
    });

    res.json({ success: true, data: photo });
  } catch (err) {
    handleErr(res, err, "uploadCellPhoto");
  }
});

// GET /api/progress-tracking/cells/history
progressTrackingRouter.get("/cells/history", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const cell_id = z.string().uuid().parse(req.query["cell_id"]);

    if (!isAdmin(user.role)) {
      const canView = await canSupervisorEditCell(user, cell_id);
      if (!canView) {
        res.json({ history: [], photos: [] });
        return;
      }
    }

    const [histResult, photosResult] = await Promise.all([
      supabaseServer
        .from("progress_cell_history")
        .select(
          "id, cell_id, changed_by, previous_status, new_status, previous_pct, new_pct, remarks, created_at",
        )
        .eq("cell_id", cell_id)
        .order("created_at", { ascending: false }),
      supabaseServer
        .from("progress_cell_photos")
        .select("id, cell_id, storage_path, caption, uploaded_by, uploaded_at")
        .eq("cell_id", cell_id)
        .order("uploaded_at", { ascending: false }),
    ]);

    const userIds = [...new Set((histResult.data ?? []).map((h: any) => h.changed_by))];
    let userMap = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: users } = await supabaseServer
        .from("users")
        .select("id, name")
        .in("id", userIds);
      userMap = new Map((users ?? []).map((u: any) => [u.id, u.name]));
    }

    const history = (histResult.data ?? []).map((h: any) => ({
      id: h.id,
      cell_id: h.cell_id,
      changed_by: h.changed_by,
      changed_by_name: userMap.get(h.changed_by) ?? "Unknown",
      previous_status: h.previous_status,
      new_status: h.new_status,
      previous_pct: h.previous_pct !== null ? Number(h.previous_pct) : null,
      new_pct: h.new_pct !== null ? Number(h.new_pct) : null,
      remarks: h.remarks,
      created_at: h.created_at,
    }));

    res.json({ history, photos: photosResult.data ?? [] });
  } catch (err) {
    handleErr(res, err, "fetchCellHistory");
  }
});

// GET /api/progress-tracking/dashboard
progressTrackingRouter.get("/dashboard", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);

    const { data: groups } = await supabaseServer
      .from("progress_cell_groups")
      .select(
        `
          id,
          block_id,
          floor_id,
          work_item_id,
          cell_count,
          progress_blocks!inner(name),
          progress_floors!inner(name),
          progress_work_items!inner(name, category_id, progress_categories!inner(name, work_view_id, progress_work_views!inner(scope)))
        `,
      )
      .order("id");

    if (!groups || groups.length === 0) {
      res.json({ blocks: [], cells: [] });
      return;
    }

    const groupIds = groups.map((g: any) => g.id);

    const { data: cells } = await supabaseServer
      .from("progress_cells")
      .select("id, cell_group_id, cell_number, unit_number, status, completion_pct, updated_at")
      .in("cell_group_id", groupIds)
      .order("cell_number");

    const groupMap = new Map(groups.map((g: any) => [g.id, g]));

    // Compute is_editable per cell using the same logic as canSupervisorEditCell:
    //   Admin → always true; Supervisor → true only if assigned to the cell's block/floor; other → false.
    // We batch-fetch the supervisor's assignments once instead of calling canSupervisorEditCell per cell.
    let editableCellIds: Set<string> | null = null;
    if (!isAdmin(user.role) && user.role === "Supervisor") {
      const { data: assignments } = await supabaseServer
        .from("progress_supervisor_assignments")
        .select("block_id, floor_id")
        .eq("supervisor_id", user.id);

      if (assignments && assignments.length > 0) {
        const blockFloorMap = new Map<string, (string | null)[]>();
        for (const a of assignments) {
          const existing = blockFloorMap.get(a.block_id) ?? [];
          existing.push(a.floor_id);
          blockFloorMap.set(a.block_id, existing);
        }
        editableCellIds = new Set<string>();
        for (const c of cells ?? []) {
          const g = groupMap.get(c.cell_group_id);
          if (!g) continue;
          const floors = blockFloorMap.get(g.block_id);
          if (!floors) continue;
          for (const f of floors) {
            if (f === null || f === g.floor_id) {
              editableCellIds.add(c.id);
              break;
            }
          }
        }
      }
    }

    const blockAgg = new Map<
      string,
      {
        name: string;
        total: number;
        completed: number;
        inProgress: number;
        notStarted: number;
        onHold: number;
        avgPct: number;
        count: number;
      }
    >();

    for (const c of cells ?? []) {
      const g = groupMap.get(c.cell_group_id);
      if (!g) continue;
      const blockName = g.progress_blocks?.name ?? "Unknown";
      const key = g.block_id;

      if (!blockAgg.has(key)) {
        blockAgg.set(key, {
          name: blockName,
          total: 0,
          completed: 0,
          inProgress: 0,
          notStarted: 0,
          onHold: 0,
          avgPct: 0,
          count: 0,
        });
      }
      const agg = blockAgg.get(key)!;
      agg.total++;
      agg.count++;
      agg.avgPct += Number(c.completion_pct);
      if (c.status === "completed") agg.completed++;
      else if (c.status === "in_progress") agg.inProgress++;
      else if (c.status === "not_started") agg.notStarted++;
      else if (c.status === "on_hold") agg.onHold++;
    }

    const blocks = Array.from(blockAgg.values()).map((b) => ({
      ...b,
      avgPct: b.count > 0 ? Math.round(b.avgPct / b.count) : 0,
    }));

    const flatCells = (cells ?? []).map((c: any) => {
      const g = groupMap.get(c.cell_group_id);
      return {
        id: c.id,
        cell_group_id: c.cell_group_id,
        cell_number: c.cell_number,
        unit_number: c.unit_number ?? null,
        status: c.status,
        completion_pct: Number(c.completion_pct),
        updated_at: c.updated_at,
        block_name: g?.progress_blocks?.name ?? "",
        floor_name: g?.progress_floors?.name ?? "",
        work_item_name: g?.progress_work_items?.name ?? "",
        category_name: g?.progress_work_items?.progress_categories?.name ?? "",
        work_view_scope: g?.progress_work_items?.progress_categories?.progress_work_views?.scope ?? "flat",
        is_editable: isAdmin(user.role) ? true : (editableCellIds?.has(c.id) ?? false),
      };
    });

    res.json({ blocks, cells: flatCells });
  } catch (err) {
    handleErr(res, err, "fetchProgressDashboard");
  }
});
