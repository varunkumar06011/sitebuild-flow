// Frontend API wrapper for digital twin calls.
// These functions call the Express API server instead of TanStack server functions.
import { api } from "../api-client";

// GET /api/digital-twin/overlay
export function fetchBlockOverlay(): Promise<{ data: any[] }> {
  return api.get("/api/digital-twin/overlay");
}

// GET /api/digital-twin/detail
export function fetchBlockDetail(
  data: { block_id: string },
): Promise<{ data: any }> {
  return api.get("/api/digital-twin/detail", data);
}

// POST /api/digital-twin/layout
export function updateBlockLayout(data: {
  block_id: string;
  x_position: number;
  y_position: number;
  width?: number;
  height?: number;
}): Promise<{ success: boolean; error?: string }> {
  return api.post("/api/digital-twin/layout", data);
}
