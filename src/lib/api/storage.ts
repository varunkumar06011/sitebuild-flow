import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseServer } from "../supabase-server";
import { requireSessionUser } from "./session";
import { logAction } from "./audit";

const DOCUMENT_MIMES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const PHOTO_MIMES = ["image/jpeg", "image/png", "image/webp"];
const MAX_DOC_SIZE = 10 * 1024 * 1024;
const MAX_PHOTO_SIZE = 5 * 1024 * 1024;

const uploadSchema = z.object({
  bucket: z.enum(["documents", "photos"]),
  path: z.string().min(1),
  contentType: z.string(),
  fileData: z.string(),
});

export const uploadFile = createServerFn({ method: "POST" })
  .validator(uploadSchema)
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();

    const allowedMimes = data.bucket === "documents" ? DOCUMENT_MIMES : PHOTO_MIMES;
    const maxSize = data.bucket === "documents" ? MAX_DOC_SIZE : MAX_PHOTO_SIZE;

    if (!allowedMimes.includes(data.contentType)) {
      return { success: false, error: `File type ${data.contentType} not allowed for ${data.bucket}` };
    }

    const buffer = Buffer.from(data.fileData, "base64");
    if (buffer.length > maxSize) {
      const maxMB = maxSize / (1024 * 1024);
      return { success: false, error: `File exceeds max size of ${maxMB}MB` };
    }

    const { error } = await supabaseServer
      .storage
      .from(data.bucket)
      .upload(data.path, buffer, { contentType: data.contentType, upsert: false });

    if (error) {
      return { success: false, error: `Upload failed: ${error.message}` };
    }

    await logAction(user, "upload_file", data.bucket, data.path, {
      bucket: data.bucket,
      path: data.path,
      size: buffer.length,
      content_type: data.contentType,
    });

    return { success: true, path: data.path };
  });

const signedUrlSchema = z.object({
  bucket: z.enum(["documents", "photos"]),
  path: z.string().min(1),
  expirySec: z.number().optional(),
});

export const getSignedUrl = createServerFn({ method: "GET" })
  .validator(signedUrlSchema)
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();

    const expiry = data.expirySec ?? (data.bucket === "documents" ? 72 * 60 * 60 : 60 * 60);

    const { data: urlData, error } = await supabaseServer
      .storage
      .from(data.bucket)
      .createSignedUrl(data.path, expiry);

    if (error || !urlData) {
      return { success: false, error: "Failed to generate signed URL" };
    }

    await logAction(user, "view_file", data.bucket, data.path, { bucket: data.bucket, path: data.path });

    return { success: true, url: urlData.signedUrl };
  });
