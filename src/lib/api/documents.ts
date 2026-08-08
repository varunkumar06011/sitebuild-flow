import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseServer } from "../supabase-server";
import { requireSessionUser } from "./session";
import { logAction } from "./audit";
import type { Role } from "../erp-data";

const ADMIN_ROLES: Role[] = ["Administrator", "A1", "A1+"];
function isAdmin(role: Role): boolean {
  return ADMIN_ROLES.includes(role);
}

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

function computeExpiryStatus(expiryDate: string | null): ExpiryStatus {
  if (!expiryDate) return "No Expiry";
  const now = new Date();
  const expiry = new Date(expiryDate);
  const diffDays = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return "Expired";
  if (diffDays <= 30) return "Expiring Soon";
  return "Active";
}

// ---------------------------------------------------------------------------
// Fetch documents (paginated, filterable, searchable)
// ---------------------------------------------------------------------------
export const fetchDocuments = createServerFn({ method: "GET" })
  .validator(
    (input: {
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
    }) => input,
  )
  .handler(async ({ data }) => {
    await requireSessionUser();
    const page = data.page ?? 1;
    const limit = data.limit ?? 50;
    const offset = (page - 1) * limit;

    let query = supabaseServer
      .from("documents")
      .select(
        "id, name, document_type, file_path, file_size, content_type, amount, expiry_date, licence_number, block_id, vendor_id, project_name, customer_name, related_entity, ocr_text, ocr_extracted, uploaded_by, uploaded_by_name, work_category, created_at, updated_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (data.search) {
      query = query.or(
        `name.ilike.%${data.search}%,project_name.ilike.%${data.search}%,customer_name.ilike.%${data.search}%,related_entity.ilike.%${data.search}%,licence_number.ilike.%${data.search}%`,
      );
    }
    if (data.documentType && data.documentType !== "all") {
      query = query.eq("document_type", data.documentType);
    }
    if (data.blockId) {
      query = query.eq("block_id", data.blockId);
    }
    if (data.vendorId) {
      query = query.eq("vendor_id", data.vendorId);
    }
    if (data.workCategory && data.workCategory !== "all") {
      query = query.eq("work_category", data.workCategory);
    }
    if (data.fromDate) {
      query = query.gte("created_at", data.fromDate);
    }
    if (data.toDate) {
      query = query.lte("created_at", data.toDate);
    }

    const { data: docs, count } = await query;

    // Apply expiry status filter in-memory (computed field)
    let rows = (docs ?? []) as any[];
    if (data.expiryStatus && data.expiryStatus !== "all") {
      rows = rows.filter((r) => computeExpiryStatus(r.expiry_date) === data.expiryStatus);
    }

    return {
      data: rows.map((r: any) => ({
        ...r,
        amount: r.amount !== null ? Number(r.amount) : null,
        expiry_status: computeExpiryStatus(r.expiry_date),
      })),
      total: count ?? 0,
      page,
      limit,
    };
  });

// ---------------------------------------------------------------------------
// Create document metadata (after file upload)
// ---------------------------------------------------------------------------
const createDocumentSchema = z.object({
  name: z.string().min(1),
  document_type: z.string(),
  file_path: z.string().min(1),
  file_size: z.number().min(0),
  content_type: z.string().optional(),
  amount: z.number().nullable().optional(),
  expiry_date: z.string().nullable().optional(),
  licence_number: z.string().nullable().optional(),
  block_id: z.string().uuid().nullable().optional(),
  vendor_id: z.string().uuid().nullable().optional(),
  project_name: z.string().nullable().optional(),
  customer_name: z.string().nullable().optional(),
  related_entity: z.string().nullable().optional(),
  work_category: z.string().optional(),
  ocr_text: z.string().nullable().optional(),
  ocr_extracted: z.any().nullable().optional(),
});

export const createDocument = createServerFn({ method: "POST" })
  .validator(createDocumentSchema)
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    if (!isAdmin(user.role)) {
      return { success: false, error: "Only administrators can upload documents" };
    }

    const { data: doc, error } = await supabaseServer
      .from("documents")
      .insert({
        name: data.name,
        document_type: data.document_type,
        file_path: data.file_path,
        file_size: data.file_size,
        content_type: data.content_type ?? null,
        amount: data.amount ?? null,
        expiry_date: data.expiry_date ?? null,
        licence_number: data.licence_number ?? null,
        block_id: data.block_id ?? null,
        vendor_id: data.vendor_id ?? null,
        project_name: data.project_name ?? null,
        customer_name: data.customer_name ?? null,
        related_entity: data.related_entity ?? null,
        work_category: data.work_category ?? "uncategorized",
        ocr_text: data.ocr_text ?? null,
        ocr_extracted: data.ocr_extracted ?? null,
        uploaded_by: user.id,
        uploaded_by_name: user.name,
      })
      .select("id, name")
      .single();

    if (error || !doc) {
      return { success: false, error: "Failed to create document record" };
    }

    await logAction(user, "create_document", "document", doc.id, { name: doc.name });
    return { success: true, id: doc.id };
  });

// ---------------------------------------------------------------------------
// Update document metadata
// ---------------------------------------------------------------------------
const updateDocumentSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).optional(),
  document_type: z.string().optional(),
  amount: z.number().nullable().optional(),
  expiry_date: z.string().nullable().optional(),
  licence_number: z.string().nullable().optional(),
  block_id: z.string().uuid().nullable().optional(),
  vendor_id: z.string().uuid().nullable().optional(),
  project_name: z.string().nullable().optional(),
  customer_name: z.string().nullable().optional(),
  related_entity: z.string().nullable().optional(),
  work_category: z.string().optional(),
  ocr_text: z.string().nullable().optional(),
  ocr_extracted: z.any().nullable().optional(),
});

export const updateDocument = createServerFn({ method: "POST" })
  .validator(updateDocumentSchema)
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    if (!isAdmin(user.role)) {
      return { success: false, error: "Only administrators can edit documents" };
    }

    const { id, ...updateFields } = data;
    const updateData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updateFields)) {
      if (value !== undefined) updateData[key] = value;
    }

    const { error } = await supabaseServer.from("documents").update(updateData).eq("id", id);

    if (error) {
      return { success: false, error: "Failed to update document" };
    }

    await logAction(user, "update_document", "document", id, updateData);
    return { success: true, id };
  });

// ---------------------------------------------------------------------------
// Delete document (also removes file from storage)
// ---------------------------------------------------------------------------
const deleteDocumentSchema = z.object({ id: z.string().uuid() });

export const deleteDocument = createServerFn({ method: "POST" })
  .validator(deleteDocumentSchema)
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    if (!isAdmin(user.role)) {
      return { success: false, error: "Only administrators can delete documents" };
    }

    // Get file path before deleting the row
    const { data: doc } = await supabaseServer
      .from("documents")
      .select("file_path, name")
      .eq("id", data.id)
      .single();

    if (!doc) {
      return { success: false, error: "Document not found" };
    }

    // Delete from storage
    const { error: storageError } = await supabaseServer.storage
      .from("documents")
      .remove([doc.file_path]);

    if (storageError) {
      // Log but don't block — the metadata is the primary record
      console.error("[deleteDocument] Storage removal failed:", storageError.message);
    }

    // Delete the DB row
    const { error } = await supabaseServer.from("documents").delete().eq("id", data.id);

    if (error) {
      return { success: false, error: "Failed to delete document" };
    }

    await logAction(user, "delete_document", "document", data.id, { name: doc.name });
    return { success: true };
  });

// ---------------------------------------------------------------------------
// Get signed URL for document preview/download
// ---------------------------------------------------------------------------
const getDocumentUrlSchema = z.object({
  id: z.string().uuid(),
  download: z.boolean().optional(),
});

export const getDocumentUrl = createServerFn({ method: "GET" })
  .validator(getDocumentUrlSchema)
  .handler(async ({ data }) => {
    const user = await requireSessionUser();

    const { data: doc, error } = await supabaseServer
      .from("documents")
      .select("file_path, name, content_type")
      .eq("id", data.id)
      .single();

    if (error || !doc) {
      return { success: false, error: "Document not found" };
    }

    const expiry = 60 * 60; // 1 hour
    const { data: urlData, error: urlError } = await supabaseServer.storage
      .from("documents")
      .createSignedUrl(doc.file_path, expiry, {
        download: data.download ?? false,
      });

    if (urlError || !urlData) {
      return { success: false, error: "Failed to generate document URL" };
    }

    await logAction(user, "view_document", "document", data.id, { name: doc.name });
    return {
      success: true,
      url: urlData.signedUrl,
      name: doc.name,
      content_type: doc.content_type,
    };
  });
