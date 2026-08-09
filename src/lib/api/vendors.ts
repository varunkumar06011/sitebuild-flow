// Frontend API wrapper for vendor calls.
// These functions call the Express API server instead of TanStack server functions.
import { api } from "../api-client";

const PAYMENT_METHODS = ["Cash", "Cheque", "UPI", "NEFT", "RTGS", "IMPS"] as const;

// GET /api/vendors/fetch
export function fetchVendors(data: {
  page?: number;
  limit?: number;
  search?: string;
  workCategory?: string;
}): Promise<{ data: any[]; total: number; page: number; limit: number }> {
  return api.get("/api/vendors/fetch", data);
}

// POST /api/vendors/create
export function createVendor(data: {
  name: string;
  gst_number?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  phone?: string;
  email?: string;
  materials_purchased?: string;
  total_amount?: number;
  payment_method?: (typeof PAYMENT_METHODS)[number];
  work_category?: string;
}): Promise<{ success: boolean; error?: string; id?: string }> {
  return api.post("/api/vendors/create", data);
}

// POST /api/vendors/update
export function updateVendor(data: {
  id: string;
  name?: string;
  gst_number?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  phone?: string;
  email?: string;
  materials_purchased?: string;
  total_amount?: number;
  payment_method?: (typeof PAYMENT_METHODS)[number];
  work_category?: string;
}): Promise<{ success: boolean; error?: string }> {
  return api.post("/api/vendors/update", data);
}

// GET /api/vendors/payments
export function fetchVendorPayments(
  data: { vendorId: string },
): Promise<{ data: any[] }> {
  return api.get("/api/vendors/payments", data);
}

// GET /api/vendors/payments/all
export function fetchAllVendorPayments(data: {
  page?: number;
  limit?: number;
}): Promise<{ data: any[]; total: number; page: number; limit: number }> {
  return api.get("/api/vendors/payments/all", data);
}

// POST /api/vendors/payments/add
export function addVendorPayment(data: {
  vendor_id: string;
  amount: number;
  payment_type: (typeof PAYMENT_METHODS)[number];
  approved_by: string;
  proof_path: string;
  payment_date?: string;
  reference_number?: string;
  status?: "pending" | "paid";
  notes?: string;
}): Promise<{ success: boolean; error?: string; id?: string }> {
  return api.post("/api/vendors/payments/add", data);
}

// POST /api/vendors/payments/update
export function updateVendorPayment(data: {
  payment_id: string;
  amount?: number;
  payment_type?: (typeof PAYMENT_METHODS)[number];
  approved_by?: string;
  proof_path?: string;
  payment_date?: string;
  reference_number?: string;
  status?: "pending" | "paid";
  notes?: string;
}): Promise<{ success: boolean; error?: string }> {
  return api.post("/api/vendors/payments/update", data);
}

// GET /api/vendors/payments/audit
export function fetchPaymentAuditTrail(
  data: { paymentId: string },
): Promise<{ data: any[] }> {
  return api.get("/api/vendors/payments/audit", data);
}

// GET /api/vendors/approvable-users
export function fetchApprovableUsers(): Promise<{ data: any[] }> {
  return api.get("/api/vendors/approvable-users");
}

// GET /api/vendors/material-categories
export function fetchMaterialCategories(): Promise<{ data: any[] }> {
  return api.get("/api/vendors/material-categories");
}

// POST /api/vendors/material-categories/create
export function createMaterialCategory(
  data: { name: string },
): Promise<{ success: boolean; error?: string; id?: string; name?: string }> {
  return api.post("/api/vendors/material-categories/create", data);
}
