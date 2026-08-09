export {
  fetchDocuments,
  createDocument,
  updateDocument,
  deleteDocument,
  getDocumentUrl,
} from "./documents-client";

export type DocumentType =
  | "Licence"
  | "Permit"
  | "Certificate"
  | "Agreement"
  | "Bill / Invoice"
  | "Receipt"
  | "Land Document"
  | "Photo / Screenshot"
  | "Report"
  | "Contract"
  | "Other";

export type ExpiryStatus = "Active" | "Expiring Soon" | "Expired" | "No Expiry";

export type DocumentRow = {
  id: string;
  name: string;
  document_type: DocumentType;
  file_path: string;
  file_size: number;
  content_type: string | null;
  amount: number | null;
  expiry_date: string | null;
  licence_number: string | null;
  block_id: string | null;
  vendor_id: string | null;
  project_name: string | null;
  customer_name: string | null;
  related_entity: string | null;
  ocr_text: string | null;
  ocr_extracted: Record<string, unknown> | null;
  uploaded_by: string;
  uploaded_by_name: string | null;
  work_category: string;
  created_at: string;
  updated_at: string;
};
