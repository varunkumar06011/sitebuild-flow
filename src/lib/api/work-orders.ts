// Frontend API wrapper for work-orders calls.
// These functions call the Express API server instead of TanStack server functions.
import { api } from "../api-client";

export type WorkOrderStatus =
  | "Draft"
  | "Sent"
  | "Approved"
  | "Assigned"
  | "In Progress"
  | "Completed"
  | "Closed"
  | "Cancelled";

export type WorkOrderItemRow = {
  id: string;
  description: string;
  quantity: number;
  taxable: boolean;
  unit_price: number;
  total: number;
  sort_order: number;
};

export type WorkOrderRow = {
  id: string;
  order_number: string;
  order_date: string;
  status: WorkOrderStatus;
  block_id: string | null;
  project_name: string | null;
  project_id: string | null;
  site_name: string | null;
  site_address: string | null;
  customer_name: string | null;
  customer_id: string | null;
  customer_contact: string | null;
  billing_address: string | null;
  billing_city: string | null;
  billing_state: string | null;
  billing_pincode: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  requested_by: string;
  requested_by_name: string | null;
  department: string | null;
  assigned_supervisor_id: string | null;
  assigned_supervisor_name: string | null;
  assigned_at: string | null;
  work_description: string | null;
  subtotal: number;
  taxable_amount: number;
  tax_rate: number;
  tax_amount: number;
  shipping_handling: number;
  other_charges: number;
  grand_total: number;
  payment_terms: string | null;
  due_date: string | null;
  advance_amount: number;
  balance_due: number;
  comments: string | null;
  work_category: string;
  completed_date: string | null;
  completed_by_name: string | null;
  customer_acknowledgement: string | null;
  pdf_path: string | null;
  items: WorkOrderItemRow[];
  created_at: string;
  updated_at: string;
};

// GET /api/work-orders
export function fetchWorkOrders(data?: {
  page?: number;
  limit?: number;
  status?: string;
  supervisorId?: string;
  search?: string;
  workCategory?: string;
}): Promise<{ data: WorkOrderRow[]; total: number; page: number; limit: number }> {
  return api.get("/api/work-orders", data);
}

// GET /api/work-orders/:id
export function fetchWorkOrder(data: {
  id: string;
}): Promise<{ success: boolean; error?: string; data?: any }> {
  return api.get(`/api/work-orders/${data.id}`);
}

// POST /api/work-orders/create
export function createWorkOrder(data: {
  block_id?: string | null;
  project_name?: string;
  site_name?: string;
  site_address?: string;
  customer_name?: string;
  customer_id?: string;
  customer_contact?: string;
  billing_address?: string;
  billing_city?: string;
  billing_state?: string;
  billing_pincode?: string;
  customer_phone?: string;
  customer_email?: string;
  department?: string;
  work_description?: string;
  tax_rate: number;
  shipping_handling: number;
  other_charges: number;
  payment_terms?: string;
  due_date?: string | null;
  advance_amount: number;
  comments?: string;
  work_category?: string;
  assigned_supervisor_id?: string | null;
  items: {
    description: string;
    quantity: number;
    taxable: boolean;
    unit_price: number;
  }[];
}): Promise<{ success: boolean; error?: string; id?: string; order_number?: string }> {
  return api.post("/api/work-orders/create", data);
}

// POST /api/work-orders/update
export function updateWorkOrder(data: {
  id: string;
  block_id?: string | null;
  project_name?: string;
  site_name?: string;
  site_address?: string;
  customer_name?: string;
  customer_id?: string;
  customer_contact?: string;
  billing_address?: string;
  billing_city?: string;
  billing_state?: string;
  billing_pincode?: string;
  customer_phone?: string;
  customer_email?: string;
  department?: string;
  work_description?: string;
  tax_rate?: number;
  shipping_handling?: number;
  other_charges?: number;
  payment_terms?: string;
  due_date?: string | null;
  advance_amount?: number;
  comments?: string;
  work_category?: string;
  assigned_supervisor_id?: string | null;
  items?: {
    description: string;
    quantity: number;
    taxable: boolean;
    unit_price: number;
  }[];
}): Promise<{ success: boolean; error?: string; id?: string; order_number?: string }> {
  return api.post("/api/work-orders/update", data);
}

// POST /api/work-orders/status
export function updateWorkOrderStatus(data: {
  id: string;
  status: WorkOrderStatus;
  completed_by_name?: string;
  customer_acknowledgement?: string;
}): Promise<{ success: boolean; error?: string }> {
  return api.post("/api/work-orders/status", data);
}

// GET /api/work-orders/supervisors/list
export function fetchSupervisors(): Promise<{
  data: { id: string; name: string; phone: string | null }[];
}> {
  return api.get("/api/work-orders/supervisors/list");
}

// ---------------------------------------------------------------------------
// Generate WhatsApp message text (pure client-side utility)
// ---------------------------------------------------------------------------
export function buildWorkOrderWhatsAppMessage(order: WorkOrderRow): string {
  const lines: string[] = [];
  lines.push(`Work Order – ${order.order_number}`);
  lines.push("");
  lines.push(`Project: ${order.project_name ?? "—"}`);
  lines.push(`Site: ${order.site_name ?? "—"}`);
  lines.push(`Customer: ${order.customer_name ?? "—"}`);
  lines.push(`Supervisor: ${order.assigned_supervisor_name ?? "—"}`);
  lines.push("");
  if (order.work_description) {
    lines.push("Work:");
    lines.push(order.work_description);
    lines.push("");
  }
  lines.push("Please refer to the complete Work Order for details.");
  return lines.join("\n");
}
