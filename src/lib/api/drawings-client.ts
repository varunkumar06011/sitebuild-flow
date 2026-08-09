import { api } from "../api-client";

export function fetchDrawings(params?: {
  page?: number;
  limit?: number;
  discipline?: string;
  search?: string;
}) {
  return api.get("/api/drawings/fetch", params);
}

export function uploadDrawingRevision(data: {
  drawing_no: string;
  title: string;
  discipline?: string;
  revision: string;
  fileData: string;
  contentType: string;
  fileName: string;
}) {
  return api.post("/api/drawings/upload", data);
}

export function fetchRfis(params?: {
  page?: number;
  limit?: number;
  status?: string;
  drawingId?: string;
}) {
  return api.get("/api/drawings/rfis", params);
}

export function raiseRfi(data: {
  drawing_id?: string | null;
  question: string;
  sla_due_date?: string | null;
}) {
  return api.post("/api/drawings/rfi/raise", data);
}

export function respondToRfi(data: { id: string; response: string }) {
  return api.post("/api/drawings/rfi/respond", data);
}

export function closeRfi(data: { id: string }) {
  return api.post("/api/drawings/rfi/close", data);
}
