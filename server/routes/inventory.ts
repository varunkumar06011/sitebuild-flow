import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { supabaseServer } from "../lib/supabase-server.js";
import { requireSessionUser } from "../lib/session.js";
import { logAction } from "../lib/audit.js";
import type { Role } from "../lib/erp-data.js";

export const inventoryRouter = Router();

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
// Category tree
// ---------------------------------------------------------------------------

// GET /api/inventory/category-tree
inventoryRouter.get("/category-tree", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const { data: nodes } = await supabaseServer
      .from("inventory_categories")
      .select("id, name, level, parent_id, sort_order, created_at")
      .order("sort_order", { ascending: true });
    res.json({ data: nodes ?? [] });
  } catch (err) {
    handleErr(res, err, "fetchCategoryTree");
  }
});

// POST /api/inventory/category/create
const categorySchema = z.object({
  name: z.string().min(1),
  level: z.enum(["category", "type", "subcategory", "subtype"]),
  parent_id: z.string().uuid().nullable(),
  sort_order: z.number().optional(),
});

inventoryRouter.post("/category/create", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (!isAdmin(user.role)) {
      res.json({ success: false, error: "Only administrators can manage categories" });
      return;
    }
    const data = categorySchema.parse(req.body);

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
      const msg =
        error?.code === "23505"
          ? "A category with this name already exists at this level"
          : error?.code === "23503"
            ? "Foreign key violation — parent or user not found"
            : `Failed to create category: ${error?.message ?? "Unknown error"}`;
      res.json({ success: false, error: msg });
      return;
    }

    await logAction(user, "create_inventory_category", "inventory_category", node.id, {
      name: node.name,
      level: node.level,
      parent_id: node.parent_id,
    });
    res.json({ success: true, node });
  } catch (err) {
    handleErr(res, err, "createCategoryNode");
  }
});

// POST /api/inventory/category/update
inventoryRouter.post("/category/update", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (!isAdmin(user.role)) {
      res.json({ success: false, error: "Only administrators can manage categories" });
      return;
    }
    const { id, name } = z
      .object({ id: z.string().uuid(), name: z.string().min(1) })
      .parse(req.body);
    const { error } = await supabaseServer
      .from("inventory_categories")
      .update({ name: name.trim() })
      .eq("id", id);
    if (error) {
      res.json({ success: false, error: "Failed to update category" });
      return;
    }
    await logAction(user, "update_category", "inventory_categories", id, { name });
    res.json({ success: true });
  } catch (err) {
    handleErr(res, err, "updateCategoryNode");
  }
});

// POST /api/inventory/category/archive
inventoryRouter.post("/category/archive", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (!isAdmin(user.role)) {
      res.json({ success: false, error: "Only administrators can manage categories" });
      return;
    }
    const { id } = z.object({ id: z.string().uuid() }).parse(req.body);
    const { count } = await supabaseServer
      .from("inventory_items")
      .select("*", { count: "exact", head: true })
      .eq("category_id", id)
      .eq("archived", false);
    if ((count ?? 0) > 0) {
      res.json({ success: false, error: `Cannot archive: ${count} active items in this category` });
      return;
    }
    const { error } = await supabaseServer
      .from("inventory_categories")
      .update({ archived: true, archived_at: new Date().toISOString(), archived_by: user.id })
      .eq("id", id);
    if (error) {
      res.json({ success: false, error: "Failed to archive category" });
      return;
    }
    await logAction(user, "archive_category", "inventory_categories", id, {});
    res.json({ success: true });
  } catch (err) {
    handleErr(res, err, "archiveCategoryNode");
  }
});

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

// GET /api/inventory/items
const fetchItemsSchema = z.object({
  search: z.string().optional(),
  workCategory: z.string().optional(),
  domain: z.enum(["civil", "structural", "uncategorized"]).optional(),
  category_id: z.string().optional(),
  includeArchived: z.coerce.boolean().optional(),
  page: z.coerce.number().optional(),
  pageSize: z.coerce.number().optional(),
});

inventoryRouter.get("/items", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const data = fetchItemsSchema.parse(req.query);
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

    if (!data.includeArchived) query = query.eq("archived", false);
    if (data.search) query = query.ilike("item_name", `%${data.search}%`);
    if (data.category_id) query = query.eq("category_id", data.category_id);

    let itemIds: string[] | null = null;
    if (data.domain) {
      const { data: domainItems } = await supabaseServer
        .from("inventory_items")
        .select("id")
        .eq("domain", data.domain);
      itemIds = (domainItems ?? []).map((i: any) => i.id);
      if (itemIds.length === 0) {
        res.json({ data: [], total: 0, page, pageSize, totalPages: 0 });
        return;
      }
      query = query.in("item_id", itemIds);
    }
    if (data.workCategory && data.workCategory !== "all") {
      const { data: filteredItems } = await supabaseServer
        .from("inventory_items")
        .select("id")
        .eq("work_category", data.workCategory);
      itemIds = (filteredItems ?? []).map((i: any) => i.id);
      if (itemIds.length === 0) {
        res.json({ data: [], total: 0, page, pageSize, totalPages: 0 });
        return;
      }
      query = query.in("item_id", itemIds);
    }

    const { data: items, count } = await query;

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

    res.json({
      data: (items ?? []).map((i: any) => ({
        ...i,
        work_category: workCatMap.get(i.item_id) ?? "uncategorized",
        category_path: buildPath(i.category_id),
      })),
      total: count ?? 0,
      page,
      pageSize,
      totalPages: Math.ceil((count ?? 0) / pageSize),
    });
  } catch (err) {
    handleErr(res, err, "fetchItems");
  }
});

// POST /api/inventory/items/create
const itemSchema = z.object({
  category_id: z.string().uuid(),
  name: z.string().min(1),
  unit_of_measure: z.string().optional(),
  reorder_level: z.number().min(0).optional(),
  reorder_qty: z.number().min(0).optional(),
  unit_cost: z.number().min(0).optional(),
  opening_stock: z.number().min(0).optional(),
  work_category: z.string().optional(),
  domain: z.enum(["civil", "structural", "uncategorized"]).optional(),
  supplier_id: z.string().uuid().nullable().optional(),
  default_warehouse_id: z.string().uuid().nullable().optional(),
  tracking_mode: z
    .enum(["normal", "consumable", "asset", "batch", "expiry", "serialized"])
    .optional(),
  batch_tracking: z.boolean().optional(),
  expiry_tracking: z.boolean().optional(),
  serial_tracking: z.boolean().optional(),
  asset_tracking: z.boolean().optional(),
  expiry_enforced: z.boolean().optional(),
  fefo_enabled: z.boolean().optional(),
});

inventoryRouter.post("/items/create", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (!isAdmin(user.role)) {
      res.json({ success: false, error: "Only administrators can create items" });
      return;
    }
    const data = itemSchema.parse(req.body);

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
        work_category: data.work_category ?? data.domain ?? "uncategorized",
        domain: data.domain ?? data.work_category ?? "uncategorized",
        supplier_id: data.supplier_id ?? null,
        default_warehouse_id: data.default_warehouse_id ?? null,
        tracking_mode: data.tracking_mode ?? "normal",
        batch_tracking: data.batch_tracking ?? false,
        expiry_tracking: data.expiry_tracking ?? false,
        serial_tracking: data.serial_tracking ?? false,
        asset_tracking: data.asset_tracking ?? false,
        expiry_enforced: data.expiry_enforced ?? false,
        fefo_enabled: data.fefo_enabled ?? false,
        created_by: user.id,
      })
      .select("id, name")
      .single();

    if (error || !item) {
      res.json({ success: false, error: "Failed to create item" });
      return;
    }

    await logAction(user, "create_inventory_item", "inventory_item", item.id, {
      name: item.name,
      category_id: data.category_id,
    });
    res.json({ success: true, id: item.id });
  } catch (err) {
    handleErr(res, err, "createItem");
  }
});

// POST /api/inventory/items/update
const updateItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).optional(),
  unit_of_measure: z.string().optional(),
  reorder_level: z.number().min(0).optional(),
  reorder_qty: z.number().min(0).optional(),
  unit_cost: z.number().min(0).optional(),
  supplier_id: z.string().uuid().nullable().optional(),
  default_warehouse_id: z.string().uuid().nullable().optional(),
  tracking_mode: z
    .enum(["normal", "consumable", "asset", "batch", "expiry", "serialized"])
    .optional(),
  batch_tracking: z.boolean().optional(),
  expiry_tracking: z.boolean().optional(),
  serial_tracking: z.boolean().optional(),
  asset_tracking: z.boolean().optional(),
  expiry_enforced: z.boolean().optional(),
  fefo_enabled: z.boolean().optional(),
});

inventoryRouter.post("/items/update", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (!isAdmin(user.role)) {
      res.json({ success: false, error: "Only administrators can edit items" });
      return;
    }
    const data = updateItemSchema.parse(req.body);
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
    if (updates.tracking_mode !== undefined) cleanUpdates["tracking_mode"] = updates.tracking_mode;
    if (updates.batch_tracking !== undefined)
      cleanUpdates["batch_tracking"] = updates.batch_tracking;
    if (updates.expiry_tracking !== undefined)
      cleanUpdates["expiry_tracking"] = updates.expiry_tracking;
    if (updates.serial_tracking !== undefined)
      cleanUpdates["serial_tracking"] = updates.serial_tracking;
    if (updates.asset_tracking !== undefined)
      cleanUpdates["asset_tracking"] = updates.asset_tracking;
    if (updates.expiry_enforced !== undefined)
      cleanUpdates["expiry_enforced"] = updates.expiry_enforced;
    if (updates.fefo_enabled !== undefined) cleanUpdates["fefo_enabled"] = updates.fefo_enabled;
    const { error } = await supabaseServer
      .from("inventory_items")
      .update(cleanUpdates)
      .eq("id", id);
    if (error) {
      res.json({ success: false, error: "Failed to update item" });
      return;
    }
    await logAction(user, "update_inventory_item", "inventory_items", id, cleanUpdates);
    res.json({ success: true });
  } catch (err) {
    handleErr(res, err, "updateItem");
  }
});

// POST /api/inventory/items/archive
inventoryRouter.post("/items/archive", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (!isAdmin(user.role)) {
      res.json({ success: false, error: "Only administrators can archive items" });
      return;
    }
    const { id } = z.object({ id: z.string().uuid() }).parse(req.body);
    const { error } = await supabaseServer
      .from("inventory_items")
      .update({ archived: true, archived_at: new Date().toISOString(), archived_by: user.id })
      .eq("id", id);
    if (error) {
      res.json({ success: false, error: "Failed to archive item" });
      return;
    }
    await logAction(user, "archive_inventory_item", "inventory_items", id, {});
    res.json({ success: true });
  } catch (err) {
    handleErr(res, err, "archiveItem");
  }
});

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

// POST /api/inventory/transactions/record
const txSchema = z.object({
  item_id: z.string().uuid(),
  type: z.enum(["in", "out", "adjustment", "transfer", "return"]),
  quantity: z.number().positive(),
  domain: z.enum(["civil", "structural", "uncategorized"]).optional(),
  is_wastage: z.boolean().optional(),
  block_id: z.string().uuid().nullable().optional(),
  reference: z.string().optional(),
  remarks: z.string().optional(),
  adjustment_direction: z.enum(["up", "down"]).optional(),
  warehouse_id: z.string().uuid().nullable().optional(),
  location_id: z.string().uuid().nullable().optional(),
  destination_warehouse_id: z.string().uuid().nullable().optional(),
  destination_location_id: z.string().uuid().nullable().optional(),
  transfer_from_block_id: z.string().uuid().nullable().optional(),
  transfer_to_block_id: z.string().uuid().nullable().optional(),
  unit_cost: z.number().min(0).optional(),
  linked_requisition_id: z.string().uuid().nullable().optional(),
  linked_gate_pass_id: z.string().uuid().nullable().optional(),
  linked_batch_id: z.string().uuid().nullable().optional(),
});

inventoryRouter.post("/transactions/record", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = txSchema.parse(req.body);

    if (data.type === "adjustment" && !isAdmin(user.role)) {
      res.json({
        success: false,
        error: "Only administrators can submit stock adjustments. Please contact an admin.",
      });
      return;
    }
    if (data.is_wastage && data.type !== "out") {
      res.json({ success: false, error: "Wastage flag can only be set on 'out' transactions." });
      return;
    }
    if (
      data.type === "transfer" &&
      !data.destination_warehouse_id &&
      !data.destination_location_id
    ) {
      res.json({ success: false, error: "Transfer requires a destination warehouse or location" });
      return;
    }

    const transactionKind =
      data.type === "return"
        ? "return"
        : data.type === "adjustment"
          ? "adjustment"
          : data.type === "transfer"
            ? "transfer"
            : data.type === "in"
              ? "receipt"
              : "issue";
    const referenceType = data.linked_requisition_id
      ? "requisition"
      : data.linked_gate_pass_id
        ? "gate_pass"
        : data.linked_batch_id
          ? "batch"
          : null;
    const referenceId =
      data.linked_requisition_id ?? data.linked_gate_pass_id ?? data.linked_batch_id ?? null;
    const metadata = {
      transaction_kind: transactionKind,
      linked_requisition_id: data.linked_requisition_id ?? null,
      linked_gate_pass_id: data.linked_gate_pass_id ?? null,
      linked_batch_id: data.linked_batch_id ?? null,
    };
    const rpcName =
      data.type === "transfer" ? "record_inventory_transfer" : "record_inventory_transaction";
    const rpcPayload =
      data.type === "transfer"
        ? {
            p_item_id: data.item_id,
            p_quantity: data.quantity,
            p_created_by: user.id,
            p_domain: data.domain ?? "uncategorized",
            p_source_warehouse_id: data.warehouse_id ?? null,
            p_source_location_id: data.location_id ?? null,
            p_destination_warehouse_id: data.destination_warehouse_id ?? null,
            p_destination_location_id: data.destination_location_id ?? null,
            p_reference: data.reference?.trim() || null,
            p_remarks: data.remarks?.trim() || null,
            p_unit_cost: data.unit_cost ?? null,
            p_reference_type: referenceType,
            p_reference_id: referenceId,
            p_linked_requisition_id: data.linked_requisition_id ?? null,
            p_linked_gate_pass_id: data.linked_gate_pass_id ?? null,
            p_linked_batch_id: data.linked_batch_id ?? null,
            p_block_id: data.block_id ?? null,
            p_transfer_from_block_id: data.transfer_from_block_id ?? null,
            p_transfer_to_block_id: data.transfer_to_block_id ?? null,
            p_metadata: metadata,
          }
        : {
            p_item_id: data.item_id,
            p_type: data.type === "return" ? "in" : data.type,
            p_quantity: data.quantity,
            p_created_by: user.id,
            p_domain: data.domain ?? "uncategorized",
            p_warehouse_id: data.warehouse_id ?? null,
            p_location_id: data.location_id ?? null,
            p_adjustment_direction: data.adjustment_direction ?? null,
            p_is_wastage: data.is_wastage ?? false,
            p_block_id: data.block_id ?? null,
            p_transfer_from_block_id: data.transfer_from_block_id ?? null,
            p_transfer_to_block_id: data.transfer_to_block_id ?? null,
            p_reference: data.reference?.trim() || null,
            p_remarks: data.remarks?.trim() || null,
            p_unit_cost: data.unit_cost ?? null,
            p_reference_type: referenceType,
            p_reference_id: referenceId,
            p_linked_requisition_id: data.linked_requisition_id ?? null,
            p_linked_gate_pass_id: data.linked_gate_pass_id ?? null,
            p_linked_batch_id: data.linked_batch_id ?? null,
            p_metadata: metadata,
          };
    const { data: transactionId, error } = await supabaseServer.rpc(rpcName, rpcPayload);

    if (error || !transactionId) {
      const message = error?.message?.includes("Insufficient stock")
        ? error.message
        : error?.message?.includes("Transfer")
          ? error.message
          : "Failed to record transaction";
      res.json({ success: false, error: message });
      return;
    }

    await logAction(user, "record_inventory_transaction", "inventory_transaction", transactionId, {
      item_id: data.item_id,
      type: data.type,
      quantity: data.quantity,
      is_wastage: data.is_wastage ?? false,
    });
    res.json({ success: true, id: transactionId });
  } catch (err) {
    handleErr(res, err, "recordTransaction");
  }
});

// GET /api/inventory/receipts
const fetchReceiptsSchema = z.object({
  requisitionId: z.string().uuid().optional(),
  itemId: z.string().uuid().optional(),
  grnNumber: z.string().optional(),
});

inventoryRouter.get("/receipts", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const filters = fetchReceiptsSchema.parse(req.query);
    let query = supabaseServer
      .from("inventory_receipts")
      .select("*")
      .order("received_at", { ascending: false });
    if (filters.requisitionId) query = query.eq("requisition_id", filters.requisitionId);
    if (filters.itemId) query = query.eq("item_id", filters.itemId);
    if (filters.grnNumber) query = query.eq("grn_number", filters.grnNumber.trim());
    const { data, error } = await query;
    if (error) {
      res.json({ data: [], error: "Failed to fetch inventory receipts" });
      return;
    }
    res.json({ data: data ?? [] });
  } catch (err) {
    handleErr(res, err, "fetchInventoryReceipts");
  }
});

// POST /api/inventory/receipts/record
const receiptSchema = z.object({
  requisitionId: z.string().uuid(),
  itemId: z.string().uuid(),
  quantity: z.number().positive(),
  orderedQuantity: z.number().positive(),
  requisitionItemId: z.string().uuid().nullable().optional(),
  batchId: z.string().uuid().nullable().optional(),
  warehouseId: z.string().uuid().nullable().optional(),
  locationId: z.string().uuid().nullable().optional(),
  unitCost: z.number().nonnegative().optional(),
  grnNumber: z.string().optional(),
  invoiceNumber: z.string().optional(),
  receivedAt: z.string().optional(),
});

inventoryRouter.post("/receipts/record", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = receiptSchema.parse(req.body);
    const receiptRpcName = data.batchId
      ? "receive_inventory_stock_with_batch"
      : "receive_inventory_stock";
    const receiptRpcPayload = data.batchId
      ? {
          p_requisition_id: data.requisitionId,
          p_item_id: data.itemId,
          p_quantity: data.quantity,
          p_received_by: user.id,
          p_grn_number: data.grnNumber?.trim() || null,
          p_ordered_quantity: data.orderedQuantity,
          p_batch_id: data.batchId,
          p_warehouse_id: data.warehouseId ?? null,
          p_location_id: data.locationId ?? null,
          p_unit_cost: data.unitCost ?? null,
          p_invoice_number: data.invoiceNumber?.trim() || null,
          p_received_at: data.receivedAt ?? new Date().toISOString(),
        }
      : {
          p_requisition_id: data.requisitionId,
          p_item_id: data.itemId,
          p_quantity: data.quantity,
          p_received_by: user.id,
          p_grn_number: data.grnNumber?.trim() || null,
          p_ordered_quantity: data.orderedQuantity,
          p_requisition_item_id: data.requisitionItemId ?? null,
          p_warehouse_id: data.warehouseId ?? null,
          p_location_id: data.locationId ?? null,
          p_unit_cost: data.unitCost ?? null,
          p_invoice_number: data.invoiceNumber?.trim() || null,
          p_received_at: data.receivedAt ?? new Date().toISOString(),
        };
    const { data: receiptId, error } = await supabaseServer.rpc(receiptRpcName, receiptRpcPayload);
    if (error || !receiptId) {
      res.json({ success: false, error: error?.message ?? "Failed to record inventory receipt" });
      return;
    }
    await logAction(user, "record_inventory_receipt", "inventory_receipt", receiptId, {
      requisition_id: data.requisitionId,
      item_id: data.itemId,
      quantity: data.quantity,
    });
    res.json({ success: true, id: receiptId });
  } catch (err) {
    handleErr(res, err, "recordInventoryReceipt");
  }
});

// GET /api/inventory/locations
inventoryRouter.get("/locations", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const domain = z
      .enum(["civil", "structural", "uncategorized"])
      .optional()
      .parse(req.query["domain"]);
    const parentId = z.string().uuid().optional().parse(req.query["parentId"]);
    let query = supabaseServer
      .from("inventory_locations")
      .select(
        "id, organization_id, domain, parent_id, name, code, location_type, metadata, is_active",
      )
      .eq("is_active", true)
      .order("name");
    if (domain) query = query.eq("domain", domain);
    if (parentId) query = query.eq("parent_id", parentId);
    const { data, error } = await query;
    if (error) {
      res.json({ data: [], error: "Failed to fetch inventory locations" });
      return;
    }
    res.json({ data: data ?? [] });
  } catch (err) {
    handleErr(res, err, "fetchInventoryLocations");
  }
});

// POST /api/inventory/locations/create
inventoryRouter.post("/locations/create", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (!isAdmin(user.role)) {
      res.json({ success: false, error: "Only administrators can manage inventory locations" });
      return;
    }
    const data = z
      .object({
        domain: z.enum(["civil", "structural", "uncategorized"]),
        parent_id: z.string().uuid().nullable().optional(),
        name: z.string().trim().min(1),
        code: z.string().trim().optional(),
        location_type: z.string().trim().default("location"),
        metadata: z.record(z.unknown()).default({}),
      })
      .parse(req.body);
    const { data: location, error } = await supabaseServer
      .from("inventory_locations")
      .insert({ ...data, code: data.code || null, created_by: user.id })
      .select("id, domain, parent_id, name, code, location_type, metadata")
      .single();
    if (error || !location) {
      res.json({ success: false, error: "Failed to create inventory location" });
      return;
    }
    await logAction(user, "create_inventory_location", "inventory_location", location.id, data);
    res.json({ success: true, location });
  } catch (err) {
    handleErr(res, err, "createInventoryLocation");
  }
});

// GET /api/inventory/assets
inventoryRouter.get("/assets", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const itemId = z.string().uuid().optional().parse(req.query["itemId"]);
    let query = supabaseServer
      .from("inventory_assets")
      .select("*")
      .order("created_at", { ascending: false });
    if (itemId) query = query.eq("item_id", itemId);
    const { data, error } = await query;
    if (error) {
      res.json({ data: [], error: "Failed to fetch inventory assets" });
      return;
    }
    res.json({ data: data ?? [] });
  } catch (err) {
    handleErr(res, err, "fetchInventoryAssets");
  }
});

// POST /api/inventory/assets/create
inventoryRouter.post("/assets/create", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = z
      .object({
        item_id: z.string().uuid(),
        asset_number: z.string().trim().min(1),
        serial_number: z.string().trim().optional(),
        manufacturer: z.string().optional(),
        model: z.string().optional(),
        warehouse_id: z.string().uuid().nullable().optional(),
        location_id: z.string().uuid().nullable().optional(),
        medical_equipment_id: z.string().uuid().nullable().optional(),
        warranty_start: z.string().optional(),
        warranty_end: z.string().optional(),
        amc_expiry: z.string().optional(),
        metadata: z.record(z.unknown()).default({}),
      })
      .parse(req.body);
    const { data: asset, error } = await supabaseServer
      .from("inventory_assets")
      .insert({ ...data, serial_number: data.serial_number || null, created_by: user.id })
      .select("id, asset_number, serial_number")
      .single();
    if (error || !asset) {
      res.json({
        success: false,
        error:
          error?.code === "23505"
            ? "Asset or serial number already exists"
            : "Failed to create inventory asset",
      });
      return;
    }
    await logAction(user, "create_inventory_asset", "inventory_asset", asset.id, data);
    res.json({ success: true, asset });
  } catch (err) {
    handleErr(res, err, "createInventoryAsset");
  }
});

// POST /api/inventory/assets/from-receipt
inventoryRouter.post("/assets/from-receipt", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = z
      .object({
        receiptId: z.string().uuid(),
        assetNumber: z.string().trim().min(1),
        serialNumber: z.string().trim().optional(),
        createMedicalEquipment: z.boolean().default(false),
        equipmentNumber: z.string().trim().optional(),
        manufacturer: z.string().optional(),
        model: z.string().optional(),
        warrantyStart: z.string().optional(),
        warrantyEnd: z.string().optional(),
        amcExpiry: z.string().optional(),
        location: z.string().optional(),
        metadata: z.record(z.unknown()).default({}),
      })
      .parse(req.body);
    const { data: assetId, error } = await supabaseServer.rpc(
      "create_asset_from_inventory_receipt",
      {
        p_receipt_id: data.receiptId,
        p_asset_number: data.assetNumber,
        p_serial_number: data.serialNumber || null,
        p_create_medical_equipment: data.createMedicalEquipment,
        p_equipment_number: data.equipmentNumber || null,
        p_manufacturer: data.manufacturer?.trim() || null,
        p_model: data.model?.trim() || null,
        p_warranty_start: data.warrantyStart ?? null,
        p_warranty_end: data.warrantyEnd ?? null,
        p_amc_expiry: data.amcExpiry ?? null,
        p_location: data.location?.trim() || null,
        p_created_by: user.id,
        p_metadata: data.metadata,
      },
    );
    if (error || !assetId) {
      res.json({ success: false, error: error?.message ?? "Failed to create asset from receipt" });
      return;
    }
    await logAction(user, "create_asset_from_inventory_receipt", "inventory_asset", assetId, data);
    res.json({ success: true, id: assetId });
  } catch (err) {
    handleErr(res, err, "createAssetFromReceipt");
  }
});

// GET /api/inventory/equipment-traceability
inventoryRouter.get("/equipment-traceability", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const assetId = z.string().uuid().optional().parse(req.query["assetId"]);
    const equipmentId = z.string().uuid().optional().parse(req.query["equipmentId"]);
    if (!assetId && !equipmentId) {
      res.json({ success: false, error: "assetId or equipmentId is required" });
      return;
    }
    let assetQuery = supabaseServer.from("inventory_assets").select("*").limit(1);
    if (assetId) assetQuery = assetQuery.eq("id", assetId);
    if (equipmentId) assetQuery = assetQuery.eq("medical_equipment_id", equipmentId);
    const { data: assets, error: assetError } = await assetQuery;
    const asset = assets?.[0];
    if (assetError || !asset) {
      res.json({ success: false, error: "Inventory asset not found" });
      return;
    }
    const { data: serial } = await supabaseServer
      .from("inventory_serials")
      .select("id, serial_number, status")
      .eq("asset_id", asset.id)
      .maybeSingle();
    const [{ data: receipt }, { data: transactions }, { data: equipment }] = await Promise.all([
      supabaseServer
        .from("inventory_receipts")
        .select("*")
        .eq("inventory_asset_id", asset.id)
        .maybeSingle(),
      serial
        ? supabaseServer
            .from("inventory_transactions")
            .select("*")
            .or(`linked_asset_id.eq.${asset.id},linked_serial_id.eq.${serial.id}`)
            .order("occurred_at", { ascending: false })
        : supabaseServer
            .from("inventory_transactions")
            .select("*")
            .eq("linked_asset_id", asset.id)
            .order("occurred_at", { ascending: false }),
      asset.medical_equipment_id
        ? supabaseServer
            .from("medical_equipment")
            .select("*")
            .eq("id", asset.medical_equipment_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    res.json({
      data: {
        asset,
        serial: serial ?? null,
        receipt: receipt ?? null,
        equipment: equipment ?? null,
        transactions: transactions ?? [],
      },
    });
  } catch (err) {
    handleErr(res, err, "fetchEquipmentTraceability");
  }
});

// GET /api/inventory/serials
inventoryRouter.get("/serials", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const itemId = z.string().uuid().optional().parse(req.query["itemId"]);
    let query = supabaseServer
      .from("inventory_serials")
      .select("*")
      .order("created_at", { ascending: false });
    if (itemId) query = query.eq("item_id", itemId);
    const { data, error } = await query;
    if (error) {
      res.json({ data: [], error: "Failed to fetch inventory serials" });
      return;
    }
    res.json({ data: data ?? [] });
  } catch (err) {
    handleErr(res, err, "fetchInventorySerials");
  }
});

// POST /api/inventory/serials/create
inventoryRouter.post("/serials/create", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = z
      .object({
        item_id: z.string().uuid(),
        serial_number: z.string().trim().min(1),
        batch_id: z.string().uuid().nullable().optional(),
        asset_id: z.string().uuid().nullable().optional(),
        warehouse_id: z.string().uuid().nullable().optional(),
        location_id: z.string().uuid().nullable().optional(),
      })
      .parse(req.body);
    const { data: serial, error } = await supabaseServer
      .from("inventory_serials")
      .insert({ ...data, created_by: user.id })
      .select("id, item_id, serial_number, status")
      .single();
    if (error || !serial) {
      res.json({
        success: false,
        error:
          error?.code === "23505"
            ? "Serial number already exists"
            : "Failed to create inventory serial",
      });
      return;
    }
    await logAction(user, "create_inventory_serial", "inventory_serial", serial.id, data);
    res.json({ success: true, serial });
  } catch (err) {
    handleErr(res, err, "createInventorySerial");
  }
});

// POST /api/inventory/structural/issues
const structuralIssueSchema = z.object({
  itemId: z.string().uuid(),
  quantity: z.number().positive(),
  warehouseId: z.string().uuid().nullable().optional(),
  sourceLocationId: z.string().uuid().nullable().optional(),
  destinationLocationId: z.string().uuid().nullable().optional(),
  batchId: z.string().uuid().nullable().optional(),
  serialId: z.string().uuid().nullable().optional(),
  assetId: z.string().uuid().nullable().optional(),
  unitCost: z.number().nonnegative().optional(),
  reference: z.string().optional(),
  remarks: z.string().optional(),
});

inventoryRouter.post("/structural/issues", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = structuralIssueSchema.parse(req.body);
    const { data: transactionId, error } = await supabaseServer.rpc("issue_structural_inventory", {
      p_item_id: data.itemId,
      p_quantity: data.quantity,
      p_created_by: user.id,
      p_warehouse_id: data.warehouseId ?? null,
      p_source_location_id: data.sourceLocationId ?? null,
      p_destination_location_id: data.destinationLocationId ?? null,
      p_batch_id: data.batchId ?? null,
      p_serial_id: data.serialId ?? null,
      p_asset_id: data.assetId ?? null,
      p_unit_cost: data.unitCost ?? null,
      p_reference: data.reference?.trim() || null,
      p_remarks: data.remarks?.trim() || null,
    });
    if (error || !transactionId) {
      res.json({ success: false, error: error?.message ?? "Failed to issue structural inventory" });
      return;
    }
    await logAction(
      user,
      "issue_structural_inventory",
      "inventory_transaction",
      transactionId,
      data,
    );
    res.json({ success: true, id: transactionId });
  } catch (err) {
    handleErr(res, err, "issueStructuralInventory");
  }
});

// POST /api/inventory/structural/returns
const structuralReturnSchema = z.object({
  issueTransactionId: z.string().uuid(),
  quantity: z.number().positive(),
  warehouseId: z.string().uuid().nullable().optional(),
  locationId: z.string().uuid().nullable().optional(),
  reason: z.string().optional(),
});

inventoryRouter.post("/structural/returns", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = structuralReturnSchema.parse(req.body);
    const { data: returnId, error } = await supabaseServer.rpc("return_structural_inventory", {
      p_issue_transaction_id: data.issueTransactionId,
      p_quantity: data.quantity,
      p_created_by: user.id,
      p_warehouse_id: data.warehouseId ?? null,
      p_location_id: data.locationId ?? null,
      p_reason: data.reason?.trim() || null,
    });
    if (error || !returnId) {
      res.json({
        success: false,
        error: error?.message ?? "Failed to return structural inventory",
      });
      return;
    }
    await logAction(
      user,
      "return_structural_inventory",
      "inventory_structural_return",
      returnId,
      data,
    );
    res.json({ success: true, id: returnId });
  } catch (err) {
    handleErr(res, err, "returnStructuralInventory");
  }
});

// POST /api/inventory/consumptions/record
const consumptionSchema = z.object({
  item_id: z.string().uuid(),
  used_quantity: z.number().nonnegative().default(0),
  wasted_quantity: z.number().nonnegative().default(0),
  warehouse_id: z.string().uuid().nullable().optional(),
  location_id: z.string().uuid().nullable().optional(),
  block_id: z.string().uuid().nullable().optional(),
  floor_id: z.string().uuid().nullable().optional(),
  cell_id: z.string().uuid().nullable().optional(),
  work_item_id: z.string().uuid().nullable().optional(),
  wastage_reason_id: z.string().uuid().nullable().optional(),
  wastage_reason: z.string().optional(),
  unit_cost: z.number().nonnegative().optional(),
  reference: z.string().optional(),
  remarks: z.string().optional(),
  reference_type: z.string().optional(),
  reference_id: z.string().uuid().nullable().optional(),
});

inventoryRouter.post("/consumptions/record", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = consumptionSchema.parse(req.body);
    if (data.used_quantity + data.wasted_quantity <= 0) {
      res.json({ success: false, error: "Used plus wasted quantity must be greater than zero" });
      return;
    }
    if (data.wasted_quantity > 0 && !data.wastage_reason_id && !data.wastage_reason?.trim()) {
      res.json({
        success: false,
        error: "A wastage reason is required when wasted quantity is recorded",
      });
      return;
    }

    const { data: consumptionId, error } = await supabaseServer.rpc(
      "record_inventory_consumption",
      {
        p_item_id: data.item_id,
        p_used_quantity: data.used_quantity,
        p_wasted_quantity: data.wasted_quantity,
        p_created_by: user.id,
        p_warehouse_id: data.warehouse_id ?? null,
        p_location_id: data.location_id ?? null,
        p_block_id: data.block_id ?? null,
        p_floor_id: data.floor_id ?? null,
        p_cell_id: data.cell_id ?? null,
        p_work_item_id: data.work_item_id ?? null,
        p_wastage_reason_id: data.wastage_reason_id ?? null,
        p_wastage_reason: data.wastage_reason?.trim() || null,
        p_unit_cost: data.unit_cost ?? null,
        p_reference: data.reference?.trim() || null,
        p_remarks: data.remarks?.trim() || null,
        p_reference_type: data.reference_type ?? null,
        p_reference_id: data.reference_id ?? null,
      },
    );
    if (error || !consumptionId) {
      const message = error?.message?.includes("Insufficient stock")
        ? error.message
        : error?.message?.includes("wastage reason")
          ? error.message
          : "Failed to record consumption";
      res.json({ success: false, error: message });
      return;
    }

    await logAction(user, "record_inventory_consumption", "inventory_consumption", consumptionId, {
      item_id: data.item_id,
      used_quantity: data.used_quantity,
      wasted_quantity: data.wasted_quantity,
      block_id: data.block_id,
      floor_id: data.floor_id,
      work_item_id: data.work_item_id,
    });
    res.json({ success: true, id: consumptionId });
  } catch (err) {
    handleErr(res, err, "recordConsumption");
  }
});

// POST /api/inventory/consumptions/reverse
inventoryRouter.post("/consumptions/reverse", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = z
      .object({
        consumption_id: z.string().uuid(),
        used_quantity: z.number().positive().optional(),
        wasted_quantity: z.number().positive().optional(),
        reason: z.string().optional(),
      })
      .parse(req.body);
    const { data: reversalId, error } = await supabaseServer.rpc("reverse_inventory_consumption", {
      p_consumption_id: data.consumption_id,
      p_created_by: user.id,
      p_used_quantity: data.used_quantity ?? null,
      p_wasted_quantity: data.wasted_quantity ?? null,
      p_reason: data.reason?.trim() || null,
    });
    if (error || !reversalId) {
      res.json({ success: false, error: error?.message ?? "Failed to reverse consumption" });
      return;
    }
    await logAction(
      user,
      "reverse_inventory_consumption",
      "inventory_consumption",
      data.consumption_id,
      {
        reversal_id: reversalId,
        used_quantity: data.used_quantity,
        wasted_quantity: data.wasted_quantity,
        reason: data.reason,
      },
    );
    res.json({ success: true, reversal_id: reversalId });
  } catch (err) {
    handleErr(res, err, "reverseConsumption");
  }
});

// GET /api/inventory/consumptions
const fetchConsumptionsSchema = z.object({
  itemId: z.string().uuid().optional(),
  blockId: z.string().uuid().optional(),
  floorId: z.string().uuid().optional(),
  workItemId: z.string().uuid().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  page: z.coerce.number().positive().optional(),
  pageSize: z.coerce.number().positive().max(200).optional(),
});

inventoryRouter.get("/consumptions", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const filters = fetchConsumptionsSchema.parse(req.query);
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 50;
    let query = supabaseServer
      .from("inventory_consumptions")
      .select("*", { count: "exact" })
      .order("consumed_at", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (filters.itemId) query = query.eq("item_id", filters.itemId);
    if (filters.blockId) query = query.eq("block_id", filters.blockId);
    if (filters.floorId) query = query.eq("floor_id", filters.floorId);
    if (filters.workItemId) query = query.eq("work_item_id", filters.workItemId);
    if (filters.fromDate) query = query.gte("consumed_at", filters.fromDate);
    if (filters.toDate) query = query.lte("consumed_at", filters.toDate);
    const { data, count, error } = await query;
    if (error) {
      res.json({
        data: [],
        total: 0,
        page,
        pageSize,
        totalPages: 0,
        error: "Failed to fetch consumptions",
      });
      return;
    }
    const total = count ?? 0;
    res.json({ data: data ?? [], total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  } catch (err) {
    handleErr(res, err, "fetchConsumptions");
  }
});

// GET /api/inventory/wastage-reasons
inventoryRouter.get("/wastage-reasons", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const domain = z.enum(["civil", "structural"]).optional().parse(req.query["domain"]);
    let query = supabaseServer
      .from("inventory_wastage_reasons")
      .select("id, domain, name, description")
      .eq("is_active", true)
      .order("name");
    if (domain) query = query.eq("domain", domain);
    const { data, error } = await query;
    if (error) {
      res.json({ data: [], error: "Failed to fetch wastage reasons" });
      return;
    }
    res.json({ data: data ?? [] });
  } catch (err) {
    handleErr(res, err, "fetchWastageReasons");
  }
});

// POST /api/inventory/wastage-reasons/create
inventoryRouter.post("/wastage-reasons/create", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (!isAdmin(user.role)) {
      res.json({ success: false, error: "Only administrators can manage wastage reasons" });
      return;
    }
    const data = z
      .object({
        domain: z.enum(["civil", "structural"]),
        name: z.string().trim().min(1),
        description: z.string().optional(),
      })
      .parse(req.body);
    const { data: reason, error } = await supabaseServer
      .from("inventory_wastage_reasons")
      .insert({
        domain: data.domain,
        name: data.name,
        description: data.description?.trim() || null,
        created_by: user.id,
      })
      .select("id, domain, name, description")
      .single();
    if (error || !reason) {
      res.json({ success: false, error: "Failed to create wastage reason" });
      return;
    }
    await logAction(
      user,
      "create_inventory_wastage_reason",
      "inventory_wastage_reason",
      reason.id,
      data,
    );
    res.json({ success: true, reason });
  } catch (err) {
    handleErr(res, err, "createWastageReason");
  }
});

// POST /api/inventory/transactions/reverse
inventoryRouter.post("/transactions/reverse", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const { transaction_id, reason, quantity } = z
      .object({
        transaction_id: z.string().uuid(),
        reason: z.string().optional(),
        quantity: z.number().positive().optional(),
      })
      .parse(req.body);

    const { data: reversalId, error } = await supabaseServer.rpc("reverse_inventory_transaction", {
      p_transaction_id: transaction_id,
      p_created_by: user.id,
      p_reason: reason?.trim() || null,
      p_quantity: quantity ?? null,
    });
    if (error || !reversalId) {
      const message = error?.message?.includes("insufficient stock")
        ? error.message
        : error?.message?.includes("already reversed")
          ? error.message
          : error?.message?.includes("does not exist")
            ? "Transaction not found"
            : "Failed to reverse transaction";
      res.json({ success: false, error: message });
      return;
    }

    await logAction(
      user,
      "reverse_inventory_transaction",
      "inventory_transaction",
      transaction_id,
      {
        reversal_tx_id: reversalId,
        reason,
      },
    );
    res.json({ success: true, reversal_id: reversalId });
  } catch (err) {
    handleErr(res, err, "reverseTransaction");
  }
});

// ---------------------------------------------------------------------------
// Stock levels & low-stock alerts
// ---------------------------------------------------------------------------

// GET /api/inventory/stock-levels
inventoryRouter.get("/stock-levels", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const { data: items } = await supabaseServer
      .from("inventory_stock_levels")
      .select(
        "item_id, item_name, unit_of_measure, reorder_level, reorder_qty, unit_cost, supplier_id, default_warehouse_id, opening_stock, category_id, current_stock, stock_value, archived",
      )
      .eq("archived", false)
      .order("item_name", { ascending: true });

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

    res.json({
      data: (items ?? []).map((i: any) => ({
        ...i,
        category_path: buildPath(i.category_id),
      })),
    });
  } catch (err) {
    handleErr(res, err, "fetchStockLevels");
  }
});

// GET /api/inventory/reports/stock-summary
const reportScopeSchema = z.object({
  itemId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  domain: z.enum(["civil", "structural", "uncategorized"]).optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  page: z.coerce.number().positive().optional(),
  pageSize: z.coerce.number().positive().max(500).optional(),
});

inventoryRouter.get("/reports/stock-summary", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const filters = reportScopeSchema.parse(req.query);
    let query = supabaseServer.from("inventory_cost_summary").select("*").eq("archived", false);
    if (filters.itemId) query = query.eq("item_id", filters.itemId);
    if (filters.warehouseId) query = query.eq("warehouse_id", filters.warehouseId);
    if (filters.locationId) query = query.eq("location_id", filters.locationId);
    if (filters.domain) query = query.eq("domain", filters.domain);
    const { data, error } = await query.order("item_name");
    if (error) {
      res.json({ data: [], error: "Failed to fetch stock summary" });
      return;
    }
    res.json({ data: data ?? [] });
  } catch (err) {
    handleErr(res, err, "fetchStockSummaryReport");
  }
});

// GET /api/inventory/reports/movements
inventoryRouter.get("/reports/movements", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const filters = reportScopeSchema.parse(req.query);
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 100;
    let query = supabaseServer
      .from("inventory_transactions")
      .select("*", { count: "exact" })
      .order("occurred_at", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (filters.itemId) query = query.eq("item_id", filters.itemId);
    if (filters.warehouseId) query = query.eq("warehouse_id", filters.warehouseId);
    if (filters.locationId) query = query.eq("location_id", filters.locationId);
    if (filters.domain) query = query.eq("domain", filters.domain);
    if (filters.fromDate) query = query.gte("occurred_at", filters.fromDate);
    if (filters.toDate) query = query.lte("occurred_at", filters.toDate);
    const { data, count, error } = await query;
    if (error) {
      res.json({
        data: [],
        total: 0,
        page,
        pageSize,
        totalPages: 0,
        error: "Failed to fetch movement report",
      });
      return;
    }
    const total = count ?? 0;
    res.json({ data: data ?? [], total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  } catch (err) {
    handleErr(res, err, "fetchMovementReport");
  }
});

// GET /api/inventory/reports/daily-register
inventoryRouter.get("/reports/daily-register", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const filters = reportScopeSchema.parse(req.query);
    let query = supabaseServer
      .from("inventory_daily_register")
      .select("*")
      .order("report_date", { ascending: false });
    if (filters.itemId) query = query.eq("item_id", filters.itemId);
    if (filters.warehouseId) query = query.eq("warehouse_id", filters.warehouseId);
    if (filters.locationId) query = query.eq("location_id", filters.locationId);
    if (filters.domain) query = query.eq("domain", filters.domain);
    if (filters.fromDate) query = query.gte("report_date", filters.fromDate);
    if (filters.toDate) query = query.lte("report_date", filters.toDate);
    const { data, error } = await query;
    if (error) {
      res.json({ data: [], error: "Failed to fetch daily register" });
      return;
    }
    res.json({ data: data ?? [] });
  } catch (err) {
    handleErr(res, err, "fetchDailyRegister");
  }
});

// GET /api/inventory/reports/vendor-purchases
inventoryRouter.get("/reports/vendor-purchases", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const filters = reportScopeSchema.parse(req.query);
    let query = supabaseServer
      .from("inventory_vendor_purchase_report")
      .select("*")
      .order("received_at", { ascending: false });
    if (filters.itemId) query = query.eq("item_id", filters.itemId);
    if (filters.warehouseId) query = query.eq("warehouse_id", filters.warehouseId);
    if (filters.locationId) query = query.eq("location_id", filters.locationId);
    if (filters.domain) query = query.eq("domain", filters.domain);
    if (filters.fromDate) query = query.gte("received_at", filters.fromDate);
    if (filters.toDate) query = query.lte("received_at", filters.toDate);
    const { data, error } = await query;
    if (error) {
      res.json({ data: [], error: "Failed to fetch vendor purchase report" });
      return;
    }
    res.json({ data: data ?? [] });
  } catch (err) {
    handleErr(res, err, "fetchVendorPurchaseReport");
  }
});

// GET /api/inventory/reports/transfers
inventoryRouter.get("/reports/transfers", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const filters = reportScopeSchema.parse(req.query);
    let query = supabaseServer
      .from("inventory_transfer_report")
      .select("*")
      .order("occurred_at", { ascending: false });
    if (filters.itemId) query = query.eq("item_id", filters.itemId);
    if (filters.warehouseId) query = query.eq("source_warehouse_id", filters.warehouseId);
    if (filters.locationId) query = query.eq("source_location_id", filters.locationId);
    if (filters.domain) query = query.eq("domain", filters.domain);
    if (filters.fromDate) query = query.gte("occurred_at", filters.fromDate);
    if (filters.toDate) query = query.lte("occurred_at", filters.toDate);
    const { data, error } = await query;
    if (error) {
      res.json({ data: [], error: "Failed to fetch transfer report" });
      return;
    }
    res.json({ data: data ?? [] });
  } catch (err) {
    handleErr(res, err, "fetchTransferReport");
  }
});

// GET /api/inventory/reports/traceability
inventoryRouter.get("/reports/traceability", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const itemId = z.string().uuid().optional().parse(req.query["itemId"]);
    const transactionId = z.string().uuid().optional().parse(req.query["transactionId"]);
    const receiptId = z.string().uuid().optional().parse(req.query["receiptId"]);
    const assetId = z.string().uuid().optional().parse(req.query["assetId"]);
    if (!itemId && !transactionId && !receiptId && !assetId) {
      res.json({
        success: false,
        error: "itemId, transactionId, receiptId, or assetId is required",
      });
      return;
    }

    let resolvedItemId = itemId;
    let resolvedAssetId = assetId;
    let resolvedReceiptId = receiptId;
    if (transactionId) {
      const { data: tx } = await supabaseServer
        .from("inventory_transactions")
        .select("item_id, linked_asset_id")
        .eq("id", transactionId)
        .maybeSingle();
      resolvedItemId = resolvedItemId ?? tx?.item_id;
      resolvedAssetId = resolvedAssetId ?? tx?.linked_asset_id;
    }
    if (receiptId) {
      const { data: receipt } = await supabaseServer
        .from("inventory_receipts")
        .select("item_id, inventory_asset_id")
        .eq("id", receiptId)
        .maybeSingle();
      resolvedItemId = resolvedItemId ?? receipt?.item_id;
      resolvedAssetId = resolvedAssetId ?? receipt?.inventory_asset_id;
    }
    if (assetId) {
      const { data: asset } = await supabaseServer
        .from("inventory_assets")
        .select("item_id, source_receipt_id")
        .eq("id", assetId)
        .maybeSingle();
      resolvedItemId = resolvedItemId ?? asset?.item_id;
      resolvedReceiptId = resolvedReceiptId ?? asset?.source_receipt_id;
    }
    const [
      { data: item },
      { data: transactions },
      { data: receipts },
      { data: consumptions },
      { data: assets },
    ] = await Promise.all([
      resolvedItemId
        ? supabaseServer.from("inventory_items").select("*").eq("id", resolvedItemId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      resolvedItemId
        ? supabaseServer
            .from("inventory_transactions")
            .select("*")
            .eq("item_id", resolvedItemId)
            .order("occurred_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      resolvedItemId
        ? supabaseServer
            .from("inventory_receipts")
            .select("*")
            .eq("item_id", resolvedItemId)
            .order("received_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      resolvedItemId
        ? supabaseServer
            .from("inventory_consumptions")
            .select("*")
            .eq("item_id", resolvedItemId)
            .order("consumed_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      resolvedItemId
        ? supabaseServer.from("inventory_assets").select("*").eq("item_id", resolvedItemId)
        : Promise.resolve({ data: [], error: null }),
    ]);
    res.json({
      data: {
        item,
        transactions: transactions ?? [],
        receipts: receipts ?? [],
        consumptions: consumptions ?? [],
        assets: assets ?? [],
        receipt_id: resolvedReceiptId,
      },
    });
  } catch (err) {
    handleErr(res, err, "fetchInventoryTraceabilityReport");
  }
});

// GET /api/inventory/stock-balances
const stockBalancesSchema = z.object({
  itemId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  domain: z.enum(["civil", "structural", "uncategorized"]).optional(),
});

inventoryRouter.get("/stock-balances", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const filters = stockBalancesSchema.parse(req.query);
    let query = supabaseServer
      .from("inventory_stock_balances")
      .select("*")
      .eq("archived", false)
      .order("item_name", { ascending: true });
    if (filters.itemId) query = query.eq("item_id", filters.itemId);
    if (filters.warehouseId) query = query.eq("warehouse_id", filters.warehouseId);
    if (filters.locationId) query = query.eq("location_id", filters.locationId);
    if (filters.domain) query = query.eq("domain", filters.domain);
    const { data, error } = await query;
    if (error) {
      res.json({ data: [], error: "Failed to fetch scoped stock balances" });
      return;
    }
    res.json({ data: data ?? [] });
  } catch (err) {
    handleErr(res, err, "fetchStockBalances");
  }
});

// GET /api/inventory/cost-summary
const costSummarySchema = z.object({
  itemId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  domain: z.enum(["civil", "structural", "uncategorized"]).optional(),
});

inventoryRouter.get("/cost-summary", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const filters = costSummarySchema.parse(req.query);
    let query = supabaseServer
      .from("inventory_cost_summary")
      .select("*")
      .eq("archived", false)
      .order("item_name", { ascending: true });
    if (filters.itemId) query = query.eq("item_id", filters.itemId);
    if (filters.warehouseId) query = query.eq("warehouse_id", filters.warehouseId);
    if (filters.locationId) query = query.eq("location_id", filters.locationId);
    if (filters.domain) query = query.eq("domain", filters.domain);
    const { data, error } = await query;
    if (error) {
      res.json({ data: [], error: "Failed to fetch inventory cost summary" });
      return;
    }
    res.json({ data: data ?? [] });
  } catch (err) {
    handleErr(res, err, "fetchCostSummary");
  }
});

// GET /api/inventory/low-stock
inventoryRouter.get("/low-stock", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const { data: items } = await supabaseServer
      .from("inventory_stock_levels")
      .select("item_id, item_name, unit_of_measure, reorder_level, current_stock")
      .eq("archived", false)
      .gt("reorder_level", 0)
      .order("item_name", { ascending: true });

    const lowStock = (items ?? []).filter(
      (i: any) => Number(i.current_stock) <= Number(i.reorder_level),
    );
    res.json({ data: lowStock });
  } catch (err) {
    handleErr(res, err, "fetchLowStockAlerts");
  }
});

// GET /api/inventory/item-ledger
const fetchItemLedgerSchema = z.object({
  itemId: z.string().uuid(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  page: z.coerce.number().optional(),
  pageSize: z.coerce.number().optional(),
});

inventoryRouter.get("/item-ledger", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const data = fetchItemLedgerSchema.parse(req.query);
    const page = data.page ?? 1;
    const pageSize = data.pageSize ?? 50;
    const offset = (page - 1) * pageSize;

    let query = supabaseServer
      .from("inventory_transactions")
      .select(
        "id, item_id, type, transaction_kind, quantity, is_wastage, reason_code, adjustment_direction, block_id, warehouse_id, location_id, destination_warehouse_id, destination_location_id, transfer_group_id, transfer_from_block_id, transfer_to_block_id, unit_cost, reference, remarks, linked_requisition_id, linked_gate_pass_id, linked_batch_id, reversed, is_reversal, reverses_tx_id, metadata, created_by, occurred_at, created_at",
        { count: "exact" },
      )
      .eq("item_id", data.itemId)
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (data.fromDate) query = query.gte("created_at", data.fromDate);
    if (data.toDate) query = query.lte("created_at", data.toDate);

    const { data: txns, count } = await query;

    const userIds = [...new Set((txns ?? []).map((t: any) => t.created_by))];
    const { data: users } = await supabaseServer
      .from("users")
      .select("id, name, role")
      .in("id", userIds);
    const userMap = new Map((users ?? []).map((u: any) => [u.id, u]));

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

    res.json({
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
    });
  } catch (err) {
    handleErr(res, err, "fetchItemLedger");
  }
});

// GET /api/inventory/blocks
inventoryRouter.get("/blocks", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const { data: blocks } = await supabaseServer
      .from("progress_blocks")
      .select("id, name, work_category")
      .order("sort_order", { ascending: true });
    res.json({ data: blocks ?? [] });
  } catch (err) {
    handleErr(res, err, "fetchBlocks");
  }
});

// GET /api/inventory/alerts
inventoryRouter.get("/alerts", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const resolved = req.query["resolved"];
    const alertType = z
      .enum([
        "LOW_STOCK",
        "REORDER_REQUIRED",
        "BUDGET_THRESHOLD",
        "BUDGET_EXCEEDED",
        "MISSING_COST",
        "HIGH_WASTAGE",
      ])
      .optional()
      .parse(req.query["alertType"]);
    const domain = z
      .enum(["civil", "structural", "uncategorized"])
      .optional()
      .parse(req.query["domain"]);
    let query = supabaseServer
      .from("inventory_alerts")
      .select(
        "id, item_id, domain, alert_type, stock_at_alert, reorder_level_at_alert, warehouse_id, location_id, threshold_value, metadata, is_resolved, resolved_by, resolved_at, created_at",
      )
      .order("created_at", { ascending: false });

    if (resolved !== undefined) {
      query = query.eq("is_resolved", resolved === "true");
    }
    if (alertType) query = query.eq("alert_type", alertType);
    if (domain) query = query.eq("domain", domain);

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

    res.json({
      data: (alerts ?? []).map((a: any) => ({
        ...a,
        item_name: itemMap.get(a.item_id) ?? "Unknown",
      })),
    });
  } catch (err) {
    handleErr(res, err, "fetchInventoryAlerts");
  }
});

// POST /api/inventory/alerts/resolve
inventoryRouter.post("/alerts/resolve", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (!isAdmin(user.role)) {
      res.json({ success: false, error: "Only administrators can resolve alerts" });
      return;
    }
    const { alertId } = z.object({ alertId: z.string().uuid() }).parse(req.body);
    const { error } = await supabaseServer
      .from("inventory_alerts")
      .update({
        is_resolved: true,
        resolved_by: user.id,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", alertId)
      .eq("is_resolved", false);
    if (error) {
      res.json({ success: false, error: "Failed to resolve alert" });
      return;
    }
    await logAction(user, "resolve_inventory_alert", "inventory_alert", alertId, {});
    res.json({ success: true });
  } catch (err) {
    handleErr(res, err, "resolveInventoryAlert");
  }
});

// GET /api/inventory/wastage-report
inventoryRouter.get("/wastage-report", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const fromDate = req.query["fromDate"] as string | undefined;
    const toDate = req.query["toDate"] as string | undefined;

    let query = supabaseServer
      .from("inventory_transactions")
      .select(
        "id, item_id, quantity, transaction_kind, reason_code, unit_cost, block_id, warehouse_id, location_id, reference, remarks, metadata, created_by, occurred_at, created_at",
      )
      .eq("is_wastage", true)
      .order("created_at", { ascending: false });

    if (fromDate) query = query.gte("created_at", fromDate);
    if (toDate) query = query.lte("created_at", toDate);

    const { data: txns } = await query;

    const itemIds = [...new Set((txns ?? []).map((t: any) => t.item_id))];
    const { data: items } = await supabaseServer
      .from("inventory_items")
      .select("id, name, unit_of_measure")
      .in("id", itemIds);
    const itemMap = new Map((items ?? []).map((i: any) => [i.id, i]));

    const userIds = [...new Set((txns ?? []).map((t: any) => t.created_by))];
    const { data: users } = await supabaseServer.from("users").select("id, name").in("id", userIds);
    const userMap = new Map((users ?? []).map((u: any) => [u.id, u.name]));

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

    res.json({
      data: (txns ?? []).map((t: any) => ({
        ...t,
        item_name: itemMap.get(t.item_id)?.name ?? "Unknown",
        unit_of_measure: itemMap.get(t.item_id)?.unit_of_measure ?? null,
        created_by_name: userMap.get(t.created_by) ?? "Unknown",
        block_name: t.block_id ? (blockMap.get(t.block_id) ?? "—") : "—",
      })),
    });
  } catch (err) {
    handleErr(res, err, "fetchWastageReport");
  }
});

// GET /api/inventory/stock-projections
inventoryRouter.get("/stock-projections", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const { data: stockItems } = await supabaseServer
      .from("inventory_stock_levels")
      .select("item_id, item_name, unit_of_measure, reorder_level, current_stock")
      .order("item_name", { ascending: true });

    if (!stockItems || stockItems.length === 0) {
      res.json({ data: [] });
      return;
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const { data: recentOutTxns } = await supabaseServer
      .from("inventory_transactions")
      .select("item_id, quantity")
      .eq("type", "out")
      .gte("created_at", thirtyDaysAgo.toISOString());

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

    projections.sort((a, b) => {
      if (a.days_remaining === null && b.days_remaining === null) return 0;
      if (a.days_remaining === null) return 1;
      if (b.days_remaining === null) return -1;
      return a.days_remaining - b.days_remaining;
    });

    res.json({ data: projections });
  } catch (err) {
    handleErr(res, err, "fetchStockProjections");
  }
});

// POST /api/inventory/budgets/set
const budgetSchema = z.object({
  item_id: z.string().uuid(),
  budget_qty: z.number().min(0),
  budget_value: z.number().min(0).optional(),
  alert_threshold_pct: z.number().min(0).max(100).optional(),
  wastage_threshold_pct: z.number().min(0).max(100).optional(),
});

inventoryRouter.post("/budgets/set", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (!isAdmin(user.role)) {
      res.json({ success: false, error: "Only administrators can set budgets" });
      return;
    }
    const data = budgetSchema.parse(req.body);
    const { data: budget, error } = await supabaseServer
      .from("inventory_budgets")
      .upsert({
        item_id: data.item_id,
        budget_qty: data.budget_qty,
        budget_value: data.budget_value ?? 0,
        alert_threshold_pct: data.alert_threshold_pct ?? 80,
        wastage_threshold_pct: data.wastage_threshold_pct ?? 10,
        updated_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error || !budget) {
      res.json({ success: false, error: "Failed to set budget" });
      return;
    }
    await logAction(user, "set_item_budget", "inventory_budget", budget.id, {
      item_id: data.item_id,
      budget_qty: data.budget_qty,
      budget_value: data.budget_value ?? 0,
      alert_threshold_pct: data.alert_threshold_pct ?? 80,
      wastage_threshold_pct: data.wastage_threshold_pct ?? 10,
    });
    res.json({ success: true, id: budget.id });
  } catch (err) {
    handleErr(res, err, "setItemBudget");
  }
});

// GET /api/inventory/budgets
inventoryRouter.get("/budgets", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const { data: budgets } = await supabaseServer
      .from("inventory_budgets")
      .select(
        "id, item_id, budget_qty, budget_value, alert_threshold_pct, wastage_threshold_pct, updated_at",
      )
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

    res.json({
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
    });
  } catch (err) {
    handleErr(res, err, "fetchBudgets");
  }
});

// GET /api/inventory/budgets/item
inventoryRouter.get("/budgets/item", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const itemId = z.string().uuid().parse(req.query["itemId"]);

    const { data: budget } = await supabaseServer
      .from("inventory_budgets")
      .select(
        "id, item_id, budget_qty, budget_value, alert_threshold_pct, wastage_threshold_pct, updated_at",
      )
      .eq("item_id", itemId)
      .single();

    if (!budget) {
      res.json({ data: null });
      return;
    }

    const { data: outTxns } = await supabaseServer
      .from("inventory_transactions")
      .select("quantity")
      .eq("item_id", itemId)
      .eq("type", "out");

    const totalUsage = (outTxns ?? []).reduce((sum, t: any) => sum + Number(t.quantity), 0);
    const threshold = Number(budget.alert_threshold_pct);
    const usagePct =
      Number(budget.budget_qty) > 0 ? (totalUsage / Number(budget.budget_qty)) * 100 : 0;

    res.json({
      data: {
        ...budget,
        total_usage: totalUsage,
        usage_pct: Number(usagePct.toFixed(1)),
        is_over_threshold: usagePct >= threshold,
      },
    });
  } catch (err) {
    handleErr(res, err, "fetchItemBudget");
  }
});

// GET /api/inventory/instant-report
inventoryRouter.get("/instant-report", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (!isAdmin(user.role)) {
      res.json({ data: null });
      return;
    }

    const { count: itemCount } = await supabaseServer
      .from("inventory_items")
      .select("id", { count: "exact", head: true });

    const { data: stockItems } = await supabaseServer
      .from("inventory_stock_levels")
      .select("item_id, current_stock, reorder_level");
    const lowStockCount = (stockItems ?? []).filter(
      (i: any) => Number(i.current_stock) <= Number(i.reorder_level),
    ).length;

    const { count: openAlertsCount } = await supabaseServer
      .from("inventory_alerts")
      .select("id", { count: "exact", head: true })
      .eq("is_resolved", false);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const { data: wastageTxns } = await supabaseServer
      .from("inventory_transactions")
      .select("quantity")
      .eq("is_wastage", true)
      .gte("created_at", thirtyDaysAgo.toISOString());
    const wastageTotal = (wastageTxns ?? []).reduce((sum, t: any) => sum + Number(t.quantity), 0);

    const { data: vendors } = await supabaseServer.from("vendors").select("outstanding_amount");
    const totalVendorOutstanding = (vendors ?? []).reduce(
      (sum, v: any) => sum + Number(v.outstanding_amount),
      0,
    );

    res.json({
      data: {
        item_count: itemCount ?? 0,
        low_stock_count: lowStockCount,
        open_alerts_count: openAlertsCount ?? 0,
        wastage_total_30d: wastageTotal,
        total_vendor_outstanding: totalVendorOutstanding,
      },
    });
  } catch (err) {
    handleErr(res, err, "fetchInstantInventoryReport");
  }
});

// GET /api/inventory/warehouses
inventoryRouter.get("/warehouses", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const { data: warehouses } = await supabaseServer
      .from("inventory_warehouses")
      .select("id, name, location")
      .order("name", { ascending: true });
    res.json({ data: warehouses ?? [] });
  } catch (err) {
    handleErr(res, err, "fetchWarehouses");
  }
});

// POST /api/inventory/warehouses/create
inventoryRouter.post("/warehouses/create", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (!isAdmin(user.role)) {
      res.json({ success: false, error: "Only administrators can manage warehouses" });
      return;
    }
    const { name, code, location } = z
      .object({
        name: z.string().min(1),
        code: z.string().optional(),
        location: z.string().optional(),
      })
      .parse(req.body);
    const { data: wh, error } = await supabaseServer
      .from("inventory_warehouses")
      .insert({
        name: name.trim(),
        code: code?.trim() || null,
        location: location?.trim() || null,
        created_by: user.id,
      })
      .select("id, name")
      .single();
    if (error || !wh) {
      res.json({ success: false, error: "Failed to create warehouse" });
      return;
    }
    await logAction(user, "create_warehouse", "inventory_warehouse", wh.id, { name: wh.name });
    res.json({ success: true, id: wh.id });
  } catch (err) {
    handleErr(res, err, "createWarehouse");
  }
});

// GET /api/inventory/linkage/requisitions
inventoryRouter.get("/linkage/requisitions", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const { data: reqs } = await supabaseServer
      .from("requisitions")
      .select("id, pr_number, po_number, title, stage")
      .order("date", { ascending: false })
      .limit(100);
    res.json({ data: reqs ?? [] });
  } catch (err) {
    handleErr(res, err, "fetchRequisitionsForLinkage");
  }
});

// GET /api/inventory/linkage/gate-passes
inventoryRouter.get("/linkage/gate-passes", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const { data: passes } = await supabaseServer
      .from("gate_passes")
      .select("id, gp_number, material")
      .order("requested_at", { ascending: false })
      .limit(100);
    res.json({ data: passes ?? [] });
  } catch (err) {
    handleErr(res, err, "fetchGatePassesForLinkage");
  }
});

// GET /api/inventory/linkage/batches
inventoryRouter.get("/linkage/batches", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const { data: batches } = await supabaseServer
      .from("batches")
      .select("id, batch_number, material_name, status")
      .order("created_at", { ascending: false })
      .limit(100);
    res.json({ data: batches ?? [] });
  } catch (err) {
    handleErr(res, err, "fetchBatchesForLinkage");
  }
});

// GET /api/inventory/vendors
inventoryRouter.get("/vendors", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const { data: vendors } = await supabaseServer
      .from("vendors")
      .select("id, name")
      .order("name", { ascending: true });
    res.json({ data: vendors ?? [] });
  } catch (err) {
    handleErr(res, err, "fetchVendorsForInventory");
  }
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

// GET /api/inventory/export/stock-register
inventoryRouter.get("/export/stock-register", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (!isAdmin(user.role)) {
      res.json({ success: false, error: "Only administrators can export" });
      return;
    }
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
    res.json({ success: true, csv: toCSV(rows) });
  } catch (err) {
    handleErr(res, err, "exportStockRegisterCSV");
  }
});

// GET /api/inventory/export/item-ledger
inventoryRouter.get("/export/item-ledger", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (!isAdmin(user.role)) {
      res.json({ success: false, error: "Only administrators can export" });
      return;
    }
    const itemId = z.string().uuid().parse(req.query["itemId"]);
    const fromDate = req.query["fromDate"] as string | undefined;
    const toDate = req.query["toDate"] as string | undefined;

    let query = supabaseServer
      .from("inventory_transactions")
      .select("type, quantity, adjustment_direction, reference, remarks, created_at")
      .eq("item_id", itemId)
      .order("created_at", { ascending: false });
    if (fromDate) query = query.gte("created_at", fromDate);
    if (toDate) query = query.lte("created_at", toDate);
    const { data: txns } = await query;
    const rows = (txns ?? []).map((t: any) => ({
      Date: new Date(t.created_at).toLocaleString("en-IN"),
      Type: t.type + (t.adjustment_direction ? ` ${t.adjustment_direction}` : ""),
      Quantity: t.quantity,
      Reference: t.reference ?? "",
      Remarks: t.remarks ?? "",
    }));
    res.json({ success: true, csv: toCSV(rows) });
  } catch (err) {
    handleErr(res, err, "exportItemLedgerCSV");
  }
});

// GET /api/inventory/export/low-stock
inventoryRouter.get("/export/low-stock", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (!isAdmin(user.role)) {
      res.json({ success: false, error: "Only administrators can export" });
      return;
    }
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
    res.json({ success: true, csv: toCSV(rows) });
  } catch (err) {
    handleErr(res, err, "exportLowStockCSV");
  }
});

// ---------------------------------------------------------------------------
// Inventory Portal — new UX endpoints
// ---------------------------------------------------------------------------

// GET /api/inventory/portal/items
// Lists materials with purchased / used / balance totals, filtered by warehouse,
// category tree, search, and date range.
const portalItemsSchema = z.object({
  warehouse_id: z.string().uuid().optional(),
  category_id: z.string().uuid().optional(),
  search: z.string().optional(),
  from_date: z.string().optional(),
  to_date: z.string().optional(),
  page: z.coerce.number().optional(),
  page_size: z.coerce.number().optional(),
});

inventoryRouter.get("/portal/items", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const data = portalItemsSchema.parse(req.query);
    const page = data.page ?? 1;
    const pageSize = data.page_size ?? 50;
    const offset = (page - 1) * pageSize;

    let itemQuery = supabaseServer
      .from("inventory_items")
      .select(
        "id, name, unit_of_measure, reorder_level, opening_stock, category_id, default_warehouse_id, archived",
        { count: "exact" },
      )
      .eq("archived", false)
      .order("name", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (data.warehouse_id) itemQuery = itemQuery.eq("default_warehouse_id", data.warehouse_id);
    if (data.category_id) itemQuery = itemQuery.eq("category_id", data.category_id);
    if (data.search) itemQuery = itemQuery.ilike("name", `%${data.search.trim()}%`);

    const { data: items, count, error: itemsErr } = await itemQuery;
    if (itemsErr) {
      res.json({ success: false, error: itemsErr.message });
      return;
    }

    const itemIds = (items ?? []).map((i: any) => i.id);
    if (itemIds.length === 0) {
      res.json({ data: [], total: 0, page, pageSize, totalPages: 0 });
      return;
    }

    // Build category path for each item
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

    // Aggregate transactions
    let txQuery = supabaseServer
      .from("inventory_transactions")
      .select("item_id, type, quantity, transaction_date")
      .in("item_id", itemIds)
      .eq("reversed", false);
    if (data.from_date) txQuery = txQuery.gte("transaction_date", data.from_date);
    if (data.to_date) txQuery = txQuery.lte("transaction_date", data.to_date);
    const { data: txns } = await txQuery;

    const totalsByItem = new Map<string, { purchased: number; used: number }>();
    for (const t of txns ?? []) {
      const cur = totalsByItem.get(t.item_id) ?? { purchased: 0, used: 0 };
      if (t.type === "in") cur.purchased += Number(t.quantity);
      else if (t.type === "out") cur.used += Number(t.quantity);
      totalsByItem.set(t.item_id, cur);
    }

    const { data: stockRows } = await supabaseServer
      .from("inventory_stock_levels")
      .select("item_id, current_stock")
      .in("item_id", itemIds);
    const stockMap = new Map((stockRows ?? []).map((s: any) => [s.item_id, Number(s.current_stock)]));

    const resData = (items ?? []).map((i: any) => {
      const totals = totalsByItem.get(i.id) ?? { purchased: 0, used: 0 };
      const balance = stockMap.get(i.id) ?? Number(i.opening_stock);
      const low = Number(i.reorder_level) > 0 && balance <= Number(i.reorder_level);
      return {
        item_id: i.id,
        item_name: i.name,
        unit_of_measure: i.unit_of_measure,
        reorder_level: Number(i.reorder_level),
        category_id: i.category_id,
        category_path: buildPath(i.category_id),
        warehouse_id: i.default_warehouse_id,
        total_purchased: totals.purchased,
        total_used: totals.used,
        current_balance: balance,
        status: low ? "Low" : balance === 0 ? "Out" : "OK",
      };
    });

    res.json({
      data: resData,
      total: count ?? 0,
      page,
      pageSize,
      totalPages: Math.ceil((count ?? 0) / pageSize),
    });
  } catch (err) {
    handleErr(res, err, "fetchPortalItems");
  }
});

// GET /api/inventory/portal/ledger
// Returns a daily chronological ledger with opening, purchase, total, usage, closing.
const portalLedgerSchema = z.object({
  item_id: z.string().uuid(),
  from_date: z.string().optional(),
  to_date: z.string().optional(),
});

inventoryRouter.get("/portal/ledger", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const data = portalLedgerSchema.parse(req.query);

    const { data: item } = await supabaseServer
      .from("inventory_items")
      .select("id, name, unit_of_measure, opening_stock")
      .eq("id", data.item_id)
      .single();
    if (!item) {
      res.json({ success: false, error: "Item not found" });
      return;
    }

    let txQuery = supabaseServer
      .from("inventory_transactions")
      .select(
        "id, type, quantity, unit_cost, transaction_date, vendor_id, invoice_number, flat_no, purpose, remarks, reference, created_at",
      )
      .eq("item_id", data.item_id)
      .eq("reversed", false)
      .order("transaction_date", { ascending: true })
      .order("created_at", { ascending: true });
    if (data.from_date) txQuery = txQuery.gte("transaction_date", data.from_date);
    if (data.to_date) txQuery = txQuery.lte("transaction_date", data.to_date);
    const { data: txns, error: txErr } = await txQuery;
    if (txErr) {
      res.json({ success: false, error: txErr.message });
      return;
    }

    const vendorIds = [...new Set((txns ?? []).filter((t: any) => t.vendor_id).map((t: any) => t.vendor_id))];
    let vendorMap = new Map<string, string>();
    if (vendorIds.length > 0) {
      const { data: vendors } = await supabaseServer
        .from("vendors")
        .select("id, name")
        .in("id", vendorIds);
      vendorMap = new Map((vendors ?? []).map((v: any) => [v.id, v.name]));
    }

    // Group by date and compute running balances
    const dayGroups = new Map<string, any[]>();
    for (const t of txns ?? []) {
      const d = t.transaction_date;
      const list = dayGroups.get(d) ?? [];
      list.push(t);
      dayGroups.set(d, list);
    }

    const sortedDates = [...dayGroups.keys()].sort();
    let runningBalance = Number(item.opening_stock);
    const rows = [];
    for (const date of sortedDates) {
      const dayTx = dayGroups.get(date)!;
      const opening = runningBalance;
      const purchase = dayTx
        .filter((t: any) => t.type === "in")
        .reduce((sum: number, t: any) => sum + Number(t.quantity), 0);
      const usage = dayTx
        .filter((t: any) => t.type === "out")
        .reduce((sum: number, t: any) => sum + Number(t.quantity), 0);
      const total = opening + purchase;
      const closing = total - usage;
      runningBalance = closing;
      rows.push({
        date,
        opening,
        purchase,
        total,
        usage,
        closing,
        transactions: dayTx.map((t: any) => ({
          id: t.id,
          type: t.type,
          quantity: Number(t.quantity),
          rate_per_unit: Number(t.unit_cost) || null,
          vendor_id: t.vendor_id,
          vendor_name: t.vendor_id ? (vendorMap.get(t.vendor_id) ?? "—") : null,
          invoice_number: t.invoice_number,
          flat_no: t.flat_no,
          purpose: t.purpose,
          remarks: t.remarks,
          reference: t.reference,
        })),
      });
    }

    const totalPurchased = (txns ?? [])
      .filter((t: any) => t.type === "in")
      .reduce((sum: number, t: any) => sum + Number(t.quantity), 0);
    const totalUsed = (txns ?? [])
      .filter((t: any) => t.type === "out")
      .reduce((sum: number, t: any) => sum + Number(t.quantity), 0);

    res.json({
      item_id: item.id,
      item_name: item.name,
      unit_of_measure: item.unit_of_measure,
      opening_stock: Number(item.opening_stock),
      current_balance: runningBalance,
      total_purchased: totalPurchased,
      total_used: totalUsed,
      rows,
    });
  } catch (err) {
    handleErr(res, err, "fetchPortalLedger");
  }
});

// GET /api/inventory/portal/opening-balance
// Computes the balance that would be carried forward as the opening balance for
// the given date (i.e. balance after all transactions strictly before that date).
const openingBalanceSchema = z.object({
  item_id: z.string().uuid(),
  date: z.string(),
});

inventoryRouter.get("/portal/opening-balance", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const data = openingBalanceSchema.parse(req.query);

    const { data: item } = await supabaseServer
      .from("inventory_items")
      .select("opening_stock")
      .eq("id", data.item_id)
      .single();
    if (!item) {
      res.json({ success: false, error: "Item not found" });
      return;
    }

    const { data: txns } = await supabaseServer
      .from("inventory_transactions")
      .select("type, quantity")
      .eq("item_id", data.item_id)
      .eq("reversed", false)
      .lt("transaction_date", data.date);

    let balance = Number(item.opening_stock);
    for (const t of txns ?? []) {
      if (t.type === "in") balance += Number(t.quantity);
      else if (t.type === "out") balance -= Number(t.quantity);
      else if (t.type === "adjustment") balance += Number(t.quantity);
    }

    res.json({ success: true, opening_balance: balance });
  } catch (err) {
    handleErr(res, err, "fetchPortalOpeningBalance");
  }
});

// POST /api/inventory/portal/entry
// Records one "Next Entry": purchase (in) and/or usage (out) on the same date.
const portalEntrySchema = z.object({
  item_id: z.string().uuid(),
  transaction_date: z.string(),
  opening_balance: z.number().optional(), // informational only, not stored
  purchase_qty: z.number().min(0).optional(),
  usage_qty: z.number().min(0).optional(),
  vendor_id: z.string().uuid().nullable().optional(),
  rate_per_unit: z.number().min(0).optional(),
  invoice_number: z.string().optional(),
  warehouse_id: z.string().uuid().nullable().optional(),
  flat_no: z.string().optional(),
  purpose: z.string().optional(),
  notes: z.string().optional(),
});

inventoryRouter.post("/portal/entry", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = portalEntrySchema.parse(req.body);

    if ((!data.purchase_qty || data.purchase_qty <= 0) && (!data.usage_qty || data.usage_qty <= 0)) {
      res.json({ success: false, error: "Enter purchase quantity or usage quantity" });
      return;
    }

    const { data: item } = await supabaseServer
      .from("inventory_items")
      .select("id, name")
      .eq("id", data.item_id)
      .single();
    if (!item) {
      res.json({ success: false, error: "Item not found" });
      return;
    }

    const common = {
      item_id: data.item_id,
      transaction_date: data.transaction_date,
      vendor_id: data.vendor_id ?? null,
      unit_cost: data.rate_per_unit ?? 0,
      invoice_number: data.invoice_number?.trim() || null,
      flat_no: data.flat_no?.trim() || null,
      purpose: data.purpose?.trim() || null,
      warehouse_id: data.warehouse_id ?? null,
      created_by: user.id,
    };

    const inserted: string[] = [];

    if (data.purchase_qty && data.purchase_qty > 0) {
      const { data: tx, error } = await supabaseServer
        .from("inventory_transactions")
        .insert({
          ...common,
          type: "in",
          quantity: data.purchase_qty,
          reference: data.invoice_number?.trim() || null,
          remarks: data.notes?.trim() || null,
        })
        .select("id")
        .single();
      if (error || !tx) {
        res.json({ success: false, error: error?.message || "Failed to record purchase" });
        return;
      }
      inserted.push(tx.id);
    }

    if (data.usage_qty && data.usage_qty > 0) {
      // Check stock before usage
      const { data: stockRow } = await supabaseServer
        .from("inventory_stock_levels")
        .select("current_stock")
        .eq("item_id", data.item_id)
        .single();
      const currentStock = Number(stockRow?.current_stock ?? 0);
      if (currentStock < data.usage_qty) {
        res.json({
          success: false,
          error: `Insufficient stock. Current balance is ${currentStock}, attempted usage ${data.usage_qty}.`,
        });
        return;
      }
      const { data: tx, error } = await supabaseServer
        .from("inventory_transactions")
        .insert({
          ...common,
          type: "out",
          quantity: data.usage_qty,
          remarks: data.notes?.trim() || null,
        })
        .select("id")
        .single();
      if (error || !tx) {
        res.json({ success: false, error: error?.message || "Failed to record usage" });
        return;
      }
      inserted.push(tx.id);
    }

    await logAction(user, "portal_inventory_entry", "inventory_transaction", item.id, {
      item_id: data.item_id,
      date: data.transaction_date,
      purchase: data.purchase_qty ?? 0,
      usage: data.usage_qty ?? 0,
    });
    res.json({ success: true, ids: inserted });
  } catch (err) {
    handleErr(res, err, "recordPortalEntry");
  }
});

// POST /api/inventory/portal/items/create
// Creates a material attached to a leaf category. If the category path does not
// exist, it creates the missing nodes (admin only).
const portalItemCreateSchema = z.object({
  name: z.string().min(1),
  unit: z.string().min(1),
  reorder_level: z.number().min(0).default(0),
  category: z.string().min(1),
  type: z.string().optional(),
  subcategory: z.string().optional(),
  subtype: z.string().optional(),
  warehouse_id: z.string().uuid().nullable().optional(),
});

inventoryRouter.post("/portal/items/create", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (!isAdmin(user.role)) {
      res.json({ success: false, error: "Only administrators can create materials" });
      return;
    }
    const data = portalItemCreateSchema.parse(req.body);

    // Fetch or create the category chain
    async function findOrCreateNode(
      name: string,
      level: string,
      parentId: string | null,
    ): Promise<string> {
      let query = supabaseServer
        .from("inventory_categories")
        .select("id")
        .eq("name", name.trim())
        .eq("level", level);
      if (parentId) query = query.eq("parent_id", parentId);
      else query = query.is("parent_id", null);
      const { data: existing } = await query.single();
      if (existing) return existing.id;

      const { data: created, error } = await supabaseServer
        .from("inventory_categories")
        .insert({ name: name.trim(), level, parent_id: parentId, created_by: user.id })
        .select("id")
        .single();
      if (error || !created) throw new Error(`Failed to create ${level}: ${error?.message}`);
      return created.id;
    }

    let parentId: string | null = null;
    parentId = await findOrCreateNode(data.category, "category", null);
    if (data.type?.trim()) parentId = await findOrCreateNode(data.type, "type", parentId);
    if (data.subcategory?.trim()) parentId = await findOrCreateNode(data.subcategory, "subcategory", parentId);
    if (data.subtype?.trim()) parentId = await findOrCreateNode(data.subtype, "subtype", parentId);

    const { data: item, error } = await supabaseServer
      .from("inventory_items")
      .insert({
        name: data.name.trim(),
        unit_of_measure: data.unit.trim(),
        reorder_level: data.reorder_level,
        category_id: parentId!,
        default_warehouse_id: data.warehouse_id ?? null,
        created_by: user.id,
      })
      .select("id, name")
      .single();
    if (error || !item) {
      res.json({ success: false, error: error?.message || "Failed to create material" });
      return;
    }

    await logAction(user, "create_portal_inventory_item", "inventory_item", item.id, {
      name: item.name,
      category_id: parentId,
    });
    res.json({ success: true, id: item.id });
  } catch (err) {
    handleErr(res, err, "createPortalItem");
  }
});

// POST /api/inventory/portal/vendors/create
// Quick vendor creation from inside the portal entry form.
const portalVendorSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
});

inventoryRouter.post("/portal/vendors/create", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (user.role === "Supervisor") {
      res.json({ success: false, error: "Supervisors cannot create vendors" });
      return;
    }
    const data = portalVendorSchema.parse(req.body);
    const { data: vendor, error } = await supabaseServer
      .from("vendors")
      .insert({
        name: data.name.trim(),
        phone: data.phone?.trim() || null,
        total_amount: 0,
        amount_paid: 0,
        outstanding_amount: 0,
      })
      .select("id, name")
      .single();
    if (error || !vendor) {
      res.json({ success: false, error: error?.message || "Failed to create vendor" });
      return;
    }
    await logAction(user, "create_portal_vendor", "vendor", vendor.id, { name: vendor.name });
    res.json({ success: true, id: vendor.id, name: vendor.name });
  } catch (err) {
    handleErr(res, err, "createPortalVendor");
  }
});

export default inventoryRouter;
