import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseServer } from "../supabase-server";
import { requireSessionUser } from "./session";
import { logAction } from "./audit";
import type { Role } from "../erp-data";

// Roles permitted to manage inventory categories and items.
const ADMIN_ROLES: Role[] = ["Administrator", "A1", "A1+"];
// Returns true if the given role has admin-level inventory permissions.
function isAdmin(role: Role): boolean {
  return ADMIN_ROLES.includes(role);
}

// ---------------------------------------------------------------------------
// Category tree
// ---------------------------------------------------------------------------

// Fetches the full inventory category tree ordered by sort order.
export const fetchCategoryTree = createServerFn({ method: "GET" })
  .validator((input: Record<string, never>) => input)
  .handler(async ({ data, context }) => {
    await requireSessionUser();

    const { data: nodes } = await supabaseServer
      .from("inventory_categories")
      .select("id, name, level, parent_id, sort_order, created_at")
      .order("sort_order", { ascending: true });

    return { data: nodes ?? [] };
  });

// Zod schema validating a new category node (name, level, parent, sort order).
const categorySchema = z.object({
  name: z.string().min(1),
  level: z.enum(["category", "type", "subcategory", "subtype"]),
  parent_id: z.string().uuid().nullable(),
  sort_order: z.number().optional(),
});

// Creates a new inventory category node (admin only) and logs the action.
export const createCategoryNode = createServerFn({ method: "POST" })
  .validator(categorySchema)
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();
    if (!isAdmin(user.role)) {
      return { success: false, error: "Only administrators can manage categories" };
    }

    const { data: node, error } = await supabaseServer
      .from("inventory_categories")
      .insert({
        name: data.name.trim(),
        level: data.level,
        parent_id: data.parent_id,
        sort_order: data.sort_order ?? 0,
        created_by: user.id,
      })
      .select("id, name, level, parent_id, sort_order")
      .single();

    if (error || !node) {
      console.error(
        "[createCategoryNode] Insert failed:",
        error?.message,
        error?.code,
        error?.details,
      );
      const msg =
        error?.code === "23505"
          ? "A category with this name already exists at this level"
          : error?.code === "23503"
            ? "Foreign key violation ΓÇö parent or user not found"
            : `Failed to create category: ${error?.message ?? "Unknown error"}`;
      return { success: false, error: msg };
    }

    await logAction(user, "create_inventory_category", "inventory_category", node.id, {
      name: node.name,
      level: node.level,
      parent_id: node.parent_id,
    });
    return { success: true, node };
  });

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

// Fetches inventory items with current stock and resolved category paths, optional name search.
export const fetchItems = createServerFn({ method: "GET" })
  .validator(
    (input: {
      search?: string;
      workCategory?: string;
      category_id?: string;
      includeArchived?: boolean;
      page?: number;
      pageSize?: number;
    }) => input,
  )
  .handler(async ({ data, context }) => {
    await requireSessionUser();

    const page = data.page ?? 1;
    const pageSize = data.pageSize ?? 50;
    const offset = (page - 1) * pageSize;

    let query = supabaseServer
      .from("inventory_stock_levels")
      .select(
        "item_id, item_name, unit_of_measure, reorder_level, reorder_qty, unit_cost, supplier_id, default_warehouse_id, opening_stock, category_id, current_stock, stock_value, archived",
        { count: "exact" },
      )
      .order("item_name", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (!data.includeArchived) {
      query = query.eq("archived", false);
    }
    if (data.search) {
      query = query.ilike("item_name", `%${data.search}%`);
    }
    if (data.category_id) {
      query = query.eq("category_id", data.category_id);
    }

    // Work category filter — join inventory_items to filter by work_category
    let itemIds: string[] | null = null;
    if (data.workCategory && data.workCategory !== "all") {
      const { data: filteredItems } = await supabaseServer
        .from("inventory_items")
        .select("id")
        .eq("work_category", data.workCategory);
      itemIds = (filteredItems ?? []).map((i: any) => i.id);
      if (itemIds.length === 0) {
        return { data: [], total: 0, page, pageSize, totalPages: 0 };
      }
      query = query.in("item_id", itemIds);
    }

    const { data: items, count } = await query;

    // Resolve category paths
    const categoryIds = [...new Set((items ?? []).map((i: any) => i.category_id))];
    const { data: cats } = await supabaseServer
      .from("inventory_categories")
      .select("id, name, parent_id")
      .in("id", categoryIds);

    const catMap = new Map((cats ?? []).map((c: any) => [c.id, c]));

    // Build path for each category by walking up parent_id
    function buildPath(catId: string): string {
      const parts: string[] = [];
      let current = catMap.get(catId);
      const visited = new Set<string>();
      while (current && !visited.has(current.id)) {
        visited.add(current.id);
        parts.unshift(current.name);
        current = current.parent_id ? catMap.get(current.parent_id) : undefined;
      }
      return parts.join(" ΓÇ║ ");
    }

    // Fetch work_category for each item
    const itemIdsForCat = (items ?? []).map((i: any) => i.item_id);
    const workCatMap = new Map<string, string>();
    if (itemIdsForCat.length > 0) {
      const { data: itemCats } = await supabaseServer
        .from("inventory_items")
        .select("id, work_category")
        .in("id", itemIdsForCat);
      for (const ic of itemCats ?? []) {
        workCatMap.set(ic.id, ic.work_category);
      }
    }

    return {
      data: (items ?? []).map((i: any) => ({
        ...i,
        work_category: workCatMap.get(i.item_id) ?? "uncategorized",
        category_path: buildPath(i.category_id),
      })),
      total: count ?? 0,
      page,
      pageSize,
      totalPages: Math.ceil((count ?? 0) / pageSize),
    };
  });

// Zod schema validating a new inventory item (category, name, unit, reorder level, opening stock).
const itemSchema = z.object({
  category_id: z.string().uuid(),
  name: z.string().min(1),
  unit_of_measure: z.string().optional(),
  reorder_level: z.number().min(0).optional(),
  reorder_qty: z.number().min(0).optional(),
  unit_cost: z.number().min(0).optional(),
  opening_stock: z.number().min(0).optional(),
  work_category: z.string().optional(),
  supplier_id: z.string().uuid().nullable().optional(),
  default_warehouse_id: z.string().uuid().nullable().optional(),
});

// Creates a new inventory item (admin only) and logs the action.
export const createItem = createServerFn({ method: "POST" })
  .validator(itemSchema)
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();
    if (!isAdmin(user.role)) {
      return { success: false, error: "Only administrators can create items" };
    }

    const { data: item, error } = await supabaseServer
      .from("inventory_items")
      .insert({
        category_id: data.category_id,
        name: data.name.trim(),
        unit_of_measure: data.unit_of_measure?.trim() || null,
        reorder_level: data.reorder_level ?? 0,
        reorder_qty: data.reorder_qty ?? 0,
        unit_cost: data.unit_cost ?? 0,
        opening_stock: data.opening_stock ?? 0,
        work_category: data.work_category ?? "uncategorized",
        supplier_id: data.supplier_id ?? null,
        default_warehouse_id: data.default_warehouse_id ?? null,
        created_by: user.id,
      })
      .select("id, name")
      .single();

    if (error || !item) {
      return { success: false, error: "Failed to create item" };
    }

    await logAction(user, "create_inventory_item", "inventory_item", item.id, {
      name: item.name,
      category_id: data.category_id,
    });
    return { success: true, id: item.id };
  });

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

// Zod schema validating an inventory transaction (in/out/adjustment/transfer with quantity and reference).
const txSchema = z.object({
  item_id: z.string().uuid(),
  type: z.enum(["in", "out", "adjustment", "transfer"]),
  quantity: z.number().positive(),
  is_wastage: z.boolean().optional(),
  block_id: z.string().uuid().nullable().optional(),
  reference: z.string().optional(),
  remarks: z.string().optional(),
  adjustment_direction: z.enum(["up", "down"]).optional(),
  warehouse_id: z.string().uuid().nullable().optional(),
  transfer_from_block_id: z.string().uuid().nullable().optional(),
  transfer_to_block_id: z.string().uuid().nullable().optional(),
  unit_cost: z.number().min(0).optional(),
  linked_requisition_id: z.string().uuid().nullable().optional(),
  linked_gate_pass_id: z.string().uuid().nullable().optional(),
  linked_batch_id: z.string().uuid().nullable().optional(),
});

// Records an inventory stock transaction (in/out/adjustment) and logs the action.
// Adjustment type is restricted to admin roles; is_wastage is only valid on 'out' transactions.
export const recordTransaction = createServerFn({ method: "POST" })
  .validator(txSchema)
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();

    // A3: Restrict adjustment type to admin roles only.
    if (data.type === "adjustment" && !isAdmin(user.role)) {
      return {
        success: false,
        error: "Only administrators can submit stock adjustments. Please contact an admin.",
      };
    }

    // B1: Reject is_wastage on non-'out' transactions.
    if (data.is_wastage && data.type !== "out") {
      return {
        success: false,
        error: "Wastage flag can only be set on 'out' transactions.",
      };
    }

    // Stock-out validation: check current stock before allowing "out", "transfer", or downward "adjustment"
    if (
      data.type === "out" ||
      data.type === "transfer" ||
      (data.type === "adjustment" && data.adjustment_direction === "down")
    ) {
      const { data: stockRow } = await supabaseServer
        .from("inventory_stock_levels")
        .select("current_stock")
        .eq("item_id", data.item_id)
        .single();
      const currentStock = Number(stockRow?.current_stock ?? 0);
      if (currentStock < data.quantity) {
        return {
          success: false,
          error: `Insufficient stock. Current stock is ${currentStock}, attempted to remove ${data.quantity}.`,
        };
      }
    }

    // Transfer validation: both from and to blocks required
    if (data.type === "transfer" && (!data.transfer_from_block_id || !data.transfer_to_block_id)) {
      return { success: false, error: "Transfer requires both source and destination blocks" };
    }

    const { data: tx, error } = await supabaseServer
      .from("inventory_transactions")
      .insert({
        item_id: data.item_id,
        type: data.type,
        quantity: data.quantity,
        is_wastage: data.is_wastage ?? false,
        block_id: data.block_id ?? null,
        reference: data.reference?.trim() || null,
        remarks: data.remarks?.trim() || null,
        adjustment_direction: data.adjustment_direction ?? null,
        warehouse_id: data.warehouse_id ?? null,
        transfer_from_block_id: data.transfer_from_block_id ?? null,
        transfer_to_block_id: data.transfer_to_block_id ?? null,
        unit_cost: data.unit_cost ?? null,
        linked_requisition_id: data.linked_requisition_id ?? null,
        linked_gate_pass_id: data.linked_gate_pass_id ?? null,
        linked_batch_id: data.linked_batch_id ?? null,
        created_by: user.id,
      })
      .select("id")
      .single();

    if (error || !tx) {
      return { success: false, error: "Failed to record transaction" };
    }

    await logAction(user, "record_inventory_transaction", "inventory_transaction", tx.id, {
      item_id: data.item_id,
      type: data.type,
      quantity: data.quantity,
      is_wastage: data.is_wastage ?? false,
    });
    return { success: true, id: tx.id };
  });

// ---------------------------------------------------------------------------
// Stock levels & low-stock alerts (any authenticated role)
// ---------------------------------------------------------------------------

// Fetches current stock levels for all items with resolved category paths (any authenticated role).
export const fetchStockLevels = createServerFn({ method: "GET" })
  .validator((input: Record<string, never>) => input)
  .handler(async ({ data, context }) => {
    await requireSessionUser();

    const { data: items } = await supabaseServer
      .from("inventory_stock_levels")
      .select(
        "item_id, item_name, unit_of_measure, reorder_level, reorder_qty, unit_cost, supplier_id, default_warehouse_id, opening_stock, category_id, current_stock, stock_value, archived",
      )
      .eq("archived", false)
      .order("item_name", { ascending: true });

    // Resolve category names
    const categoryIds = [...new Set((items ?? []).map((i: any) => i.category_id))];
    const { data: cats } = await supabaseServer
      .from("inventory_categories")
      .select("id, name, parent_id")
      .in("id", categoryIds);

    const catMap = new Map((cats ?? []).map((c: any) => [c.id, c]));

    function buildPath(catId: string): string {
      const parts: string[] = [];
      let current = catMap.get(catId);
      const visited = new Set<string>();
      while (current && !visited.has(current.id)) {
        visited.add(current.id);
        parts.unshift(current.name);
        current = current.parent_id ? catMap.get(current.parent_id) : undefined;
      }
      return parts.join(" ΓÇ║ ");
    }

    return {
      data: (items ?? []).map((i: any) => ({
        ...i,
        category_path: buildPath(i.category_id),
      })),
    };
  });

// Fetches items whose current stock has fallen to or below their reorder level (any authenticated role).
export const fetchLowStockAlerts = createServerFn({ method: "GET" })
  .validator((input: Record<string, never>) => input)
  .handler(async ({ data, context }) => {
    await requireSessionUser();

    const { data: items } = await supabaseServer
      .from("inventory_stock_levels")
      .select("item_id, item_name, unit_of_measure, reorder_level, current_stock")
      .eq("archived", false)
      .gt("reorder_level", 0)
      .order("item_name", { ascending: true });

    const lowStock = (items ?? []).filter(
      (i: any) => Number(i.current_stock) <= Number(i.reorder_level),
    );

    return { data: lowStock };
  });

// ---------------------------------------------------------------------------
// Item ledger (full transaction history for one item)
// ---------------------------------------------------------------------------

// Fetches the full transaction ledger for a single item with user and block names joined (any authenticated role).
export const fetchItemLedger = createServerFn({ method: "GET" })
  .validator(
    (input: {
      itemId: string;
      fromDate?: string;
      toDate?: string;
      page?: number;
      pageSize?: number;
    }) => input,
  )
  .handler(async ({ data, context }) => {
    await requireSessionUser();

    const page = data.page ?? 1;
    const pageSize = data.pageSize ?? 50;
    const offset = (page - 1) * pageSize;

    let query = supabaseServer
      .from("inventory_transactions")
      .select(
        "id, item_id, type, quantity, is_wastage, adjustment_direction, block_id, warehouse_id, transfer_from_block_id, transfer_to_block_id, unit_cost, reference, remarks, linked_requisition_id, linked_gate_pass_id, linked_batch_id, reversed, is_reversal, reverses_tx_id, created_by, created_at",
        { count: "exact" },
      )
      .eq("item_id", data.itemId)
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (data.fromDate) query = query.gte("created_at", data.fromDate);
    if (data.toDate) query = query.lte("created_at", data.toDate);

    const { data: txns, count } = await query;

    // Resolve user names
    const userIds = [...new Set((txns ?? []).map((t: any) => t.created_by))];
    const { data: users } = await supabaseServer
      .from("users")
      .select("id, name, role")
      .in("id", userIds);
    const userMap = new Map((users ?? []).map((u: any) => [u.id, u]));

    // Resolve block names (including transfer from/to)
    const blockIds = [
      ...new Set(
        (txns ?? [])
          .flatMap((t: any) => [t.block_id, t.transfer_from_block_id, t.transfer_to_block_id])
          .filter(Boolean),
      ),
    ];
    let blockMap = new Map<string, string>();
    if (blockIds.length > 0) {
      const { data: blocks } = await supabaseServer
        .from("progress_blocks")
        .select("id, name")
        .in("id", blockIds);
      blockMap = new Map((blocks ?? []).map((b: any) => [b.id, b.name]));
    }

    // Resolve linked requisition PR numbers
    const reqIds = [
      ...new Set(
        (txns ?? [])
          .filter((t: any) => t.linked_requisition_id)
          .map((t: any) => t.linked_requisition_id),
      ),
    ];
    let reqMap = new Map<string, string>();
    if (reqIds.length > 0) {
      const { data: reqs } = await supabaseServer
        .from("requisitions")
        .select("id, pr_number")
        .in("id", reqIds);
      reqMap = new Map((reqs ?? []).map((r: any) => [r.id, r.pr_number]));
    }

    // Resolve linked gate pass numbers
    const gpIds = [
      ...new Set(
        (txns ?? [])
          .filter((t: any) => t.linked_gate_pass_id)
          .map((t: any) => t.linked_gate_pass_id),
      ),
    ];
    let gpMap = new Map<string, string>();
    if (gpIds.length > 0) {
      const { data: gps } = await supabaseServer
        .from("gate_passes")
        .select("id, gp_number")
        .in("id", gpIds);
      gpMap = new Map((gps ?? []).map((g: any) => [g.id, g.gp_number]));
    }

    // Resolve linked batch numbers
    const batchIds = [
      ...new Set(
        (txns ?? []).filter((t: any) => t.linked_batch_id).map((t: any) => t.linked_batch_id),
      ),
    ];
    let batchMap = new Map<string, string>();
    if (batchIds.length > 0) {
      const { data: batches } = await supabaseServer
        .from("batches")
        .select("id, batch_number")
        .in("id", batchIds);
      batchMap = new Map((batches ?? []).map((b: any) => [b.id, b.batch_number]));
    }

    return {
      data: (txns ?? []).map((t: any) => ({
        ...t,
        created_by_name: userMap.get(t.created_by)?.name ?? "Unknown",
        block_name: t.block_id ? (blockMap.get(t.block_id) ?? "—") : "—",
        transfer_from_block_name: t.transfer_from_block_id
          ? (blockMap.get(t.transfer_from_block_id) ?? "—")
          : null,
        transfer_to_block_name: t.transfer_to_block_id
          ? (blockMap.get(t.transfer_to_block_id) ?? "—")
          : null,
        linked_requisition_number: t.linked_requisition_id
          ? (reqMap.get(t.linked_requisition_id) ?? "—")
          : null,
        linked_gate_pass_number: t.linked_gate_pass_id
          ? (gpMap.get(t.linked_gate_pass_id) ?? "—")
          : null,
        linked_batch_number: t.linked_batch_id ? (batchMap.get(t.linked_batch_id) ?? "—") : null,
      })),
      total: count ?? 0,
      page,
      pageSize,
      totalPages: Math.ceil((count ?? 0) / pageSize),
    };
  });

// ---------------------------------------------------------------------------
// Blocks (for the optional block_id dropdown in transaction form)
// ---------------------------------------------------------------------------

// Fetches the list of construction blocks for the transaction form's block dropdown.
export const fetchBlocks = createServerFn({ method: "GET" })
  .validator((input: Record<string, never>) => input)
  .handler(async ({ data, context }) => {
    await requireSessionUser();

    const { data: blocks } = await supabaseServer
      .from("progress_blocks")
      .select("id, name, work_category")
      .order("sort_order", { ascending: true });

    return { data: blocks ?? [] };
  });

// ---------------------------------------------------------------------------
// A2: Inventory alerts (persistent low-stock alerts with resolve workflow)
// ---------------------------------------------------------------------------

// Fetches open inventory alerts with item names joined (any authenticated role).
export const fetchInventoryAlerts = createServerFn({ method: "GET" })
  .validator((input: { resolved?: boolean }) => input)
  .handler(async ({ data, context }) => {
    await requireSessionUser();

    let query = supabaseServer
      .from("inventory_alerts")
      .select(
        "id, item_id, stock_at_alert, reorder_level_at_alert, is_resolved, resolved_by, resolved_at, created_at",
      )
      .order("created_at", { ascending: false });

    if (data.resolved !== undefined) {
      query = query.eq("is_resolved", data.resolved);
    }

    const { data: alerts } = await query;

    const itemIds = [...new Set((alerts ?? []).map((a: any) => a.item_id))];
    let itemMap = new Map<string, string>();
    if (itemIds.length > 0) {
      const { data: items } = await supabaseServer
        .from("inventory_items")
        .select("id, name")
        .in("id", itemIds);
      itemMap = new Map((items ?? []).map((i: any) => [i.id, i.name]));
    }

    return {
      data: (alerts ?? []).map((a: any) => ({
        ...a,
        item_name: itemMap.get(a.item_id) ?? "Unknown",
      })),
    };
  });

// Resolves (closes) an inventory alert ΓÇö admin only.
export const resolveInventoryAlert = createServerFn({ method: "POST" })
  .validator(z.object({ alertId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();
    if (!isAdmin(user.role)) {
      return { success: false, error: "Only administrators can resolve alerts" };
    }

    const { error } = await supabaseServer
      .from("inventory_alerts")
      .update({
        is_resolved: true,
        resolved_by: user.id,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", data.alertId)
      .eq("is_resolved", false);

    if (error) {
      return { success: false, error: "Failed to resolve alert" };
    }

    await logAction(user, "resolve_inventory_alert", "inventory_alert", data.alertId, {});
    return { success: true };
  });

// ---------------------------------------------------------------------------
// B1: Wastage report
// ---------------------------------------------------------------------------

// Fetches all wastage-flagged transactions in a date range with item and user names joined.
export const fetchWastageReport = createServerFn({ method: "GET" })
  .validator((input: { fromDate?: string | undefined; toDate?: string | undefined }) => input)
  .handler(async ({ data, context }) => {
    await requireSessionUser();

    let query = supabaseServer
      .from("inventory_transactions")
      .select("id, item_id, quantity, block_id, reference, remarks, created_by, created_at")
      .eq("is_wastage", true)
      .order("created_at", { ascending: false });

    if (data.fromDate) {
      query = query.gte("created_at", data.fromDate);
    }
    if (data.toDate) {
      query = query.lte("created_at", data.toDate);
    }

    const { data: txns } = await query;

    // Resolve item names
    const itemIds = [...new Set((txns ?? []).map((t: any) => t.item_id))];
    const { data: items } = await supabaseServer
      .from("inventory_items")
      .select("id, name, unit_of_measure")
      .in("id", itemIds);
    const itemMap = new Map((items ?? []).map((i: any) => [i.id, i]));

    // Resolve user names
    const userIds = [...new Set((txns ?? []).map((t: any) => t.created_by))];
    const { data: users } = await supabaseServer.from("users").select("id, name").in("id", userIds);
    const userMap = new Map((users ?? []).map((u: any) => [u.id, u.name]));

    // Resolve block names
    const blockIds = [
      ...new Set((txns ?? []).filter((t: any) => t.block_id).map((t: any) => t.block_id)),
    ];
    let blockMap = new Map<string, string>();
    if (blockIds.length > 0) {
      const { data: blocks } = await supabaseServer
        .from("progress_blocks")
        .select("id, name")
        .in("id", blockIds);
      blockMap = new Map((blocks ?? []).map((b: any) => [b.id, b.name]));
    }

    return {
      data: (txns ?? []).map((t: any) => ({
        ...t,
        item_name: itemMap.get(t.item_id)?.name ?? "Unknown",
        unit_of_measure: itemMap.get(t.item_id)?.unit_of_measure ?? null,
        created_by_name: userMap.get(t.created_by) ?? "Unknown",
        block_name: t.block_id ? (blockMap.get(t.block_id) ?? "ΓÇö") : "ΓÇö",
      })),
    };
  });

// ---------------------------------------------------------------------------
// B2: Stock usage projections
// ---------------------------------------------------------------------------

// Fetches stock projections: average daily usage (last 30 days) and estimated days remaining per item.
export const fetchStockProjections = createServerFn({ method: "GET" })
  .validator((input: Record<string, never>) => input)
  .handler(async ({ data, context }) => {
    await requireSessionUser();

    // Get current stock levels
    const { data: stockItems } = await supabaseServer
      .from("inventory_stock_levels")
      .select("item_id, item_name, unit_of_measure, reorder_level, current_stock")
      .order("item_name", { ascending: true });

    if (!stockItems || stockItems.length === 0) {
      return { data: [] };
    }

    // Get all 'out' transactions in the last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const { data: recentOutTxns } = await supabaseServer
      .from("inventory_transactions")
      .select("item_id, quantity")
      .eq("type", "out")
      .gte("created_at", thirtyDaysAgo.toISOString());

    // Sum usage per item
    const usageByItem = new Map<string, number>();
    for (const t of recentOutTxns ?? []) {
      usageByItem.set(t.item_id, (usageByItem.get(t.item_id) ?? 0) + Number(t.quantity));
    }

    const projections = (stockItems as any[]).map((i) => {
      const totalUsage = usageByItem.get(i.item_id) ?? 0;
      const avgDailyUsage = totalUsage / 30;
      const currentStock = Number(i.current_stock);
      const reorderLevel = Number(i.reorder_level);

      let daysRemaining: number | null = null;
      if (avgDailyUsage > 0) {
        daysRemaining = Math.floor((currentStock - reorderLevel) / avgDailyUsage);
      }

      return {
        item_id: i.item_id,
        item_name: i.item_name,
        unit_of_measure: i.unit_of_measure,
        current_stock: currentStock,
        reorder_level: reorderLevel,
        total_usage_30d: totalUsage,
        avg_daily_usage: Number(avgDailyUsage.toFixed(2)),
        days_remaining: daysRemaining,
      };
    });

    // Sort: items with days_remaining first (ascending), nulls last
    projections.sort((a, b) => {
      if (a.days_remaining === null && b.days_remaining === null) return 0;
      if (a.days_remaining === null) return 1;
      if (b.days_remaining === null) return -1;
      return a.days_remaining - b.days_remaining;
    });

    return { data: projections };
  });

// ---------------------------------------------------------------------------
// B3: Material budgets
// ---------------------------------------------------------------------------

// Zod schema for setting a budget on an item.
const budgetSchema = z.object({
  item_id: z.string().uuid(),
  budget_qty: z.number().min(0),
  budget_value: z.number().min(0).optional(),
  alert_threshold_pct: z.number().min(0).max(100).optional(),
});

// Sets or updates a budget for an item (admin only). One budget per item (unique constraint).
export const setItemBudget = createServerFn({ method: "POST" })
  .validator(budgetSchema)
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();
    if (!isAdmin(user.role)) {
      return { success: false, error: "Only administrators can set budgets" };
    }

    const { data: budget, error } = await supabaseServer
      .from("inventory_budgets")
      .upsert({
        item_id: data.item_id,
        budget_qty: data.budget_qty,
        budget_value: data.budget_value ?? 0,
        alert_threshold_pct: data.alert_threshold_pct ?? 80,
        updated_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error || !budget) {
      return { success: false, error: "Failed to set budget" };
    }

    await logAction(user, "set_item_budget", "inventory_budget", budget.id, {
      item_id: data.item_id,
      budget_qty: data.budget_qty,
      budget_value: data.budget_value ?? 0,
      alert_threshold_pct: data.alert_threshold_pct ?? 80,
    });
    return { success: true, id: budget.id };
  });

// Fetches all item budgets with item names and current usage joined.
export const fetchBudgets = createServerFn({ method: "GET" })
  .validator((input: Record<string, never>) => input)
  .handler(async ({ data, context }) => {
    await requireSessionUser();

    const { data: budgets } = await supabaseServer
      .from("inventory_budgets")
      .select("id, item_id, budget_qty, budget_value, alert_threshold_pct, updated_at")
      .order("updated_at", { ascending: false });

    const itemIds = [...new Set((budgets ?? []).map((b: any) => b.item_id))];
    let itemMap = new Map<string, any>();
    if (itemIds.length > 0) {
      const { data: items } = await supabaseServer
        .from("inventory_stock_levels")
        .select("item_id, item_name, unit_of_measure, current_stock")
        .in("item_id", itemIds);
      itemMap = new Map((items ?? []).map((i: any) => [i.item_id, i]));
    }

    // Get cumulative 'out' usage per item (all time)
    const usageMap = new Map<string, number>();
    if (itemIds.length > 0) {
      const { data: outTxns } = await supabaseServer
        .from("inventory_transactions")
        .select("item_id, quantity")
        .eq("type", "out")
        .in("item_id", itemIds);
      for (const t of outTxns ?? []) {
        usageMap.set(t.item_id, (usageMap.get(t.item_id) ?? 0) + Number(t.quantity));
      }
    }

    return {
      data: (budgets ?? []).map((b: any) => {
        const item = itemMap.get(b.item_id);
        const usage = usageMap.get(b.item_id) ?? 0;
        const threshold = Number(b.alert_threshold_pct);
        const usagePct = Number(b.budget_qty) > 0 ? (usage / Number(b.budget_qty)) * 100 : 0;
        return {
          ...b,
          item_name: item?.item_name ?? "Unknown",
          unit_of_measure: item?.unit_of_measure ?? null,
          current_stock: item?.current_stock ?? 0,
          total_usage: usage,
          usage_pct: Number(usagePct.toFixed(1)),
          is_over_threshold: usagePct >= threshold,
        };
      }),
    };
  });

// Fetches the budget for a single item (if set).
export const fetchItemBudget = createServerFn({ method: "GET" })
  .validator((input: { itemId: string }) => input)
  .handler(async ({ data, context }) => {
    await requireSessionUser();

    const { data: budget } = await supabaseServer
      .from("inventory_budgets")
      .select("id, item_id, budget_qty, budget_value, alert_threshold_pct, updated_at")
      .eq("item_id", data.itemId)
      .single();

    if (!budget) {
      return { data: null };
    }

    // Get cumulative 'out' usage for this item
    const { data: outTxns } = await supabaseServer
      .from("inventory_transactions")
      .select("quantity")
      .eq("item_id", data.itemId)
      .eq("type", "out");

    const totalUsage = (outTxns ?? []).reduce((sum, t: any) => sum + Number(t.quantity), 0);
    const threshold = Number(budget.alert_threshold_pct);
    const usagePct =
      Number(budget.budget_qty) > 0 ? (totalUsage / Number(budget.budget_qty)) * 100 : 0;

    return {
      data: {
        ...budget,
        total_usage: totalUsage,
        usage_pct: Number(usagePct.toFixed(1)),
        is_over_threshold: usagePct >= threshold,
      },
    };
  });

// ---------------------------------------------------------------------------
// B4: Instant consolidated report
// ---------------------------------------------------------------------------

// Fetches a consolidated inventory summary: item count, low-stock count, open alerts,
// wastage total (30 days), and total vendor outstanding (admin only).
export const fetchInstantInventoryReport = createServerFn({ method: "GET" })
  .validator((input: Record<string, never>) => input)
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();
    if (!isAdmin(user.role)) {
      return { data: null };
    }

    // Total item count
    const { count: itemCount } = await supabaseServer
      .from("inventory_items")
      .select("id", { count: "exact", head: true });

    // Items at/below reorder level
    const { data: stockItems } = await supabaseServer
      .from("inventory_stock_levels")
      .select("item_id, current_stock, reorder_level");
    const lowStockCount = (stockItems ?? []).filter(
      (i: any) => Number(i.current_stock) <= Number(i.reorder_level),
    ).length;

    // Open alerts count
    const { count: openAlertsCount } = await supabaseServer
      .from("inventory_alerts")
      .select("id", { count: "exact", head: true })
      .eq("is_resolved", false);

    // Wastage total in last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const { data: wastageTxns } = await supabaseServer
      .from("inventory_transactions")
      .select("quantity")
      .eq("is_wastage", true)
      .gte("created_at", thirtyDaysAgo.toISOString());
    const wastageTotal = (wastageTxns ?? []).reduce((sum, t: any) => sum + Number(t.quantity), 0);

    // Total vendor outstanding (read directly from existing column, not recomputed)
    const { data: vendors } = await supabaseServer.from("vendors").select("outstanding_amount");
    const totalVendorOutstanding = (vendors ?? []).reduce(
      (sum, v: any) => sum + Number(v.outstanding_amount),
      0,
    );

    return {
      data: {
        item_count: itemCount ?? 0,
        low_stock_count: lowStockCount,
        open_alerts_count: openAlertsCount ?? 0,
        wastage_total_30d: wastageTotal,
        total_vendor_outstanding: totalVendorOutstanding,
      },
    };
  });

// ---------------------------------------------------------------------------
// Linkage data (warehouses, requisitions, gate passes, batches for dropdowns)
// ---------------------------------------------------------------------------

// Fetches the list of inventory warehouses for the transaction form dropdown.
export const fetchWarehouses = createServerFn({ method: "GET" })
  .validator((input: Record<string, never>) => input)
  .handler(async ({ data, context }) => {
    await requireSessionUser();

    const { data: warehouses } = await supabaseServer
      .from("inventory_warehouses")
      .select("id, name, location")
      .order("name", { ascending: true });

    return { data: warehouses ?? [] };
  });

// Fetches requisitions (PR/PO) for linkage in the transaction form.
export const fetchRequisitionsForLinkage = createServerFn({ method: "GET" })
  .validator((input: Record<string, never>) => input)
  .handler(async ({ data, context }) => {
    await requireSessionUser();

    const { data: reqs } = await supabaseServer
      .from("requisitions")
      .select("id, pr_number, po_number, title, stage")
      .order("date", { ascending: false })
      .limit(100);

    return { data: reqs ?? [] };
  });

// Fetches gate passes for linkage in the transaction form.
export const fetchGatePassesForLinkage = createServerFn({ method: "GET" })
  .validator((input: Record<string, never>) => input)
  .handler(async ({ data, context }) => {
    await requireSessionUser();

    const { data: passes } = await supabaseServer
      .from("gate_passes")
      .select("id, gp_number, material")
      .order("requested_at", { ascending: false })
      .limit(100);

    return { data: passes ?? [] };
  });

// Fetches material batches for linkage in the transaction form.
export const fetchBatchesForLinkage = createServerFn({ method: "GET" })
  .validator((input: Record<string, never>) => input)
  .handler(async ({ data, context }) => {
    await requireSessionUser();

    const { data: batches } = await supabaseServer
      .from("batches")
      .select("id, batch_number, material_name, status")
      .order("created_at", { ascending: false })
      .limit(100);

    return { data: batches ?? [] };
  });

// ---------------------------------------------------------------------------
// Category update/archive
// ---------------------------------------------------------------------------

export const updateCategoryNode = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid(), name: z.string().min(1) }))
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    if (!isAdmin(user.role)) {
      return { success: false, error: "Only administrators can manage categories" };
    }
    const { error } = await supabaseServer
      .from("inventory_categories")
      .update({ name: data.name.trim() })
      .eq("id", data.id);
    if (error) return { success: false, error: "Failed to update category" };
    await logAction(user, "update_category", "inventory_categories", data.id, { name: data.name });
    return { success: true };
  });

export const archiveCategoryNode = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    if (!isAdmin(user.role)) {
      return { success: false, error: "Only administrators can manage categories" };
    }
    const { count } = await supabaseServer
      .from("inventory_items")
      .select("*", { count: "exact", head: true })
      .eq("category_id", data.id)
      .eq("archived", false);
    if ((count ?? 0) > 0) {
      return { success: false, error: `Cannot archive: ${count} active items in this category` };
    }
    const { error } = await supabaseServer
      .from("inventory_categories")
      .update({ archived: true, archived_at: new Date().toISOString(), archived_by: user.id })
      .eq("id", data.id);
    if (error) return { success: false, error: "Failed to archive category" };
    await logAction(user, "archive_category", "inventory_categories", data.id, {});
    return { success: true };
  });

// ---------------------------------------------------------------------------
// Item update/archive
// ---------------------------------------------------------------------------

export const updateItem = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.string().uuid(),
      name: z.string().min(1).optional(),
      unit_of_measure: z.string().optional(),
      reorder_level: z.number().min(0).optional(),
      reorder_qty: z.number().min(0).optional(),
      unit_cost: z.number().min(0).optional(),
      supplier_id: z.string().uuid().nullable().optional(),
      default_warehouse_id: z.string().uuid().nullable().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    if (!isAdmin(user.role)) {
      return { success: false, error: "Only administrators can edit items" };
    }
    const { id, ...updates } = data;
    const cleanUpdates: Record<string, any> = {};
    if (updates.name !== undefined) cleanUpdates["name"] = updates.name.trim();
    if (updates.unit_of_measure !== undefined)
      cleanUpdates["unit_of_measure"] = updates.unit_of_measure.trim() || null;
    if (updates.reorder_level !== undefined) cleanUpdates["reorder_level"] = updates.reorder_level;
    if (updates.reorder_qty !== undefined) cleanUpdates["reorder_qty"] = updates.reorder_qty;
    if (updates.unit_cost !== undefined) cleanUpdates["unit_cost"] = updates.unit_cost;
    if (updates.supplier_id !== undefined) cleanUpdates["supplier_id"] = updates.supplier_id;
    if (updates.default_warehouse_id !== undefined)
      cleanUpdates["default_warehouse_id"] = updates.default_warehouse_id;
    const { error } = await supabaseServer
      .from("inventory_items")
      .update(cleanUpdates)
      .eq("id", id);
    if (error) return { success: false, error: "Failed to update item" };
    await logAction(user, "update_inventory_item", "inventory_items", id, cleanUpdates);
    return { success: true };
  });

export const archiveItem = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    if (!isAdmin(user.role)) {
      return { success: false, error: "Only administrators can archive items" };
    }
    const { error } = await supabaseServer
      .from("inventory_items")
      .update({ archived: true, archived_at: new Date().toISOString(), archived_by: user.id })
      .eq("id", data.id);
    if (error) return { success: false, error: "Failed to archive item" };
    await logAction(user, "archive_inventory_item", "inventory_items", data.id, {});
    return { success: true };
  });

// ---------------------------------------------------------------------------
// Transaction reversal
// ---------------------------------------------------------------------------

export const reverseTransaction = createServerFn({ method: "POST" })
  .validator(z.object({ transaction_id: z.string().uuid(), reason: z.string().optional() }))
  .handler(async ({ data }) => {
    const user = await requireSessionUser();

    const { data: orig, error: fetchErr } = await supabaseServer
      .from("inventory_transactions")
      .select("*")
      .eq("id", data.transaction_id)
      .single();
    if (fetchErr || !orig) return { success: false, error: "Transaction not found" };
    if (orig.reversed) return { success: false, error: "Transaction already reversed" };
    if (orig.is_reversal) return { success: false, error: "Cannot reverse a reversal transaction" };

    let compType = orig.type;
    let compAdjDir = orig.adjustment_direction;
    if (orig.type === "in") compType = "out";
    else if (orig.type === "out") compType = "in";
    else if (orig.type === "adjustment")
      compAdjDir = orig.adjustment_direction === "up" ? "down" : "up";
    else if (orig.type === "transfer") compType = "transfer";

    if (compType === "out" || (compType === "adjustment" && compAdjDir === "down")) {
      const { data: stockRow } = await supabaseServer
        .from("inventory_stock_levels")
        .select("current_stock")
        .eq("item_id", orig.item_id)
        .single();
      const currentStock = Number(stockRow?.current_stock ?? 0);
      if (currentStock < Number(orig.quantity)) {
        return {
          success: false,
          error: `Cannot reverse: insufficient stock (${currentStock}) to remove ${orig.quantity}.`,
        };
      }
    }

    const reversalData: Record<string, any> = {
      item_id: orig.item_id,
      type: compType,
      quantity: Number(orig.quantity),
      adjustment_direction: compType === "adjustment" ? compAdjDir : null,
      block_id: orig.block_id,
      warehouse_id: orig.warehouse_id,
      transfer_from_block_id: compType === "transfer" ? orig.transfer_to_block_id : null,
      transfer_to_block_id: compType === "transfer" ? orig.transfer_from_block_id : null,
      unit_cost: Number(orig.unit_cost ?? 0),
      reference: `REVERSAL of tx ${orig.id.slice(0, 8)}`,
      remarks: data.reason?.trim() || `Reversal of ${orig.type} transaction`,
      linked_requisition_id: orig.linked_requisition_id,
      linked_gate_pass_id: orig.linked_gate_pass_id,
      linked_batch_id: orig.linked_batch_id,
      is_reversal: true,
      reverses_tx_id: orig.id,
      created_by: user.id,
    };

    const { data: revTx, error: revErr } = await supabaseServer
      .from("inventory_transactions")
      .insert(reversalData)
      .select("id")
      .single();
    if (revErr || !revTx) return { success: false, error: "Failed to create reversal transaction" };

    const { error: markErr } = await supabaseServer
      .from("inventory_transactions")
      .update({
        reversed: true,
        reversed_by: user.id,
        reversed_at: new Date().toISOString(),
        reversal_tx_id: revTx.id,
      })
      .eq("id", orig.id);
    if (markErr)
      return { success: false, error: "Reversal created but failed to mark original as reversed" };

    await logAction(user, "reverse_inventory_transaction", "inventory_transaction", orig.id, {
      reversal_tx_id: revTx.id,
      reason: data.reason,
    });
    return { success: true, reversal_id: revTx.id };
  });

// ---------------------------------------------------------------------------
// Warehouse creation
// ---------------------------------------------------------------------------

export const createWarehouse = createServerFn({ method: "POST" })
  .validator(
    z.object({
      name: z.string().min(1),
      code: z.string().optional(),
      location: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    if (!isAdmin(user.role))
      return { success: false, error: "Only administrators can manage warehouses" };
    const { data: wh, error } = await supabaseServer
      .from("inventory_warehouses")
      .insert({
        name: data.name.trim(),
        code: data.code?.trim() || null,
        location: data.location?.trim() || null,
        created_by: user.id,
      })
      .select("id, name")
      .single();
    if (error || !wh) return { success: false, error: "Failed to create warehouse" };
    await logAction(user, "create_warehouse", "inventory_warehouse", wh.id, { name: wh.name });
    return { success: true, id: wh.id };
  });

// ---------------------------------------------------------------------------
// Vendors for inventory supplier dropdown
// ---------------------------------------------------------------------------

export const fetchVendorsForInventory = createServerFn({ method: "GET" })
  .validator((input: Record<string, never>) => input)
  .handler(async () => {
    await requireSessionUser();
    const { data: vendors } = await supabaseServer
      .from("vendors")
      .select("id, name")
      .order("name", { ascending: true });
    return { data: vendors ?? [] };
  });

// ---------------------------------------------------------------------------
// CSV exports
// ---------------------------------------------------------------------------

function toCSV(rows: Record<string, any>[], headers?: string[]): string {
  if (rows.length === 0) return "";
  const cols = headers ?? Object.keys(rows[0]!);
  const escape = (val: any) => {
    const s = val === null || val === undefined ? "" : String(val);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => escape(r[c])).join(","))].join("\n");
}

export const exportStockRegisterCSV = createServerFn({ method: "GET" })
  .validator((input: Record<string, never>) => input)
  .handler(async () => {
    const user = await requireSessionUser();
    if (!isAdmin(user.role)) return { success: false, error: "Only administrators can export" };
    const { data: items } = await supabaseServer
      .from("inventory_stock_levels")
      .select(
        "item_name, unit_of_measure, reorder_level, reorder_qty, unit_cost, opening_stock, current_stock, stock_value",
      )
      .eq("archived", false)
      .order("item_name", { ascending: true });
    const { data: allItems } = await supabaseServer
      .from("inventory_stock_levels")
      .select("item_id, category_id")
      .eq("archived", false);
    const catIds = [...new Set((allItems ?? []).map((i: any) => i.category_id))];
    const { data: cats } = await supabaseServer
      .from("inventory_categories")
      .select("id, name, parent_id")
      .in("id", catIds);
    const catMap = new Map((cats ?? []).map((c: any) => [c.id, c]));
    function buildPath(catId: string): string {
      const parts: string[] = [];
      let current = catMap.get(catId);
      const visited = new Set<string>();
      while (current && !visited.has(current.id)) {
        visited.add(current.id);
        parts.unshift(current.name);
        current = current.parent_id ? catMap.get(current.parent_id) : undefined;
      }
      return parts.join(" > ");
    }
    const rows = (items ?? []).map((i: any, idx: number) => ({
      "Item Name": i.item_name,
      Category: buildPath(allItems?.[idx]?.category_id ?? ""),
      Unit: i.unit_of_measure ?? "",
      "Reorder Level": i.reorder_level,
      "Reorder Qty": i.reorder_qty,
      "Unit Cost": i.unit_cost,
      "Opening Stock": i.opening_stock,
      "Current Stock": i.current_stock,
      "Stock Value": i.stock_value,
      "Low Stock":
        Number(i.current_stock) <= Number(i.reorder_level) && Number(i.reorder_level) > 0
          ? "YES"
          : "NO",
    }));
    return { success: true, csv: toCSV(rows) };
  });

export const exportItemLedgerCSV = createServerFn({ method: "GET" })
  .validator((input: { itemId: string; fromDate?: string; toDate?: string }) => input)
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    if (!isAdmin(user.role)) return { success: false, error: "Only administrators can export" };
    let query = supabaseServer
      .from("inventory_transactions")
      .select("type, quantity, adjustment_direction, reference, remarks, created_at")
      .eq("item_id", data.itemId)
      .order("created_at", { ascending: false });
    if (data.fromDate) query = query.gte("created_at", data.fromDate);
    if (data.toDate) query = query.lte("created_at", data.toDate);
    const { data: txns } = await query;
    const rows = (txns ?? []).map((t: any) => ({
      Date: new Date(t.created_at).toLocaleString("en-IN"),
      Type: t.type + (t.adjustment_direction ? ` ${t.adjustment_direction}` : ""),
      Quantity: t.quantity,
      Reference: t.reference ?? "",
      Remarks: t.remarks ?? "",
    }));
    return { success: true, csv: toCSV(rows) };
  });

export const exportLowStockCSV = createServerFn({ method: "GET" })
  .validator((input: Record<string, never>) => input)
  .handler(async () => {
    const user = await requireSessionUser();
    if (!isAdmin(user.role)) return { success: false, error: "Only administrators can export" };
    const { data: items } = await supabaseServer
      .from("inventory_stock_levels")
      .select("item_name, unit_of_measure, reorder_level, current_stock")
      .eq("archived", false)
      .gt("reorder_level", 0)
      .order("item_name", { ascending: true });
    const rows = (items ?? [])
      .filter((i: any) => Number(i.current_stock) <= Number(i.reorder_level))
      .map((i: any) => ({
        "Item Name": i.item_name,
        Unit: i.unit_of_measure ?? "",
        "Reorder Level": i.reorder_level,
        "Current Stock": i.current_stock,
        Shortfall: Number(i.reorder_level) - Number(i.current_stock),
      }));
    return { success: true, csv: toCSV(rows) };
  });
