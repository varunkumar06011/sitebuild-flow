// Frontend API wrapper for requisition calls.
// These functions call the Express API server instead of TanStack server functions.
import { api } from "../api-client";
import type { Stage } from "../erp-data";

// Shape of a requisition row returned from the API with vendor and raiser names joined.
export type RequisitionRow = {
  id: string;
  pr_number: string;
  po_number: string | null;
  grn_number: string | null;
  title: string;
  block: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  amount: number;
  stage: Stage;
  raised_by: string;
  raised_by_name: string | null;
  date: string;
  quotations: any[];
  documents: any[];
  delivery_date: string | null;
  quantity_received: number | null;
  invoice_number: string | null;
  invoice_date: string | null;
  invoice_amount: number | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
};

// GET /api/requisitions/fetch
export function fetchRequisitions(data: {
  page?: number;
  limit?: number;
  stage?: string;
  raisedBy?: string;
  search?: string;
}): Promise<{ data: any[]; total: number; page: number; limit: number }> {
  return api.get("/api/requisitions/fetch", data);
}

// POST /api/requisitions/create
export function createRequisition(data: {
  title: string;
  block: string;
  vendor_id: string | null;
  amount: number;
  quotations?: Array<{
    vendor: string;
    vendor_id?: string | null;
    amount: number;
    selected: boolean;
  }>;
  documents?: string[];
}): Promise<{ success: boolean; error?: string; id?: string; pr_number?: string }> {
  return api.post("/api/requisitions/create", data);
}

// POST /api/requisitions/update-details
export function updateRequisitionDetails(data: {
  id: string;
  title?: string;
  block?: string;
  vendor_id?: string | null;
  amount?: number;
  quotations?: Array<{
    vendor: string;
    vendor_id?: string | null;
    amount: number;
    selected: boolean;
  }>;
  documents?: string[];
}): Promise<{ success: boolean; error?: string }> {
  return api.post("/api/requisitions/update-details", data);
}

// POST /api/requisitions/update-stage
export function updateRequisitionStage(data: {
  id: string;
  newStage: string;
  expectedStage: string;
  inventoryItemId?: string | null;
  orderedQuantity?: number;
  quantityReceived?: number;
  deliveryDate?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  invoiceAmount?: number;
  paymentMethod?: "Cash" | "Cheque" | "UPI" | "NEFT" | "RTGS" | "IMPS";
  paymentProofPath?: string;
  paymentReference?: string;
  rejectionReason?: string;
  cancelReason?: string;
}): Promise<{
  success: boolean;
  error?: string;
  po_number?: string;
  grn_number?: string;
}> {
  return api.post("/api/requisitions/update-stage", data);
}

// GET /api/requisitions/history
export function fetchRequisitionHistory(data: { requisitionId: string }): Promise<any[]> {
  return api.get("/api/requisitions/history", data);
}

// GET /api/requisitions/payments
export function fetchRequisitionPayments(data: { requisitionId: string }): Promise<any[]> {
  return api.get("/api/requisitions/payments", data);
}

// POST /api/requisitions/add-payment
export function addRequisitionPayment(data: {
  requisitionId: string;
  vendorId: string;
  amount: number;
  paymentMethod: "Cash" | "Cheque" | "UPI" | "NEFT" | "RTGS" | "IMPS";
  referenceNumber?: string;
  proofPath?: string;
}): Promise<{ success: boolean; error?: string }> {
  return api.post("/api/requisitions/add-payment", data);
}

// GET /api/requisitions/items
export function fetchRequisitionItems(data: { requisitionId: string }): Promise<any[]> {
  return api.get("/api/requisitions/items", data);
}

// POST /api/requisitions/save-items
export function saveRequisitionItems(data: {
  requisitionId: string;
  items: Array<{
    description: string;
    inventory_item_id?: string | null;
    quantity?: number;
    unit?: string | null;
    unit_price?: number;
    amount?: number;
  }>;
}): Promise<{ success: boolean; error?: string }> {
  return api.post("/api/requisitions/save-items", data);
}
