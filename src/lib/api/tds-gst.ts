// Frontend API wrapper for tds-gst calls.
import { api } from "../api-client";

// GET /api/tds-gst/fetch
export function fetchTdsGstRecords(data: {
  recordType?: string;
  status?: string;
  period?: string;
  search?: string;
}): Promise<{
  data: any[];
  total: number;
  summary: {
    tds_total: number;
    gst_input_credit_total: number;
    pending: number;
    filed: number;
    reconciled: number;
  };
}> {
  return api.get("/api/tds-gst/fetch", data);
}

// POST /api/tds-gst/create
export function createTdsGstRecord(data: {
  vendor_id: string;
  vendor_payment_id?: string;
  record_type: "TDS" | "GST";
  invoice_number?: string;
  invoice_amount: number;
  tds_section?: "194C" | "194J" | "194Q" | "194I" | "Other";
  tds_rate?: number;
  tds_amount?: number;
  gst_rate?: number;
  gst_input_credit?: number;
  eway_bill_number?: string;
  eway_bill_date?: string;
  period: string;
  status?: "Pending" | "Filed" | "Reconciled";
  notes?: string;
}): Promise<{ success: boolean; error?: string; id?: string }> {
  return api.post("/api/tds-gst/create", data);
}

// POST /api/tds-gst/update
export function updateTdsGstRecord(data: {
  id: string;
  vendor_id?: string;
  vendor_payment_id?: string;
  record_type?: "TDS" | "GST";
  invoice_number?: string;
  invoice_amount?: number;
  tds_section?: "194C" | "194J" | "194Q" | "194I" | "Other";
  tds_rate?: number;
  tds_amount?: number;
  gst_rate?: number;
  gst_input_credit?: number;
  eway_bill_number?: string;
  eway_bill_date?: string;
  period?: string;
  status?: "Pending" | "Filed" | "Reconciled";
  notes?: string;
}): Promise<{ success: boolean; error?: string }> {
  return api.post("/api/tds-gst/update", data);
}
