import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseServer } from "../supabase-server";
import { requireSessionUser, type SessionUser } from "./session";
import { logAction } from "./audit";
import type { Role } from "../erp-data";

// Roles permitted to manage progress hierarchy and assignments.
const ADMIN_ROLES: Role[] = ["Administrator", "A1", "A1+"];
// Returns true if the given role has admin-level progress permissions.
function isAdmin(role: Role): boolean {
  return ADMIN_ROLES.includes(role);
}

// ---------------------------------------------------------------------------
// Helper: can a supervisor edit a specific cell?
// ---------------------------------------------------------------------------
// Checks whether a supervisor is assigned to the block/floor containing the given cell.
async function canSupervisorEditCell(user: SessionUser, cellId: string): Promise<boolean> {
  if (isAdmin(user.role)) return true;
  if (user.role !== "Supervisor") return false;

  // Walk cell → cell_group → block/floor, then check assignments
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

  // Check block-level assignment (floor_id NULL = covers whole block)
  const { data: assignments } = await supabaseServer
    .from("progress_supervisor_assignments")
    .select("block_id, floor_id")
    .eq("supervisor_id", user.id)
    .eq("block_id", group.block_id);

  if (!assignments || assignments.length === 0) return false;

  for (const a of assignments) {
    if (a.floor_id === null) return true; // whole block
    if (a.floor_id === group.floor_id) return true; // specific floor
  }
  return false;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
// Represents a construction block in the progress tracking hierarchy.
export type ProgressBlock = {
  id: string;
  name: string;
  sort_order: number;
  work_category: string;
};

// Represents a floor within a block in the progress tracking hierarchy.
export type ProgressFloor = {
  id: string;
  block_id: string;
  name: string;
  sort_order: number;
};

// Represents a work category (e.g. civil, finishing) used to group work items.
export type ProgressCategory = {
  id: string;
  name: string;
  sort_order: number;
};

// Represents a specific work item belonging to a category in the progress hierarchy.
export type ProgressWorkItem = {
  id: string;
  category_id: string;
  name: string;
  sort_order: number;
};

// Represents a group of cells sharing a block/floor/work-item combination with denormalized names.
export type ProgressCellGroup = {
  id: string;
  block_id: string;
  block_name: string;
  floor_id: string;
  floor_name: string;
  work_item_id: string;
  work_item_name: string;
  category_name: string;
  cell_count: number;
};

// Represents a single progress tracking cell with status, completion, and denormalized hierarchy names.
export type ProgressCell = {
  id: string;
  cell_group_id: string;
  cell_number: number;
  status: string;
  completion_pct: number;
  remarks: string | null;
  assigned_supervisor_id: string | null;
  updated_by: string | null;
  updated_at: string | null;
  block_name: string;
  floor_name: string;
  work_item_name: string;
  category_name: string;
};

// Represents one history entry recording a status/completion change for a cell.
export type ProgressCellHistoryEntry = {
  id: string;
  cell_id: string;
  changed_by: string;
  changed_by_name: string;
  previous_status: string | null;
  new_status: string | null;
  previous_pct: number | null;
  new_pct: number | null;
  remarks: string | null;
  created_at: string;
};

// Represents a photo uploaded as proof for a progress cell.
export type ProgressCellPhoto = {
  id: string;
  cell_id: string;
  storage_path: string;
  caption: string | null;
  uploaded_by: string;
  uploaded_at: string;
};

// ---------------------------------------------------------------------------
// Hierarchy CRUD — Admin only
// ---------------------------------------------------------------------------

// Zod schema validating a named hierarchy node with a sort order.
const nameSchema = z.object({
  name: z.string().min(1),
  sort_order: z.number().int().default(0),
});

// Creates a new progress block (admin only) and logs the action.
export const createBlock = createServerFn({ method: "POST" })
  .validator((input: { name: string; sort_order?: number; work_category?: string }) => input)
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    if (!isAdmin(user.role)) return { success: false, error: "Admin only" };

    const sortOrder = Math.max(0, Math.floor(Number(data?.sort_order) || 0));
    const { data: block, error } = await supabaseServer
      .from("progress_blocks")
      .insert({
        name: data?.name,
        sort_order: sortOrder,
        work_category: (data as any)?.work_category ?? "uncategorized",
        created_by: user.id,
      })
      .select("id, name, sort_order, work_category")
      .single();

    if (error || !block) {
      return { success: false, error: error?.message || "Failed to create block" };
    }
    await logAction(user, "create_block", "progress_block", block.id, { name: data?.name ?? "" });
    return { success: true, data: block };
  });

// Creates a new floor under a block (admin only) and logs the action.
export const createFloor = createServerFn({ method: "POST" })
  .validator(
    z.object({
      block_id: z.string().uuid(),
      name: z.string().min(1),
      sort_order: z.number().int().default(0),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    if (!isAdmin(user.role)) return { success: false, error: "Admin only" };

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

    if (error || !floor) return { success: false, error: "Failed to create floor" };
    await logAction(user, "create_floor", "progress_floor", floor.id, {
      name: data.name,
      block_id: data.block_id,
    });
    return { success: true, data: floor };
  });

// Creates a new work category (admin only) and logs the action.
export const createCategory = createServerFn({ method: "POST" })
  .validator(nameSchema)
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    if (!isAdmin(user.role)) return { success: false, error: "Admin only" };

    const { data: cat, error } = await supabaseServer
      .from("progress_categories")
      .insert({ name: data.name, sort_order: data.sort_order, created_by: user.id })
      .select("id, name, sort_order")
      .single();

    if (error || !cat) return { success: false, error: "Failed to create category" };
    await logAction(user, "create_category", "progress_category", cat.id, { name: data.name });
    return { success: true, data: cat };
  });

// Creates a new work item under a category (admin only) and logs the action.
export const createWorkItem = createServerFn({ method: "POST" })
  .validator(
    z.object({
      category_id: z.string().uuid(),
      name: z.string().min(1),
      sort_order: z.number().int().default(0),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    if (!isAdmin(user.role)) return { success: false, error: "Admin only" };

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

    if (error || !item) return { success: false, error: "Failed to create work item" };
    await logAction(user, "create_work_item", "progress_work_item", item.id, {
      name: data.name,
      category_id: data.category_id,
    });
    return { success: true, data: item };
  });

// ---------------------------------------------------------------------------
// Cell Group creation — Admin only (generates N cells in one transaction)
// ---------------------------------------------------------------------------

// Creates a cell group and generates N cells in one transaction (admin only).
export const createCellGroup = createServerFn({ method: "POST" })
  .validator(
    z.object({
      block_id: z.string().uuid(),
      floor_id: z.string().uuid(),
      work_item_id: z.string().uuid(),
      cell_count: z.number().int().min(1).max(500),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    if (!isAdmin(user.role)) return { success: false, error: "Admin only" };

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

    if (error || !group) return { success: false, error: "Failed to create cell group" };

    // Generate cells
    const cells = Array.from({ length: data.cell_count }, (_, i) => ({
      cell_group_id: group.id,
      cell_number: i + 1,
    }));

    const { error: cellError } = await supabaseServer.from("progress_cells").insert(cells);

    if (cellError) return { success: false, error: "Failed to generate cells" };

    await logAction(user, "create_cell_group", "progress_cell_group", group.id, {
      block_id: data.block_id,
      floor_id: data.floor_id,
      work_item_id: data.work_item_id,
      cell_count: data.cell_count,
    });

    return { success: true, id: group.id };
  });

// ---------------------------------------------------------------------------
// Supervisor assignment — Admin only
// ---------------------------------------------------------------------------

// Assigns a supervisor to a block or specific floor (admin only) and logs the action.
export const assignSupervisor = createServerFn({ method: "POST" })
  .validator(
    z.object({
      supervisor_id: z.string().uuid(),
      block_id: z.string().uuid(),
      floor_id: z.string().uuid().nullable(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    if (!isAdmin(user.role)) return { success: false, error: "Admin only" };

    const { error } = await supabaseServer.from("progress_supervisor_assignments").insert({
      supervisor_id: data.supervisor_id,
      block_id: data.block_id,
      floor_id: data.floor_id,
    });

    if (error) return { success: false, error: error.message };

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

    return { success: true };
  });

// ---------------------------------------------------------------------------
// Fetch hierarchy — Admin & Supervisor
// ---------------------------------------------------------------------------

// Fetches the full progress hierarchy (blocks, floors, categories, work items) in parallel.
export const fetchHierarchy = createServerFn({ method: "GET" }).handler(async () => {
  await requireSessionUser();

  const [blocks, floors, categories, workItems] = await Promise.all([
    supabaseServer
      .from("progress_blocks")
      .select("id, name, sort_order, work_category")
      .order("sort_order"),
    supabaseServer
      .from("progress_floors")
      .select("id, block_id, name, sort_order")
      .order("sort_order"),
    supabaseServer.from("progress_categories").select("id, name, sort_order").order("sort_order"),
    supabaseServer
      .from("progress_work_items")
      .select("id, category_id, name, sort_order")
      .order("sort_order"),
  ]);

  return {
    blocks: blocks.data ?? [],
    floors: floors.data ?? [],
    categories: categories.data ?? [],
    workItems: workItems.data ?? [],
  };
});

// ---------------------------------------------------------------------------
// Fetch supervisors (for assignment dropdowns)
// ---------------------------------------------------------------------------

// Fetches the list of supervisor users for assignment dropdowns (admin only).
export const fetchSupervisors = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireSessionUser();
  if (!isAdmin(user.role)) return { data: [] };

  const { data: supervisors } = await supabaseServer
    .from("users")
    .select("id, name")
    .eq("role", "Supervisor")
    .order("name");

  return { data: supervisors ?? [] };
});

// ---------------------------------------------------------------------------
// Fetch my cells — Supervisor only (cells they can edit)
// ---------------------------------------------------------------------------

// Fetches the cells a supervisor is assigned to, with hierarchy names and optional status filter.
export const fetchMyCells = createServerFn({ method: "GET" })
  .validator((input: { status?: string } | undefined) => input ?? {})
  .handler(async ({ data }) => {
    const user = await requireSessionUser();

    // Get supervisor's block assignments
    const { data: assignments } = await supabaseServer
      .from("progress_supervisor_assignments")
      .select("block_id, floor_id")
      .eq("supervisor_id", user.id);

    if (!assignments || assignments.length === 0) return { data: [] };

    // Build block IDs and block→floor mapping
    const blockIds = [...new Set(assignments.map((a: any) => a.block_id))];
    const blockFloorMap = new Map<string, (string | null)[]>();
    for (const a of assignments) {
      const existing = blockFloorMap.get(a.block_id) ?? [];
      existing.push(a.floor_id);
      blockFloorMap.set(a.block_id, existing);
    }

    // Fetch cell groups for these blocks
    const { data: groups } = await supabaseServer
      .from("progress_cell_groups")
      .select("id, block_id, floor_id, work_item_id")
      .in("block_id", blockIds);

    if (!groups || groups.length === 0) return { data: [] };

    // Filter groups by floor assignment
    const validGroupIds: string[] = [];
    for (const g of groups) {
      const floors = blockFloorMap.get(g.block_id) ?? [];
      if (floors.includes(null)) {
        validGroupIds.push(g.id); // whole block
      } else if (floors.includes(g.floor_id)) {
        validGroupIds.push(g.id); // specific floor
      }
    }

    if (validGroupIds.length === 0) return { data: [] };

    // Fetch work item names
    const workItemIds = [...new Set(groups.map((g: any) => g.work_item_id))];
    const [{ data: workItems }, { data: cats }] = await Promise.all([
      supabaseServer
        .from("progress_work_items")
        .select("id, name, category_id")
        .in("id", workItemIds),
      supabaseServer.from("progress_categories").select("id, name"),
    ]);
    const wiMap = new Map((workItems ?? []).map((w: any) => [w.id, w]));
    const catMap = new Map((cats ?? []).map((c: any) => [c.id, c.name]));

    // Fetch block/floor names
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

    // Fetch cells
    let cellQuery = supabaseServer
      .from("progress_cells")
      .select(
        "id, cell_group_id, cell_number, status, completion_pct, remarks, updated_by, updated_at",
      )
      .in("cell_group_id", validGroupIds)
      .order("cell_number");

    if (data?.status) cellQuery = cellQuery.eq("status", data.status);

    const { data: cells } = await cellQuery;

    const result: ProgressCell[] = (cells ?? []).map((c: any) => {
      const g = groupMap.get(c.cell_group_id);
      const wi = g ? wiMap.get(g.work_item_id) : null;
      return {
        id: c.id,
        cell_group_id: c.cell_group_id,
        cell_number: c.cell_number,
        status: c.status,
        completion_pct: Number(c.completion_pct),
        remarks: c.remarks,
        assigned_supervisor_id: null,
        updated_by: c.updated_by,
        updated_at: c.updated_at,
        block_name: g ? (blockMap.get(g.block_id) ?? "") : "",
        floor_name: g ? (floorMap.get(g.floor_id) ?? "") : "",
        work_item_name: wi?.name ?? "",
        category_name: wi ? (catMap.get(wi.category_id) ?? "") : "",
      };
    });

    return { data: result };
  });

// ---------------------------------------------------------------------------
// Update cell — Supervisor (own cells) or Admin (any cell)
// ---------------------------------------------------------------------------

// Updates a cell's status/completion, recording a history entry and audit log (assigned supervisor or admin).
export const updateCell = createServerFn({ method: "POST" })
  .validator(
    z.object({
      cell_id: z.string().uuid(),
      status: z.enum(["not_started", "in_progress", "completed", "on_hold"]),
      completion_pct: z.number().min(0).max(100),
      remarks: z.string().nullable(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireSessionUser();

    const canEdit = await canSupervisorEditCell(user, data.cell_id);
    if (!canEdit) return { success: false, error: "You are not assigned to this cell" };

    // Fetch current state for history
    const { data: cell } = await supabaseServer
      .from("progress_cells")
      .select("id, status, completion_pct, remarks")
      .eq("id", data.cell_id)
      .single();

    if (!cell) return { success: false, error: "Cell not found" };

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

    if (error) return { success: false, error: "Failed to update cell" };

    // Insert history row
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

    return { success: true };
  });

// ---------------------------------------------------------------------------
// Upload cell photo — Supervisor (own cells) or Admin
// ---------------------------------------------------------------------------

// Uploads a proof photo for a cell to Supabase storage and records it in the database.
export const uploadCellPhoto = createServerFn({ method: "POST" })
  .validator(
    z.object({
      cell_id: z.string().uuid(),
      contentType: z.string(),
      fileData: z.string(),
      caption: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireSessionUser();

    const canEdit = await canSupervisorEditCell(user, data.cell_id);
    if (!canEdit) return { success: false, error: "You are not assigned to this cell" };

    const PHOTO_MIMES = ["image/jpeg", "image/png", "image/webp"];
    if (!PHOTO_MIMES.includes(data.contentType)) {
      return { success: false, error: "File type not allowed" };
    }

    const buffer = Buffer.from(data.fileData, "base64");
    if (buffer.length > 5 * 1024 * 1024) {
      return { success: false, error: "File exceeds 5MB limit" };
    }

    const timestamp = Date.now();
    const ext = data.contentType.split("/")[1] ?? "jpg";
    const path = `progress/${data.cell_id}/${timestamp}.${ext}`;

    const { error: uploadError } = await supabaseServer.storage
      .from("photos")
      .upload(path, buffer, { contentType: data.contentType, upsert: false });

    if (uploadError) return { success: false, error: `Upload failed: ${uploadError.message}` };

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

    if (dbError || !photo) return { success: false, error: "Failed to save photo record" };

    await logAction(user, "upload_cell_photo", "progress_cell_photo", photo.id, {
      cell_id: data.cell_id,
      path,
    });

    return { success: true, data: photo };
  });

// ---------------------------------------------------------------------------
// Fetch cell history — Admin, or Supervisor for their own cell
// ---------------------------------------------------------------------------

// Fetches the change history and photos for a cell (admin or assigned supervisor).
export const fetchCellHistory = createServerFn({ method: "GET" })
  .validator((input: { cell_id: string }) => input)
  .handler(async ({ data }) => {
    const user = await requireSessionUser();

    if (!isAdmin(user.role)) {
      const canView = await canSupervisorEditCell(user, data.cell_id);
      if (!canView) return { history: [], photos: [] };
    }

    const [histResult, photosResult] = await Promise.all([
      supabaseServer
        .from("progress_cell_history")
        .select(
          "id, cell_id, changed_by, previous_status, new_status, previous_pct, new_pct, remarks, created_at",
        )
        .eq("cell_id", data.cell_id)
        .order("created_at", { ascending: false }),
      supabaseServer
        .from("progress_cell_photos")
        .select("id, cell_id, storage_path, caption, uploaded_by, uploaded_at")
        .eq("cell_id", data.cell_id)
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

    const history: ProgressCellHistoryEntry[] = (histResult.data ?? []).map((h: any) => ({
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

    return { history, photos: photosResult.data ?? [] };
  });

// ---------------------------------------------------------------------------
// Fetch progress dashboard — Admin only (aggregated roll-up)
// ---------------------------------------------------------------------------

// Fetches an aggregated progress dashboard with block roll-ups and a flat cell list (admin only).
export const fetchProgressDashboard = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireSessionUser();
  if (!isAdmin(user.role)) return { blocks: [], cells: [] };

  // Fetch all cell groups with block/floor/work item names
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
        progress_work_items!inner(name, category_id, progress_categories!inner(name))
      `,
    )
    .order("id");

  if (!groups || groups.length === 0) return { blocks: [], cells: [] };

  const groupIds = groups.map((g: any) => g.id);

  // Fetch all cells
  const { data: cells } = await supabaseServer
    .from("progress_cells")
    .select("id, cell_group_id, cell_number, status, completion_pct, updated_at")
    .in("cell_group_id", groupIds)
    .order("cell_number");

  const groupMap = new Map(groups.map((g: any) => [g.id, g]));

  // Build block roll-up
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

  // Finalize averages
  const blocks = Array.from(blockAgg.values()).map((b) => ({
    ...b,
    avgPct: b.count > 0 ? Math.round(b.avgPct / b.count) : 0,
  }));

  // Build flat cell list with names for drill-down
  const flatCells = (cells ?? []).map((c: any) => {
    const g = groupMap.get(c.cell_group_id);
    return {
      id: c.id,
      cell_group_id: c.cell_group_id,
      cell_number: c.cell_number,
      status: c.status,
      completion_pct: Number(c.completion_pct),
      updated_at: c.updated_at,
      block_name: g?.progress_blocks?.name ?? "",
      floor_name: g?.progress_floors?.name ?? "",
      work_item_name: g?.progress_work_items?.name ?? "",
      category_name: g?.progress_work_items?.progress_categories?.name ?? "",
    };
  });

  return { blocks, cells: flatCells };
});
