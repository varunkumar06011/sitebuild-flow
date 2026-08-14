import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { supabaseServer } from "../lib/supabase-server.js";
import { requireSessionUser } from "../lib/session.js";
import { logAction } from "../lib/audit.js";
import { isSafePath } from "../lib/sanitize.js";

export const storageRouter = Router();

// Any file type is allowed for documents — the MIME type is accepted as-is.
// application/octet-stream is the fallback for unknown/binary types.
const DOCUMENT_MIMES: string[] | null = null;
const PHOTO_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/bmp",
  "image/tiff",
];
const MAX_DOC_SIZE = 100 * 1024 * 1024;
const MAX_PHOTO_SIZE = 5 * 1024 * 1024;

// POST /api/storage/upload — uploads a base64-encoded file to Supabase storage.
const uploadSchema = z.object({
  bucket: z.enum(["documents", "photos"]),
  path: z.string().min(1),
  contentType: z.string(),
  fileData: z.string(),
});

storageRouter.post("/upload", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = uploadSchema.parse(req.body);

    if (!isSafePath(data.path)) {
      res.json({ success: false, error: "Invalid file path" });
      return;
    }

    const maxSize = data.bucket === "documents" ? MAX_DOC_SIZE : MAX_PHOTO_SIZE;

    // Documents bucket accepts any file type; photos bucket still restricts to image MIME types.
    if (data.bucket === "photos" && !PHOTO_MIMES.includes(data.contentType)) {
      res.json({
        success: false,
        error: `File type ${data.contentType} not allowed for ${data.bucket}`,
      });
      return;
    }

    const buffer = Buffer.from(data.fileData, "base64");
    if (buffer.length > maxSize) {
      const maxMB = maxSize / (1024 * 1024);
      res.json({ success: false, error: `File exceeds max size of ${maxMB}MB` });
      return;
    }

    const { error } = await supabaseServer.storage
      .from(data.bucket)
      .upload(data.path, buffer, { contentType: data.contentType, upsert: false });

    if (error) {
      res.json({ success: false, error: `Upload failed: ${error.message}` });
      return;
    }

    await logAction(user, "upload_file", data.bucket, data.path, {
      bucket: data.bucket,
      path: data.path,
      size: buffer.length,
      content_type: data.contentType,
    });

    res.json({ success: true, path: data.path });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("uploadFile error:", err);
    res.status(500).json({ success: false, error: "Upload failed" });
  }
});

// GET /api/storage/signed-url — generates a time-limited signed URL for a stored file.
const signedUrlSchema = z.object({
  bucket: z.enum(["documents", "photos"]),
  path: z.string().min(1),
  expirySec: z.coerce.number().optional(),
});

storageRouter.get("/signed-url", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = signedUrlSchema.parse(req.query);

    if (!isSafePath(data.path)) {
      res.json({ success: false, error: "Invalid file path" });
      return;
    }

    const expiry = data.expirySec ?? (data.bucket === "documents" ? 72 * 60 * 60 : 60 * 60);

    const { data: urlData, error } = await supabaseServer.storage
      .from(data.bucket)
      .createSignedUrl(data.path, expiry);

    if (error || !urlData) {
      res.json({ success: false, error: "Failed to generate signed URL" });
      return;
    }

    await logAction(user, "view_file", data.bucket, data.path, {
      bucket: data.bucket,
      path: data.path,
    });

    res.json({ success: true, url: urlData.signedUrl });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("getSignedUrl error:", err);
    res.status(500).json({ success: false, error: "Failed to generate signed URL" });
  }
});
