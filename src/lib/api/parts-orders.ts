// Frontend API wrapper for parts-orders calls.
// These functions call the Express API server instead of TanStack server functions.
import { api } from "../api-client";

export type PartsOrderStatus =
  | "Draft"
  | "Sent"
  | "Approved"
  | "Ordered"
  | "Partially Received"
  | "Received"
  | "Cancelled";

export type PartsOrderType =
  | "Stock Order"
  | "Project Requirement"
  | "Emergency Requirement"
  | "Replacement"
  | "Other";

export type PartsOrderItemRow = {
  id: string;
  item_id: string | null;
  item_name: string;
  part_number: string | null;
  description: string | null;
  quantity: number;
  unit: string | null;
  required_date: string | null;
  sort_order: number;
};

export type PartsOrderRow = {
  id: string;
  order_number: string;
  order_date: string;
  status: PartsOrderStatus;
  order_type: PartsOrderType;
  block_id: string | null;
  project_name: string | null;
  site_address: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  vendor_phone: string | null;
  vendor_email: string | null;
  vendor_address: string | null;
  vendor_gst: string | null;
  requested_delivery_date: string | null;
  delivery_address: string | null;
  delivery_contact: string | null;
  delivery_phone: string | null;
  shipping_method: string | null;
  shipping_account: string | null;
  requested_by: string;
  requested_by_name: string | null;
  department: string | null;
  comments: string | null;
  work_category: string;
  pdf_path: string | null;
  items: PartsOrderItemRow[];
  created_at: string;
  updated_at: string;
};

// GET /api/parts-orders
export function fetchPartsOrders(data?: {
  page?: number;
  limit?: number;
  status?: string;
  vendorId?: string;
  search?: string;
  workCategory?: string;
}): Promise<{ data: PartsOrderRow[]; total: number; page: number; limit: number }> {
  return api.get("/api/parts-orders", data);
}

// GET /api/parts-orders/:id
export function fetchPartsOrder(data: {
  id: string;
}): Promise<{ success: boolean; error?: string; data?: any }> {
  return api.get(`/api/parts-orders/${data.id}`);
}

// POST /api/parts-orders/create
export function createPartsOrder(data: {
  block_id?: string | null;
  project_name?: string;
  site_address?: string;
  vendor_id?: string | null;
  order_type?: PartsOrderType;
  requested_delivery_date?: string | null;
  delivery_address?: string;
  delivery_contact?: string;
  delivery_phone?: string;
  shipping_method?: string;
  shipping_account?: string;
  department?: string;
  comments?: string;
  work_category?: string;
  items: {
    item_id?: string | null;
    item_name: string;
    part_number?: string;
    description?: string;
    quantity: number;
    unit?: string;
    required_date?: string | null;
  }[];
}): Promise<{ success: boolean; error?: string; id?: string; order_number?: string }> {
  return api.post("/api/parts-orders/create", data);
}

// POST /api/parts-orders/update
export function updatePartsOrder(data: {
  id: string;
  block_id?: string | null;
  project_name?: string;
  site_address?: string;
  vendor_id?: string | null;
  order_type?: PartsOrderType;
  requested_delivery_date?: string | null;
  delivery_address?: string;
  delivery_contact?: string;
  delivery_phone?: string;
  shipping_method?: string;
  shipping_account?: string;
  department?: string;
  comments?: string;
  work_category?: string;
  items?: {
    item_id?: string | null;
    item_name: string;
    part_number?: string;
    description?: string;
    quantity: number;
    unit?: string;
    required_date?: string | null;
  }[];
}): Promise<{ success: boolean; error?: string; id?: string; order_number?: string }> {
  return api.post("/api/parts-orders/update", data);
}

// POST /api/parts-orders/status
export function updatePartsOrderStatus(data: {
  id: string;
  status: PartsOrderStatus;
}): Promise<{ success: boolean; error?: string }> {
  return api.post("/api/parts-orders/status", data);
}

// POST /api/parts-orders/duplicate
export function duplicatePartsOrder(data: {
  id: string;
}): Promise<{ success: boolean; error?: string; id?: string; order_number?: string }> {
  return api.post("/api/parts-orders/duplicate", data);
}

// ---------------------------------------------------------------------------
// Generate WhatsApp message text (pure client-side utility)
// ---------------------------------------------------------------------------
export function buildPartsOrderWhatsAppMessage(order: PartsOrderRow): string {
  const lines: string[] = [];
  lines.push(`Parts Order – ${order.order_number}`);
  lines.push("");
  lines.push(`Project: ${order.project_name ?? "—"}`);
  lines.push(`Site: ${order.site_address ?? "—"}`);
  lines.push(`Vendor: ${order.vendor_name ?? "—"}`);
  lines.push("");
  lines.push("Items:");
  order.items.forEach((it, i) => {
    lines.push(`${i + 1}. ${it.item_name} — ${it.quantity} ${it.unit ?? ""}`);
  });
  lines.push("");
  if (order.requested_delivery_date) {
    lines.push(`Required Date: ${order.requested_delivery_date}`);
  }
  lines.push("Please refer to the generated Parts Order for complete details.");
  return lines.join("\n");
}
