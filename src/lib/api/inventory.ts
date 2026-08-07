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
  .validator((input: { search?: string }) => input)
  .handler(async ({ data, context }) => {
    await requireSessionUser();

    let query = supabaseServer
      .from("inventory_stock_levels")
      .select("item_id, item_name, unit_of_measure, reorder_level, opening_stock, category_id, current_stock")
      .order("item_name", { ascending: true });

    if (data.search) {
      query = query.ilike("item_name", `%${data.search}%`);
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

    return {
      data: (items ?? []).map((i: any) => ({
        ...i,
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
  block_id: z.string().uuid().nullable().optional(),
  reference: z.string().optional(),
  remarks: z.string().optional(),
});

// Records an inventory stock transaction (in/out/adjustment) and logs the action.
export const recordTransaction = createServerFn({ method: "POST" })
  .validator(txSchema)
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();

    const { data: tx, error } = await supabaseServer
      .from("inventory_transactions")
      .insert({
        item_id: data.item_id,
        type: data.type,
        quantity: data.quantity,
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
    });
    return { success: true, id: tx.id };
  });

// ---------------------------------------------------------------------------
// Stock levels & low-stock alerts (admin only)
// ---------------------------------------------------------------------------

// Fetches current stock levels for all items with resolved category paths (admin only).
export const fetchStockLevels = createServerFn({ method: "GET" })
  .validator((input: {}) => input)
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();
    if (!isAdmin(user.role)) {
      return { data: [] };
    }

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

// Fetches items whose current stock has fallen to or below their reorder level (admin only).
export const fetchLowStockAlerts = createServerFn({ method: "GET" })
  .validator((input: {}) => input)
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();
    if (!isAdmin(user.role)) {
      return { data: [] };
    }

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

// Fetches the full transaction ledger for a single item with user and block names joined (admin only).
export const fetchItemLedger = createServerFn({ method: "GET" })
  .validator((input: { itemId: string }) => input)
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();
    if (!isAdmin(user.role)) {
      return { data: [] };
    }

    const { data: txns } = await supabaseServer
      .from("inventory_transactions")
      .select("id, item_id, type, quantity, block_id, reference, remarks, created_by, created_at")
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
      .select("id, name")
      .order("sort_order", { ascending: true });

    return { data: blocks ?? [] };
  });
