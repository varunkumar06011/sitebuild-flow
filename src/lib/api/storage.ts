// Frontend API wrapper for storage calls.
// These functions call the Express API server instead of TanStack server functions.
import { api } from "../api-client";

// POST /api/storage/upload
export function uploadFile(data: {
  bucket: "documents" | "photos";
  path: string;
  contentType: string;
  fileData: string;
}): Promise<{ success: boolean; error?: string; path?: string }> {
  return api.post("/api/storage/upload", data);
}

// GET /api/storage/signed-url
export function getSignedUrl(data: {
  bucket: "documents" | "photos";
  path: string;
  expirySec?: number;
}): Promise<{ success: boolean; error?: string; url?: string }> {
  return api.get("/api/storage/signed-url", data);
}
