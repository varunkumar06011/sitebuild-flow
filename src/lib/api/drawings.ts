import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseServer } from "../supabase-server";
import { requireSessionUser } from "./session";
import { logAction } from "./audit";
import { isSafePath } from "./sanitize";
import type { Role } from "../erp-data";

const ADMIN_ROLES: Role[] = ["Administrator", "A1", "A1+"];
function isAdmin(role: Role): boolean {
  return ADMIN_ROLES.includes(role);
}

// ---------------------------------------------------------------------------
// Fetch drawings with optional discipline filter
// ---------------------------------------------------------------------------
export const fetchDrawings = createServerFn({ method: "GET" })
  .validator(
    (input: { page?: number; limit?: number; discipline?: string; search?: string }) => input,
  )
  .handler(async ({ data }) => {
    await requireSessionUser();
    const page = data.page ?? 1;
    const limit = data.limit ?? 50;
    const offset = (page - 1) * limit;

    let query = supabaseServer
      .from("drawings")
      .select("id, drawing_no, title, discipline, revision, file_path, uploaded_by, created_at", {
        count: "exact",
      })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (data.discipline && data.discipline !== "all") {
      query = query.eq("discipline", data.discipline);
    }
    if (data.search) {
      query = query.or(`drawing_no.ilike.%${data.search}%,title.ilike.%${data.search}%`);
    }

    const { data: drawings, count } = await query;

    return { data: drawings ?? [], total: count ?? 0, page, limit };
  });

// ---------------------------------------------------------------------------
// Upload a new drawing revision — reuses the storage.ts upload pattern:
// base64 file data is uploaded to the "documents" bucket, then a DB row is created.
// ---------------------------------------------------------------------------
const uploadDrawingSchema = z.object({
  drawing_no: z.string().min(1),
  title: z.string().min(1),
  discipline: z.string().optional(),
  revision: z.string().default("R0"),
  fileData: z.string(),
  contentType: z.string(),
  fileName: z.string().min(1),
});

export const uploadDrawingRevision = createServerFn({ method: "POST" })
  .validator(uploadDrawingSchema)
  .handler(async ({ data }) => {
    const user = await requireSessionUser();

    // Build a safe storage path: drawings/<drawing_no>/<revision>/<fileName>
    const safeFileName = data.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `drawings/${data.drawing_no}/${data.revision}/${safeFileName}`;

    if (!isSafePath(path)) {
      return { success: false, error: "Invalid file path" };
    }

    const buffer = Buffer.from(data.fileData, "base64");
    const maxSize = 10 * 1024 * 1024;
    if (buffer.length > maxSize) {
      return { success: false, error: "File exceeds max size of 10MB" };
    }

    const { error: uploadError } = await supabaseServer.storage
      .from("documents")
      .upload(path, buffer, { contentType: data.contentType, upsert: false });

    if (uploadError) {
      return { success: false, error: `Upload failed: ${uploadError.message}` };
    }

    const { data: drawing, error } = await supabaseServer
      .from("drawings")
      .insert({
        drawing_no: data.drawing_no,
        title: data.title,
        discipline: data.discipline ?? null,
        revision: data.revision,
        file_path: path,
        uploaded_by: user.id,
      })
      .select("id, drawing_no")
      .single();

    if (error || !drawing) {
      // Clean up the uploaded file if DB insert failed
      await supabaseServer.storage.from("documents").remove([path]);
      return { success: false, error: "Failed to create drawing record" };
    }

    await logAction(user, "upload_drawing", "drawings", drawing.id, {
      drawing_no: drawing.drawing_no,
      revision: data.revision,
      path,
    });

    return { success: true, id: drawing.id };
  });

// ---------------------------------------------------------------------------
// Fetch RFIs with optional status filter
// ---------------------------------------------------------------------------
export const fetchRfis = createServerFn({ method: "GET" })
  .validator(
    (input: { page?: number; limit?: number; status?: string; drawingId?: string }) => input,
  )
  .handler(async ({ data }) => {
    await requireSessionUser();
    const page = data.page ?? 1;
    const limit = data.limit ?? 50;
    const offset = (page - 1) * limit;

    let query = supabaseServer
      .from("rfis")
      .select(
        "id, rfi_no, drawing_id, raised_by, raised_by_name, question, status, response, responded_by, responded_at, sla_due_date, created_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (data.status && data.status !== "all") {
      query = query.eq("status", data.status);
    }
    if (data.drawingId) {
      query = query.eq("drawing_id", data.drawingId);
    }

    const { data: rfis, count } = await query;

    return { data: rfis ?? [], total: count ?? 0, page, limit };
  });

// ---------------------------------------------------------------------------
// Raise a new RFI — Supervisors and above
// ---------------------------------------------------------------------------
const raiseRfiSchema = z.object({
  drawing_id: z.string().uuid().nullable().optional(),
  question: z.string().min(1),
  sla_due_date: z.string().nullable().optional(),
});

export const raiseRfi = createServerFn({ method: "POST" })
  .validator(raiseRfiSchema)
  .handler(async ({ data }) => {
    const user = await requireSessionUser();

    // Generate RFI number: RFI/<YYYY>/<MM>/<sequential>
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const prefix = `RFI/${year}/${month}/`;

    const { data: existing } = await supabaseServer
      .from("rfis")
      .select("rfi_no")
      .like("rfi_no", `${prefix}%`)
      .order("rfi_no", { ascending: false })
      .limit(1);

    let seq = 1;
    if (existing && existing.length > 0) {
      const lastNum = (existing[0] as any).rfi_no as string;
      const parts = lastNum.split("/");
      seq = parseInt(parts[parts.length - 1] ?? "0", 10) + 1;
    }
    const rfiNo = `${prefix}${String(seq).padStart(4, "0")}`;

    const { data: rfi, error } = await supabaseServer
      .from("rfis")
      .insert({
        rfi_no: rfiNo,
        drawing_id: data.drawing_id ?? null,
        raised_by: user.id,
        raised_by_name: user.name,
        question: data.question,
        sla_due_date: data.sla_due_date ?? null,
        status: "Open",
      })
      .select("id, rfi_no")
      .single();

    if (error || !rfi) {
      return { success: false, error: "Failed to raise RFI" };
    }

    await logAction(user, "raise_rfi", "rfis", rfi.id, {
      rfi_no: rfi.rfi_no,
      question: data.question,
    });

    return { success: true, id: rfi.id, rfi_no: rfi.rfi_no };
  });

// ---------------------------------------------------------------------------
// Respond to an RFI — admin only
// ---------------------------------------------------------------------------
const respondToRfiSchema = z.object({
  id: z.string().uuid(),
  response: z.string().min(1),
});

export const respondToRfi = createServerFn({ method: "POST" })
  .validator(respondToRfiSchema)
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    if (!isAdmin(user.role)) {
      return { success: false, error: "Only administrators can respond to RFIs" };
    }

    const { error } = await supabaseServer
      .from("rfis")
      .update({
        response: data.response,
        responded_by: user.id,
        responded_at: new Date().toISOString(),
        status: "Answered",
      })
      .eq("id", data.id);

    if (error) return { success: false, error: "Failed to respond to RFI" };

    await logAction(user, "respond_rfi", "rfis", data.id, {
      response: data.response,
    });

    return { success: true };
  });

// ---------------------------------------------------------------------------
// Close an RFI — admin only
// ---------------------------------------------------------------------------
export const closeRfi = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    if (!isAdmin(user.role)) {
      return { success: false, error: "Only administrators can close RFIs" };
    }

    const { error } = await supabaseServer
      .from("rfis")
      .update({ status: "Closed" })
      .eq("id", data.id);

    if (error) return { success: false, error: "Failed to close RFI" };

    await logAction(user, "close_rfi", "rfis", data.id, {});
    return { success: true };
  });
