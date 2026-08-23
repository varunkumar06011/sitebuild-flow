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
  domain?: "civil" | "structural" | "uncategorized";
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
  domain?: "civil" | "structural" | "uncategorized";
  supplier_id?: string | null;
  default_warehouse_id?: string | null;
  tracking_mode?: "normal" | "consumable" | "asset" | "batch" | "expiry" | "serialized";
  batch_tracking?: boolean;
  expiry_tracking?: boolean;
  serial_tracking?: boolean;
  asset_tracking?: boolean;
  expiry_enforced?: boolean;
  fefo_enabled?: boolean;
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
  tracking_mode?: "normal" | "consumable" | "asset" | "batch" | "expiry" | "serialized";
  batch_tracking?: boolean;
  expiry_tracking?: boolean;
  serial_tracking?: boolean;
  asset_tracking?: boolean;
  expiry_enforced?: boolean;
  fefo_enabled?: boolean;
}): Promise<{ success: boolean; error?: string }> {
  return api.post("/api/inventory/items/update", data);
}

// POST /api/inventory/items/archive
export function archiveItem(data: { id: string }): Promise<{ success: boolean; error?: string }> {
  return api.post("/api/inventory/items/archive", data);
}

// POST /api/inventory/transactions/record
export function recordTransaction(data: {
  item_id: string;
  type: "in" | "out" | "adjustment" | "transfer" | "return";
  quantity: number;
  domain?: "civil" | "structural" | "uncategorized";
  is_wastage?: boolean;
  block_id?: string | null;
  reference?: string;
  remarks?: string;
  adjustment_direction?: "up" | "down";
  warehouse_id?: string | null;
  location_id?: string | null;
  destination_warehouse_id?: string | null;
  destination_location_id?: string | null;
  transfer_from_block_id?: string | null;
  transfer_to_block_id?: string | null;
  unit_cost?: number;
  linked_requisition_id?: string | null;
  linked_gate_pass_id?: string | null;
  linked_batch_id?: string | null;
}): Promise<{ success: boolean; error?: string; id?: string }> {
  return api.post("/api/inventory/transactions/record", data);
}

// GET /api/inventory/receipts
export function fetchInventoryReceipts(data?: {
  requisitionId?: string;
  itemId?: string;
  grnNumber?: string;
}): Promise<{ data: any[] }> {
  return api.get("/api/inventory/receipts", data);
}

// POST /api/inventory/receipts/record
export function recordInventoryReceipt(data: {
  requisitionId: string;
  itemId: string;
  quantity: number;
  orderedQuantity: number;
  requisitionItemId?: string | null;
  batchId?: string | null;
  warehouseId?: string | null;
  locationId?: string | null;
  unitCost?: number;
  grnNumber?: string;
  invoiceNumber?: string;
  receivedAt?: string;
}): Promise<{ success: boolean; error?: string; id?: string }> {
  return api.post("/api/inventory/receipts/record", data);
}

// GET /api/inventory/locations
export function fetchInventoryLocations(data?: {
  domain?: "civil" | "structural" | "uncategorized";
  parentId?: string;
}): Promise<{ data: any[] }> {
  return api.get("/api/inventory/locations", data);
}

// POST /api/inventory/locations/create
export function createInventoryLocation(data: {
  domain: "civil" | "structural" | "uncategorized";
  parent_id?: string | null;
  name: string;
  code?: string;
  location_type?: string;
  metadata?: Record<string, unknown>;
}): Promise<{ success: boolean; error?: string; location?: any }> {
  return api.post("/api/inventory/locations/create", data);
}

// GET /api/inventory/assets
export function fetchInventoryAssets(data?: { itemId?: string }): Promise<{ data: any[] }> {
  return api.get("/api/inventory/assets", data);
}

// POST /api/inventory/assets/create
export function createInventoryAsset(data: {
  item_id: string;
  asset_number: string;
  serial_number?: string;
  manufacturer?: string;
  model?: string;
  warehouse_id?: string | null;
  location_id?: string | null;
  medical_equipment_id?: string | null;
  warranty_start?: string;
  warranty_end?: string;
  amc_expiry?: string;
  metadata?: Record<string, unknown>;
}): Promise<{ success: boolean; error?: string; asset?: any }> {
  return api.post("/api/inventory/assets/create", data);
}

// POST /api/inventory/assets/from-receipt
export function createAssetFromReceipt(data: {
  receiptId: string;
  assetNumber: string;
  serialNumber?: string;
  createMedicalEquipment?: boolean;
  equipmentNumber?: string;
  manufacturer?: string;
  model?: string;
  warrantyStart?: string;
  warrantyEnd?: string;
  amcExpiry?: string;
  location?: string;
  metadata?: Record<string, unknown>;
}): Promise<{ success: boolean; error?: string; id?: string }> {
  return api.post("/api/inventory/assets/from-receipt", data);
}

// GET /api/inventory/equipment-traceability
export function fetchEquipmentTraceability(data: {
  assetId?: string;
  equipmentId?: string;
}): Promise<{ data: any }> {
  return api.get("/api/inventory/equipment-traceability", data);
}

// GET /api/inventory/serials
export function fetchInventorySerials(data?: { itemId?: string }): Promise<{ data: any[] }> {
  return api.get("/api/inventory/serials", data);
}

// POST /api/inventory/serials/create
export function createInventorySerial(data: {
  item_id: string;
  serial_number: string;
  batch_id?: string | null;
  asset_id?: string | null;
  warehouse_id?: string | null;
  location_id?: string | null;
}): Promise<{ success: boolean; error?: string; serial?: any }> {
  return api.post("/api/inventory/serials/create", data);
}

// POST /api/inventory/structural/issues
export function issueStructuralInventory(data: {
  itemId: string;
  quantity: number;
  warehouseId?: string | null;
  sourceLocationId?: string | null;
  destinationLocationId?: string | null;
  batchId?: string | null;
  serialId?: string | null;
  assetId?: string | null;
  unitCost?: number;
  reference?: string;
  remarks?: string;
}): Promise<{ success: boolean; error?: string; id?: string }> {
  return api.post("/api/inventory/structural/issues", data);
}

// POST /api/inventory/structural/returns
export function returnStructuralInventory(data: {
  issueTransactionId: string;
  quantity: number;
  warehouseId?: string | null;
  locationId?: string | null;
  reason?: string;
}): Promise<{ success: boolean; error?: string; id?: string }> {
  return api.post("/api/inventory/structural/returns", data);
}

// POST /api/inventory/consumptions/record
export function recordConsumption(data: {
  item_id: string;
  used_quantity: number;
  wasted_quantity: number;
  warehouse_id?: string | null;
  location_id?: string | null;
  block_id?: string | null;
  floor_id?: string | null;
  cell_id?: string | null;
  work_item_id?: string | null;
  wastage_reason_id?: string | null;
  wastage_reason?: string;
  unit_cost?: number;
  reference?: string;
  remarks?: string;
  reference_type?: string;
  reference_id?: string | null;
}): Promise<{ success: boolean; error?: string; id?: string }> {
  return api.post("/api/inventory/consumptions/record", data);
}

// POST /api/inventory/consumptions/reverse
export function reverseConsumption(data: {
  consumption_id: string;
  used_quantity?: number;
  wasted_quantity?: number;
  reason?: string;
}): Promise<{ success: boolean; error?: string; reversal_id?: string }> {
  return api.post("/api/inventory/consumptions/reverse", data);
}

// GET /api/inventory/consumptions
export function fetchConsumptions(data?: {
  itemId?: string;
  blockId?: string;
  floorId?: string;
  workItemId?: string;
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
  return api.get("/api/inventory/consumptions", data);
}

// GET /api/inventory/wastage-reasons
export function fetchWastageReasons(data?: {
  domain?: "civil" | "structural";
}): Promise<{ data: any[] }> {
  return api.get("/api/inventory/wastage-reasons", data);
}

// POST /api/inventory/wastage-reasons/create
export function createWastageReason(data: {
  domain: "civil" | "structural";
  name: string;
  description?: string;
}): Promise<{ success: boolean; error?: string; reason?: any }> {
  return api.post("/api/inventory/wastage-reasons/create", data);
}

// POST /api/inventory/transactions/reverse
export function reverseTransaction(data: {
  transaction_id: string;
  reason?: string;
  quantity?: number;
}): Promise<{ success: boolean; error?: string; reversal_id?: string }> {
  return api.post("/api/inventory/transactions/reverse", data);
}

// GET /api/inventory/stock-levels
export function fetchStockLevels(): Promise<{ data: any[] }> {
  return api.get("/api/inventory/stock-levels");
}

export type InventoryReportFilters = {
  itemId?: string;
  warehouseId?: string;
  locationId?: string;
  domain?: "civil" | "structural" | "uncategorized";
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
};

// GET /api/inventory/reports/stock-summary
export function fetchInventoryStockSummary(
  data?: InventoryReportFilters,
): Promise<{ data: any[] }> {
  return api.get("/api/inventory/reports/stock-summary", data);
}

// GET /api/inventory/reports/movements
export function fetchInventoryMovementReport(data?: InventoryReportFilters): Promise<{
  data: any[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  return api.get("/api/inventory/reports/movements", data);
}

// GET /api/inventory/reports/daily-register
export function fetchInventoryDailyRegister(
  data?: InventoryReportFilters,
): Promise<{ data: any[] }> {
  return api.get("/api/inventory/reports/daily-register", data);
}

// GET /api/inventory/reports/vendor-purchases
export function fetchInventoryVendorPurchases(
  data?: InventoryReportFilters,
): Promise<{ data: any[] }> {
  return api.get("/api/inventory/reports/vendor-purchases", data);
}

// GET /api/inventory/reports/transfers
export function fetchInventoryTransferReport(
  data?: InventoryReportFilters,
): Promise<{ data: any[] }> {
  return api.get("/api/inventory/reports/transfers", data);
}

// GET /api/inventory/reports/traceability
export function fetchInventoryTraceability(data: {
  itemId?: string;
  transactionId?: string;
  receiptId?: string;
  assetId?: string;
}): Promise<{ data: any }> {
  return api.get("/api/inventory/reports/traceability", data);
}

// GET /api/inventory/stock-balances
export function fetchStockBalances(data?: {
  itemId?: string;
  warehouseId?: string;
  locationId?: string;
  domain?: "civil" | "structural" | "uncategorized";
}): Promise<{ data: any[] }> {
  return api.get("/api/inventory/stock-balances", data);
}

// GET /api/inventory/cost-summary
export function fetchInventoryCostSummary(data?: {
  itemId?: string;
  warehouseId?: string;
  locationId?: string;
  domain?: "civil" | "structural" | "uncategorized";
}): Promise<{ data: any[] }> {
  return api.get("/api/inventory/cost-summary", data);
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
export function fetchInventoryAlerts(data?: {
  resolved?: boolean;
  alertType?:
    | "LOW_STOCK"
    | "REORDER_REQUIRED"
    | "BUDGET_THRESHOLD"
    | "BUDGET_EXCEEDED"
    | "MISSING_COST"
    | "HIGH_WASTAGE";
  domain?: "civil" | "structural" | "uncategorized";
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
  wastage_threshold_pct?: number;
}): Promise<{ success: boolean; error?: string; id?: string }> {
  return api.post("/api/inventory/budgets/set", data);
}

// GET /api/inventory/budgets
export function fetchBudgets(): Promise<{ data: any[] }> {
  return api.get("/api/inventory/budgets");
}

// GET /api/inventory/budgets/item
export function fetchItemBudget(data: { itemId: string }): Promise<{ data: any }> {
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
