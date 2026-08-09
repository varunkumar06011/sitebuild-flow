import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { supabaseServer } from "../lib/supabase-server.js";
import { requireSessionUser } from "../lib/session.js";
import { logAction } from "../lib/audit.js";
import { sanitizeSearch } from "../lib/sanitize.js";

export const documentsRouter = Router();

function computeExpiryStatus(expiryDate: string | null): string {
  if (!expiryDate) return "No Expiry";
  const now = new Date();
  const expiry = new Date(expiryDate);
  const diffDays = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return "Expired";
  if (diffDays <= 30) return "Expiring Soon";
  return "Active";
}

// GET /api/documents/fetch
documentsRouter.get("/fetch", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const { page, limit, search, documentType, expiryStatus, blockId, vendorId, workCategory, fromDate, toDate } = req.query as Record<string, string>;
    const p = parseInt(page ?? "1", 10);
    const l = parseInt(limit ?? "50", 10);
    const offset = (p - 1) * l;

    let query = supabaseServer
      .from("documents")
      .select(
        "id, name, document_type, file_path, file_size, content_type, amount, expiry_date, licence_number, block_id, vendor_id, project_name, customer_name, related_entity, ocr_text, ocr_extracted, uploaded_by, uploaded_by_name, work_category, created_at, updated_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(offset, offset + l - 1);

    if (search) {
      const s = sanitizeSearch(search);
      if (s) {
        query = query.or(
          `name.ilike.%${s}%,project_name.ilike.%${s}%,customer_name.ilike.%${s}%,related_entity.ilike.%${s}%,licence_number.ilike.%${s}%`,
        );
      }
    }
    if (documentType && documentType !== "all") query = query.eq("document_type", documentType);
    if (blockId) query = query.eq("block_id", blockId);
    if (vendorId) query = query.eq("vendor_id", vendorId);
    if (workCategory && workCategory !== "all") query = query.eq("work_category", workCategory);
    if (fromDate) query = query.gte("created_at", fromDate);
    if (toDate) query = query.lte("created_at", toDate);

    const { data: docs, count } = await query;

    let rows = (docs ?? []) as any[];
    if (expiryStatus && expiryStatus !== "all") {
      rows = rows.filter((r) => computeExpiryStatus(r.expiry_date) === expiryStatus);
    }

    res.json({
      data: rows.map((r: any) => ({
        ...r,
        amount: r.amount !== null ? Number(r.amount) : null,
        expiry_status: computeExpiryStatus(r.expiry_date),
      })),
      total: count ?? 0,
      page: p,
      limit: l,
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ error: err.message });
      return;
    }
    console.error("fetchDocuments error:", err);
    res.status(500).json({ error: "Failed to fetch documents" });
  }
});

// POST /api/documents/create
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

documentsRouter.post("/create", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (user.role === "Supervisor") {
      res.json({ success: false, error: "Only administrators can upload documents" });
      return;
    }
    const data = createDocumentSchema.parse(req.body);

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
      res.json({ success: false, error: "Failed to create document record" });
      return;
    }

    await logAction(user, "create_document", "document", doc.id, { name: doc.name });
    res.json({ success: true, id: doc.id });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("createDocument error:", err);
    res.status(500).json({ success: false, error: "Failed to create document" });
  }
});

// POST /api/documents/update
documentsRouter.post("/update", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (user.role === "Supervisor") {
      res.json({ success: false, error: "Only administrators can edit documents" });
      return;
    }
    const { id, ...updateFields } = req.body as Record<string, any>;
    const updateData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updateFields)) {
      if (value !== undefined) updateData[key] = value;
    }

    const { error } = await supabaseServer.from("documents").update(updateData).eq("id", id);
    if (error) {
      res.json({ success: false, error: "Failed to update document" });
      return;
    }

    await logAction(user, "update_document", "document", id, updateData);
    res.json({ success: true, id });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("updateDocument error:", err);
    res.status(500).json({ success: false, error: "Failed to update document" });
  }
});

// POST /api/documents/delete
documentsRouter.post("/delete", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (user.role === "Supervisor") {
      res.json({ success: false, error: "Only administrators can delete documents" });
      return;
    }
    const { id } = z.object({ id: z.string().uuid() }).parse(req.body);

    const { data: doc } = await supabaseServer
      .from("documents")
      .select("file_path, name")
      .eq("id", id)
      .single();

    if (!doc) {
      res.json({ success: false, error: "Document not found" });
      return;
    }

    const { error: storageError } = await supabaseServer.storage.from("documents").remove([doc.file_path]);
    if (storageError) {
      console.error("[deleteDocument] Storage removal failed:", storageError.message);
    }

    const { error } = await supabaseServer.from("documents").delete().eq("id", id);
    if (error) {
      res.json({ success: false, error: "Failed to delete document" });
      return;
    }

    await logAction(user, "delete_document", "document", id, { name: doc.name });
    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("deleteDocument error:", err);
    res.status(500).json({ success: false, error: "Failed to delete document" });
  }
});

// GET /api/documents/url
documentsRouter.get("/url", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const { id, download } = req.query as Record<string, string>;

    const { data: doc, error } = await supabaseServer
      .from("documents")
      .select("file_path, name, content_type")
      .eq("id", id)
      .single();

    if (error || !doc) {
      res.json({ success: false, error: "Document not found" });
      return;
    }

    const expiry = 60 * 60;
    const { data: urlData, error: urlError } = await supabaseServer.storage
      .from("documents")
      .createSignedUrl(doc.file_path, expiry, { download: download === "true" });

    if (urlError || !urlData) {
      res.json({ success: false, error: "Failed to generate document URL" });
      return;
    }

    await logAction(user, "view_document", "document", id, { name: doc.name });
    res.json({ success: true, url: urlData.signedUrl, name: doc.name, content_type: doc.content_type });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("getDocumentUrl error:", err);
    res.status(500).json({ success: false, error: "Failed to get document URL" });
  }
});
