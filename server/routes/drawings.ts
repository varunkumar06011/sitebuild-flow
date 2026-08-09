import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { supabaseServer } from "../lib/supabase-server.js";
import { requireSessionUser } from "../lib/session.js";
import { logAction } from "../lib/audit.js";
import { isSafePath } from "../lib/sanitize.js";

export const drawingsRouter = Router();

// GET /api/drawings/fetch
drawingsRouter.get("/fetch", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const { page, limit, discipline, search } = req.query as Record<string, string>;
    const p = parseInt(page ?? "1", 10);
    const l = parseInt(limit ?? "50", 10);
    const offset = (p - 1) * l;

    let query = supabaseServer
      .from("drawings")
      .select("id, drawing_no, title, discipline, revision, file_path, uploaded_by, created_at", {
        count: "exact",
      })
      .order("created_at", { ascending: false })
      .range(offset, offset + l - 1);

    if (discipline && discipline !== "all") query = query.eq("discipline", discipline);
    if (search) {
      query = query.or(`drawing_no.ilike.%${search}%,title.ilike.%${search}%`);
    }

    const { data: drawings, count } = await query;
    res.json({ data: drawings ?? [], total: count ?? 0, page: p, limit: l });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ error: err.message });
      return;
    }
    console.error("fetchDrawings error:", err);
    res.status(500).json({ error: "Failed to fetch drawings" });
  }
});

// POST /api/drawings/upload
const uploadDrawingSchema = z.object({
  drawing_no: z.string().min(1),
  title: z.string().min(1),
  discipline: z.string().optional(),
  revision: z.string().default("R0"),
  fileData: z.string(),
  contentType: z.string(),
  fileName: z.string().min(1),
});

drawingsRouter.post("/upload", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = uploadDrawingSchema.parse(req.body);

    const safeFileName = data.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `drawings/${data.drawing_no}/${data.revision}/${safeFileName}`;
    if (!isSafePath(path)) {
      res.json({ success: false, error: "Invalid file path" });
      return;
    }

    const buffer = Buffer.from(data.fileData, "base64");
    if (buffer.length > 10 * 1024 * 1024) {
      res.json({ success: false, error: "File exceeds max size of 10MB" });
      return;
    }

    const { error: uploadError } = await supabaseServer.storage
      .from("documents")
      .upload(path, buffer, { contentType: data.contentType, upsert: false });

    if (uploadError) {
      res.json({ success: false, error: `Upload failed: ${uploadError.message}` });
      return;
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
      await supabaseServer.storage.from("documents").remove([path]);
      res.json({ success: false, error: "Failed to create drawing record" });
      return;
    }

    await logAction(user, "upload_drawing", "drawings", drawing.id, {
      drawing_no: drawing.drawing_no,
      revision: data.revision,
      path,
    });
    res.json({ success: true, id: drawing.id });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("uploadDrawing error:", err);
    res.status(500).json({ success: false, error: "Upload failed" });
  }
});

// GET /api/drawings/rfis
drawingsRouter.get("/rfis", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const { page, limit, status, drawingId } = req.query as Record<string, string>;
    const p = parseInt(page ?? "1", 10);
    const l = parseInt(limit ?? "50", 10);
    const offset = (p - 1) * l;

    let query = supabaseServer
      .from("rfis")
      .select(
        "id, rfi_no, drawing_id, raised_by, raised_by_name, question, status, response, responded_by, responded_at, sla_due_date, created_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(offset, offset + l - 1);

    if (status && status !== "all") query = query.eq("status", status);
    if (drawingId) query = query.eq("drawing_id", drawingId);

    const { data: rfis, count } = await query;
    res.json({ data: rfis ?? [], total: count ?? 0, page: p, limit: l });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ error: err.message });
      return;
    }
    console.error("fetchRfis error:", err);
    res.status(500).json({ error: "Failed to fetch RFIs" });
  }
});

// POST /api/drawings/rfi/raise
const raiseRfiSchema = z.object({
  drawing_id: z.string().uuid().nullable().optional(),
  question: z.string().min(1),
  sla_due_date: z.string().nullable().optional(),
});

drawingsRouter.post("/rfi/raise", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = raiseRfiSchema.parse(req.body);

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
      res.json({ success: false, error: "Failed to raise RFI" });
      return;
    }

    await logAction(user, "raise_rfi", "rfis", rfi.id, {
      rfi_no: rfi.rfi_no,
      question: data.question,
    });
    res.json({ success: true, id: rfi.id, rfi_no: rfi.rfi_no });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("raiseRfi error:", err);
    res.status(500).json({ success: false, error: "Failed to raise RFI" });
  }
});

// POST /api/drawings/rfi/respond
const respondToRfiSchema = z.object({
  id: z.string().uuid(),
  response: z.string().min(1),
});

drawingsRouter.post("/rfi/respond", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (user.role !== "Administrator" && user.role !== "A1" && user.role !== "A1+") {
      res.json({ success: false, error: "Only administrators can respond to RFIs" });
      return;
    }
    const data = respondToRfiSchema.parse(req.body);

    const { error } = await supabaseServer
      .from("rfis")
      .update({
        response: data.response,
        responded_by: user.id,
        responded_at: new Date().toISOString(),
        status: "Answered",
      })
      .eq("id", data.id);

    if (error) {
      res.json({ success: false, error: "Failed to respond to RFI" });
      return;
    }

    await logAction(user, "respond_rfi", "rfis", data.id, { response: data.response });
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
    console.error("respondToRfi error:", err);
    res.status(500).json({ success: false, error: "Failed to respond to RFI" });
  }
});

// POST /api/drawings/rfi/close
drawingsRouter.post("/rfi/close", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (user.role !== "Administrator" && user.role !== "A1" && user.role !== "A1+") {
      res.json({ success: false, error: "Only administrators can close RFIs" });
      return;
    }
    const { id } = z.object({ id: z.string().uuid() }).parse(req.body);

    const { error } = await supabaseServer.from("rfis").update({ status: "Closed" }).eq("id", id);
    if (error) {
      res.json({ success: false, error: "Failed to close RFI" });
      return;
    }

    await logAction(user, "close_rfi", "rfis", id, {});
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
    console.error("closeRfi error:", err);
    res.status(500).json({ success: false, error: "Failed to close RFI" });
  }
});
