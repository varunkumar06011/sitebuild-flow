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
  .validator((input: {}) => input)
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
      console.error("[createCategoryNode] Insert failed:", error?.message, error?.code, error?.details);
      const msg = error?.code === "23505"
        ? "A category with this name already exists at this level"
        : error?.code === "23503"
        ? "Foreign key violation — parent or user not found"
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
  .validator((input: { search?: string; workCategory?: string }) => input)
  .handler(async ({ data, context }) => {
    await requireSessionUser();

    let query = supabaseServer
      .from("inventory_stock_levels")
      .select("item_id, item_name, unit_of_measure, reorder_level, opening_stock, category_id, current_stock")
      .order("item_name", { ascending: true });

    if (data.search) {
      query = query.ilike("item_name", `%${data.search}%`);
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
        return { data: [] };
      }
      query = query.in("item_id", itemIds);
    }

    const { data: items } = await query;

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
      return parts.join(" › ");
    }

    // Fetch work_category for each item
    const itemIdsForCat = (items ?? []).map((i: any) => i.item_id);
    let workCatMap = new Map<string, string>();
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
    };
  });

// Zod schema validating a new inventory item (category, name, unit, reorder level, opening stock).
const itemSchema = z.object({
  category_id: z.string().uuid(),
  name: z.string().min(1),
  unit_of_measure: z.string().optional(),
  reorder_level: z.number().min(0).optional(),
  opening_stock: z.number().min(0).optional(),
  work_category: z.string().optional(),
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
        opening_stock: data.opening_stock ?? 0,
        work_category: data.work_category ?? "uncategorized",
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

// Zod schema validating an inventory transaction (in/out/adjustment with quantity and reference).
const txSchema = z.object({
  item_id: z.string().uuid(),
  type: z.enum(["in", "out", "adjustment"]),
  quantity: z.number().positive(),
  is_wastage: z.boolean().optional(),
  block_id: z.string().uuid().nullable().optional(),
  reference: z.string().optional(),
  remarks: z.string().optional(),
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
  .validator((input: {}) => input)
  .handler(async ({ data, context }) => {
    await requireSessionUser();

    const { data: items } = await supabaseServer
      .from("inventory_stock_levels")
      .select("item_id, item_name, unit_of_measure, reorder_level, opening_stock, category_id, current_stock")
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
      return parts.join(" › ");
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
  .validator((input: {}) => input)
  .handler(async ({ data, context }) => {
    await requireSessionUser();

    const { data: items } = await supabaseServer
      .from("inventory_stock_levels")
      .select("item_id, item_name, unit_of_measure, reorder_level, current_stock")
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
  .validator((input: { itemId: string }) => input)
  .handler(async ({ data, context }) => {
    await requireSessionUser();

    const { data: txns } = await supabaseServer
      .from("inventory_transactions")
      .select("id, item_id, type, quantity, is_wastage, block_id, reference, remarks, created_by, created_at")
      .eq("item_id", data.itemId)
      .order("created_at", { ascending: false });

    // Resolve user names
    const userIds = [...new Set((txns ?? []).map((t: any) => t.created_by))];
    const { data: users } = await supabaseServer
      .from("users")
      .select("id, name, role")
      .in("id", userIds);
    const userMap = new Map((users ?? []).map((u: any) => [u.id, u]));

    // Resolve block names
    const blockIds = [...new Set((txns ?? []).filter((t: any) => t.block_id).map((t: any) => t.block_id))];
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
        created_by_name: userMap.get(t.created_by)?.name ?? "Unknown",
        block_name: t.block_id ? blockMap.get(t.block_id) ?? "—" : "—",
      })),
    };
  });

// ---------------------------------------------------------------------------
// Blocks (for the optional block_id dropdown in transaction form)
// ---------------------------------------------------------------------------

// Fetches the list of construction blocks for the transaction form's block dropdown.
export const fetchBlocks = createServerFn({ method: "GET" })
  .validator((input: {}) => input)
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
      .select("id, item_id, stock_at_alert, reorder_level_at_alert, is_resolved, resolved_by, resolved_at, created_at")
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

// Resolves (closes) an inventory alert — admin only.
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
  .validator((input: { fromDate?: string; toDate?: string }) => input)
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
    const { data: users } = await supabaseServer
      .from("users")
      .select("id, name")
      .in("id", userIds);
    const userMap = new Map((users ?? []).map((u: any) => [u.id, u.name]));

    // Resolve block names
    const blockIds = [...new Set((txns ?? []).filter((t: any) => t.block_id).map((t: any) => t.block_id))];
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
        block_name: t.block_id ? blockMap.get(t.block_id) ?? "—" : "—",
      })),
    };
  });

// ---------------------------------------------------------------------------
// B2: Stock usage projections
// ---------------------------------------------------------------------------

// Fetches stock projections: average daily usage (last 30 days) and estimated days remaining per item.
export const fetchStockProjections = createServerFn({ method: "GET" })
  .validator((input: {}) => input)
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
  .validator((input: {}) => input)
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
    let usageMap = new Map<string, number>();
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
    const usagePct = Number(budget.budget_qty) > 0 ? (totalUsage / Number(budget.budget_qty)) * 100 : 0;

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
  .validator((input: {}) => input)
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
    const wastageTotal = (wastageTxns ?? []).reduce(
      (sum, t: any) => sum + Number(t.quantity),
      0,
    );

    // Total vendor outstanding (read directly from existing column, not recomputed)
    const { data: vendors } = await supabaseServer
      .from("vendors")
      .select("outstanding_amount");
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
