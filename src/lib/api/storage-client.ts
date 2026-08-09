import { api } from "../api-client";

export function uploadFile(data: {
  bucket: "documents" | "photos";
  path: string;
  contentType: string;
  fileData: string;
}) {
  return api.post("/storage/upload", data);
}

export function getSignedUrl(params: {
  bucket: "documents" | "photos";
  path: string;
  expirySec?: number;
}) {
  return api.get("/storage/signed-url", params);
}
