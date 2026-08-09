import { api } from "../api-client";

export function fetchVendorProfile(): Promise<{ data: any; error?: string }> {
  return api.get("/api/vendor-portal/profile");
}

export function fetchVendorPOs(data?: { stage?: string }): Promise<{ data: any[]; error?: string }> {
  return api.get("/api/vendor-portal/pos", data as any);
}

export function fetchVendorPayments(): Promise<{ data: any[]; error?: string }> {
  return api.get("/api/vendor-portal/payments");
}

export function updateDeliveryStatus(data: {
  requisition_id: string;
  delivery_date?: string;
  quantity_received?: number;
  notes?: string;
}): Promise<{ success: boolean; error?: string }> {
  return api.post("/api/vendor-portal/update-delivery", data);
}

export function uploadVendorDocument(data: {
  requisition_id: string;
  doc_type: "invoice" | "challan" | "mtc" | "other";
  file_path: string;
  file_name?: string;
  notes?: string;
}): Promise<{ success: boolean; error?: string }> {
  return api.post("/api/vendor-portal/upload-document", data);
}

export function fetchVendorOutstanding(): Promise<{ data: any }> {
  return api.get("/api/vendor-portal/outstanding");
}
