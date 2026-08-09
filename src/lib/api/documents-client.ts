import { api } from "../api-client";

export function fetchDocuments(params?: {
  page?: number;
  limit?: number;
  search?: string;
  documentType?: string;
  expiryStatus?: string;
  blockId?: string;
  vendorId?: string;
  workCategory?: string;
  fromDate?: string;
  toDate?: string;
}) {
  return api.get("/api/documents/fetch", params);
}

export function createDocument(data: {
  name: string;
  document_type: string;
  file_path: string;
  file_size: number;
  content_type?: string;
  amount?: number | null;
  expiry_date?: string | null;
  licence_number?: string | null;
  block_id?: string | null;
  vendor_id?: string | null;
  project_name?: string | null;
  customer_name?: string | null;
  related_entity?: string | null;
  work_category?: string;
  ocr_text?: string | null;
  ocr_extracted?: Record<string, unknown> | null;
}) {
  return api.post("/api/documents/create", data);
}

export function updateDocument(data: {
  id: string;
  name?: string;
  document_type?: string;
  amount?: number | null;
  expiry_date?: string | null;
  licence_number?: string | null;
  block_id?: string | null;
  vendor_id?: string | null;
  project_name?: string | null;
  customer_name?: string | null;
  related_entity?: string | null;
  work_category?: string;
  ocr_text?: string | null;
  ocr_extracted?: Record<string, unknown> | null;
}) {
  return api.post("/api/documents/update", data);
}

export function deleteDocument(data: { id: string }) {
  return api.post("/api/documents/delete", data);
}

export function getDocumentUrl(params: { id: string; download?: boolean }) {
  return api.get("/api/documents/url", params);
}
