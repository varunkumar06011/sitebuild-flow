import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { supabaseServer } from "../lib/supabase-server.js";
import { requireSessionUser } from "../lib/session.js";

export const digitalTwinRouter = Router();

// GET /api/digital-twin/overlay — fetches block layout with progress overlay data.
digitalTwinRouter.get("/overlay", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);

    // Fetch all progress blocks
    const { data: blocks } = await supabaseServer
      .from("progress_blocks")
      .select("id, name, sort_order")
      .order("sort_order", { ascending: true });

    if (!blocks || blocks.length === 0) {
      res.json({ data: [] });
      return;
    }

    // Fetch layout positions
    const blockIds = blocks.map((b: any) => b.id);
    const { data: layouts } = await supabaseServer
      .from("block_layout")
      .select("block_id, x_position, y_position, width, height, color_override")
      .in("block_id", blockIds);

    const layoutMap = new Map((layouts ?? []).map((l: any) => [l.block_id, l]));

    // Fetch cell groups for progress aggregation
    const { data: groups } = await supabaseServer
      .from("progress_cell_groups")
      .select("id, block_id, cell_count")
      .in("block_id", blockIds);

    const groupIds = (groups ?? []).map((g: any) => g.id);
    const groupByBlock = new Map<string, string[]>();
    for (const g of groups ?? []) {
      const arr = groupByBlock.get(g.block_id) ?? [];
      arr.push(g.id);
      groupByBlock.set(g.block_id, arr);
    }

    // Fetch all cells
    const { data: cells } = await supabaseServer
      .from("progress_cells")
      .select("id, cell_group_id, status, completion_pct")
      .in(
        "cell_group_id",
        groupIds.length > 0 ? groupIds : ["00000000-0000-0000-0000-000000000000"],
      );

    // Build cell group → block map
    const cellGroupToBlock = new Map<string, string>();
    for (const g of groups ?? []) {
      cellGroupToBlock.set(g.id, g.block_id);
    }

    // Aggregate per block
    const blockStats = new Map<
      string,
      {
        total: number;
        completed: number;
        inProgress: number;
        notStarted: number;
        onHold: number;
        avgPct: number;
      }
    >();

    for (const c of cells ?? []) {
      const blockId = cellGroupToBlock.get(c.cell_group_id);
      if (!blockId) continue;

      if (!blockStats.has(blockId)) {
        blockStats.set(blockId, {
          total: 0,
          completed: 0,
          inProgress: 0,
          notStarted: 0,
          onHold: 0,
          avgPct: 0,
        });
      }
      const stats = blockStats.get(blockId)!;
      stats.total++;
      stats.avgPct += Number(c.completion_pct);
      if (c.status === "completed") stats.completed++;
      else if (c.status === "in_progress") stats.inProgress++;
      else if (c.status === "not_started") stats.notStarted++;
      else if (c.status === "on_hold") stats.onHold++;
    }

    // Auto-assign grid positions if no layout exists
    const result = blocks.map((b: any, idx: number) => {
      const layout = layoutMap.get(b.id);
      const stats = blockStats.get(b.id);
      const avgPct = stats && stats.total > 0 ? Math.round(stats.avgPct / stats.total) : 0;

      // Auto-assign position in a 4-column grid if no layout
      const autoX = idx % 4;
      const autoY = Math.floor(idx / 4);

      return {
        id: b.id,
        name: b.name,
        sort_order: b.sort_order,
        x: layout?.x_position ?? autoX,
        y: layout?.y_position ?? autoY,
        width: layout?.width ?? 1,
        height: layout?.height ?? 1,
        color_override: layout?.color_override ?? null,
        completion_pct: avgPct,
        total_cells: stats?.total ?? 0,
        completed_cells: stats?.completed ?? 0,
        in_progress_cells: stats?.inProgress ?? 0,
        not_started_cells: stats?.notStarted ?? 0,
        on_hold_cells: stats?.onHold ?? 0,
      };
    });

    res.json({ data: result });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("fetchBlockOverlay error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch block overlay" });
  }
});

// GET /api/digital-twin/detail — fetches detailed progress for a single block (for drill-down).
const fetchBlockDetailSchema = z.object({
  block_id: z.string().uuid(),
});

digitalTwinRouter.get("/detail", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const data = fetchBlockDetailSchema.parse(req.query);

    // Fetch cell groups for this block
    const { data: groups } = await supabaseServer
      .from("progress_cell_groups")
      .select(
        `
        id,
        cell_count,
        progress_floors!inner(name),
        progress_work_items!inner(name, progress_categories!inner(name))
      `,
      )
      .eq("block_id", data.block_id)
      .order("id");

    if (!groups || groups.length === 0) {
      res.json({ data: { floors: [], work_items: [] } });
      return;
    }

    const groupIds = groups.map((g: any) => g.id);
    const { data: cells } = await supabaseServer
      .from("progress_cells")
      .select("id, cell_group_id, cell_number, status, completion_pct, updated_at")
      .in("cell_group_id", groupIds)
      .order("cell_number");

    const groupMap = new Map(groups.map((g: any) => [g.id, g]));

    // Aggregate by floor
    const floorAgg = new Map<
      string,
      { name: string; total: number; completed: number; avgPct: number }
    >();

    // Aggregate by work item
    const workItemAgg = new Map<
      string,
      { name: string; category: string; total: number; completed: number; avgPct: number }
    >();

    for (const c of cells ?? []) {
      const g = groupMap.get(c.cell_group_id);
      if (!g) continue;

      const floorName = g.progress_floors?.name ?? "Unknown";
      const workItemName = g.progress_work_items?.name ?? "Unknown";
      const categoryName = g.progress_work_items?.progress_categories?.name ?? "Unknown";

      // Floor aggregation
      if (!floorAgg.has(floorName)) {
        floorAgg.set(floorName, { name: floorName, total: 0, completed: 0, avgPct: 0 });
      }
      const fAgg = floorAgg.get(floorName)!;
      fAgg.total++;
      fAgg.avgPct += Number(c.completion_pct);
      if (c.status === "completed") fAgg.completed++;

      // Work item aggregation
      if (!workItemAgg.has(workItemName)) {
        workItemAgg.set(workItemName, {
          name: workItemName,
          category: categoryName,
          total: 0,
          completed: 0,
          avgPct: 0,
        });
      }
      const wAgg = workItemAgg.get(workItemName)!;
      wAgg.total++;
      wAgg.avgPct += Number(c.completion_pct);
      if (c.status === "completed") wAgg.completed++;
    }

    const floors = Array.from(floorAgg.values()).map((f) => ({
      ...f,
      avgPct: f.total > 0 ? Math.round(f.avgPct / f.total) : 0,
    }));

    const workItems = Array.from(workItemAgg.values()).map((w) => ({
      ...w,
      avgPct: w.total > 0 ? Math.round(w.avgPct / w.total) : 0,
    }));

    res.json({
      data: {
        floors,
        work_items: workItems,
        cells: (cells ?? []).map((c: any) => {
          const g = groupMap.get(c.cell_group_id);
          return {
            id: c.id,
            cell_number: c.cell_number,
            status: c.status,
            completion_pct: Number(c.completion_pct),
            floor: g?.progress_floors?.name ?? "",
            work_item: g?.progress_work_items?.name ?? "",
            category: g?.progress_work_items?.progress_categories?.name ?? "",
            updated_at: c.updated_at,
          };
        }),
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("fetchBlockDetail error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch block detail" });
  }
});

// POST /api/digital-twin/layout — updates block layout position (admin only).
const updateLayoutSchema = z.object({
  block_id: z.string().uuid(),
  x_position: z.number().int().min(0),
  y_position: z.number().int().min(0),
  width: z.number().int().min(1).max(4).optional(),
  height: z.number().int().min(1).max(4).optional(),
});

digitalTwinRouter.post("/layout", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (user.role === "Supervisor") {
      res.json({ success: false, error: "Only administrators can update block layout" });
      return;
    }

    const data = updateLayoutSchema.parse(req.body);

    const { error } = await supabaseServer.from("block_layout").upsert(
      {
        block_id: data.block_id,
        x_position: data.x_position,
        y_position: data.y_position,
        width: data.width ?? 1,
        height: data.height ?? 1,
      },
      { onConflict: "block_id" },
    );

    if (error) {
      res.json({ success: false, error: "Failed to update layout" });
      return;
    }
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
    console.error("updateBlockLayout error:", err);
    res.status(500).json({ success: false, error: "Failed to update block layout" });
  }
});
