// Frontend API wrapper for inventory calls.
// These functions call the Express API server instead of TanStack server functions.
import { api } from "../api-client";

// GET /api/inventory/category-tree
export function fetchCategoryTree(): Promise<{ data: any[] }> {
  return api.get("/api/inventory/category-tree");
}

// POST /api/inventory/category/create
export function createCategoryNode(data: {
  name: string;
  level: "category" | "type" | "subcategory" | "subtype";
  parent_id: string | null;
  sort_order?: number;
}): Promise<{ success: boolean; error?: string; node?: any }> {
  return api.post("/api/inventory/category/create", data);
}

// POST /api/inventory/category/update
export function updateCategoryNode(data: {
  id: string;
  name: string;
}): Promise<{ success: boolean; error?: string }> {
  return api.post("/api/inventory/category/update", data);
}

// POST /api/inventory/category/archive
export function archiveCategoryNode(data: {
  id: string;
}): Promise<{ success: boolean; error?: string }> {
  return api.post("/api/inventory/category/archive", data);
}

// GET /api/inventory/items
export function fetchItems(data: {
  search?: string;
  workCategory?: string;
  category_id?: string;
  includeArchived?: boolean;
  page?: number;
  pageSize?: number;
}): Promise<{
  data: any[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  return api.get("/api/inventory/items", data);
}

// POST /api/inventory/items/create
export function createItem(data: {
  category_id: string;
  name: string;
  unit_of_measure?: string;
  reorder_level?: number;
  reorder_qty?: number;
  unit_cost?: number;
  opening_stock?: number;
  work_category?: string;
  supplier_id?: string | null;
  default_warehouse_id?: string | null;
}): Promise<{ success: boolean; error?: string; id?: string }> {
  return api.post("/api/inventory/items/create", data);
}

// POST /api/inventory/items/update
export function updateItem(data: {
  id: string;
  name?: string;
  unit_of_measure?: string;
  reorder_level?: number;
  reorder_qty?: number;
  unit_cost?: number;
  supplier_id?: string | null;
  default_warehouse_id?: string | null;
}): Promise<{ success: boolean; error?: string }> {
  return api.post("/api/inventory/items/update", data);
}

// POST /api/inventory/items/archive
export function archiveItem(data: {
  id: string;
}): Promise<{ success: boolean; error?: string }> {
  return api.post("/api/inventory/items/archive", data);
}

// POST /api/inventory/transactions/record
export function recordTransaction(data: {
  item_id: string;
  type: "in" | "out" | "adjustment" | "transfer";
  quantity: number;
  is_wastage?: boolean;
  block_id?: string | null;
  reference?: string;
  remarks?: string;
  adjustment_direction?: "up" | "down";
  warehouse_id?: string | null;
  transfer_from_block_id?: string | null;
  transfer_to_block_id?: string | null;
  unit_cost?: number;
  linked_requisition_id?: string | null;
  linked_gate_pass_id?: string | null;
  linked_batch_id?: string | null;
}): Promise<{ success: boolean; error?: string; id?: string }> {
  return api.post("/api/inventory/transactions/record", data);
}

// POST /api/inventory/transactions/reverse
export function reverseTransaction(data: {
  transaction_id: string;
  reason?: string;
}): Promise<{ success: boolean; error?: string; reversal_id?: string }> {
  return api.post("/api/inventory/transactions/reverse", data);
}

// GET /api/inventory/stock-levels
export function fetchStockLevels(): Promise<{ data: any[] }> {
  return api.get("/api/inventory/stock-levels");
}

// GET /api/inventory/low-stock
export function fetchLowStockAlerts(): Promise<{ data: any[] }> {
  return api.get("/api/inventory/low-stock");
}

// GET /api/inventory/item-ledger
export function fetchItemLedger(data: {
  itemId: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
}): Promise<{
  data: any[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  return api.get("/api/inventory/item-ledger", data);
}

// GET /api/inventory/blocks
export function fetchBlocks(): Promise<{ data: any[] }> {
  return api.get("/api/inventory/blocks");
}

// GET /api/inventory/alerts
export function fetchInventoryAlerts(data: {
  resolved?: boolean;
}): Promise<{ data: any[] }> {
  return api.get("/api/inventory/alerts", data);
}

// POST /api/inventory/alerts/resolve
export function resolveInventoryAlert(data: {
  alertId: string;
}): Promise<{ success: boolean; error?: string }> {
  return api.post("/api/inventory/alerts/resolve", data);
}

// GET /api/inventory/wastage-report
export function fetchWastageReport(data: {
  fromDate?: string;
  toDate?: string;
}): Promise<{ data: any[] }> {
  return api.get("/api/inventory/wastage-report", data);
}

// GET /api/inventory/stock-projections
export function fetchStockProjections(): Promise<{ data: any[] }> {
  return api.get("/api/inventory/stock-projections");
}

// POST /api/inventory/budgets/set
export function setItemBudget(data: {
  item_id: string;
  budget_qty: number;
  budget_value?: number;
  alert_threshold_pct?: number;
}): Promise<{ success: boolean; error?: string; id?: string }> {
  return api.post("/api/inventory/budgets/set", data);
}

// GET /api/inventory/budgets
export function fetchBudgets(): Promise<{ data: any[] }> {
  return api.get("/api/inventory/budgets");
}

// GET /api/inventory/budgets/item
export function fetchItemBudget(data: {
  itemId: string;
}): Promise<{ data: any }> {
  return api.get("/api/inventory/budgets/item", data);
}

// GET /api/inventory/instant-report
export function fetchInstantInventoryReport(): Promise<{ data: any }> {
  return api.get("/api/inventory/instant-report");
}

// GET /api/inventory/warehouses
export function fetchWarehouses(): Promise<{ data: any[] }> {
  return api.get("/api/inventory/warehouses");
}

// POST /api/inventory/warehouses/create
export function createWarehouse(data: {
  name: string;
  code?: string;
  location?: string;
}): Promise<{ success: boolean; error?: string; id?: string }> {
  return api.post("/api/inventory/warehouses/create", data);
}

// GET /api/inventory/linkage/requisitions
export function fetchRequisitionsForLinkage(): Promise<{ data: any[] }> {
  return api.get("/api/inventory/linkage/requisitions");
}

// GET /api/inventory/linkage/gate-passes
export function fetchGatePassesForLinkage(): Promise<{ data: any[] }> {
  return api.get("/api/inventory/linkage/gate-passes");
}

// GET /api/inventory/linkage/batches
export function fetchBatchesForLinkage(): Promise<{ data: any[] }> {
  return api.get("/api/inventory/linkage/batches");
}

// GET /api/inventory/vendors
export function fetchVendorsForInventory(): Promise<{ data: any[] }> {
  return api.get("/api/inventory/vendors");
}

// GET /api/inventory/export/stock-register
export function exportStockRegisterCSV(): Promise<{
  success: boolean;
  error?: string;
  csv?: string;
}> {
  return api.get("/api/inventory/export/stock-register");
}

// GET /api/inventory/export/item-ledger
export function exportItemLedgerCSV(data: {
  itemId: string;
  fromDate?: string;
  toDate?: string;
}): Promise<{ success: boolean; error?: string; csv?: string }> {
  return api.get("/api/inventory/export/item-ledger", data);
}

// GET /api/inventory/export/low-stock
export function exportLowStockCSV(): Promise<{
  success: boolean;
  error?: string;
  csv?: string;
}> {
  return api.get("/api/inventory/export/low-stock");
}
