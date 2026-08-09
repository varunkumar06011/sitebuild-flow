// Frontend API wrapper for progress-tracking calls.
// These functions call the Express API server instead of TanStack server functions.
import { api } from "../api-client";

// Types (re-exported from original)
export type ProgressBlock = {
  id: string;
  name: string;
  sort_order: number;
  work_category: string;
};

export type ProgressFloor = {
  id: string;
  block_id: string;
  name: string;
  sort_order: number;
};

export type ProgressCellGroup = {
  id: string;
  block_id: string;
  block_name: string;
  floor_id: string;
  floor_name: string;
  work_item_id: string;
  work_item_name: string;
  category_name: string;
  cell_count: number;
};

export type ProgressCategory = {
  id: string;
  name: string;
  work_view_id: string;
  sort_order: number;
};

export type ProgressWorkItem = {
  id: string;
  category_id: string;
  name: string;
  sort_order: number;
};

export type ProgressWorkView = {
  id: string;
  name: string;
  scope: "flat" | "floor" | "block";
  sort_order: number;
};

export type ProgressCell = {
  id: string;
  cell_group_id: string;
  cell_number: number;
  unit_number: string | null;
  status: string;
  completion_pct: number;
  remarks: string | null;
  assigned_supervisor_id: string | null;
  updated_by: string | null;
  updated_at: string | null;
  block_name: string;
  floor_name: string;
  work_item_name: string;
  category_name: string;
  work_view_scope: string;
};

export type ProgressCellHistoryEntry = {
  id: string;
  cell_id: string;
  changed_by: string;
  changed_by_name: string;
  previous_status: string | null;
  new_status: string | null;
  previous_pct: number | null;
  new_pct: number | null;
  remarks: string | null;
  created_at: string;
};

export type ProgressCellPhoto = {
  id: string;
  cell_id: string;
  storage_path: string;
  caption: string | null;
  uploaded_by: string;
  uploaded_at: string;
};

// POST /api/progress-tracking/blocks/create
export function createBlock(data: {
  name: string;
  sort_order?: number;
  work_category?: string;
}): Promise<{ success: boolean; error?: string; data?: ProgressBlock }> {
  return api.post("/api/progress-tracking/blocks/create", data);
}

// POST /api/progress-tracking/floors/create
export function createFloor(data: {
  block_id: string;
  name: string;
  sort_order: number;
}): Promise<{ success: boolean; error?: string; data?: ProgressFloor }> {
  return api.post("/api/progress-tracking/floors/create", data);
}

// POST /api/progress-tracking/work-views/create
export function createWorkView(data: {
  name: string;
  scope: "flat" | "floor" | "block";
  sort_order?: number;
}): Promise<{ success: boolean; error?: string; data?: ProgressWorkView }> {
  return api.post("/api/progress-tracking/work-views/create", data);
}

// GET /api/progress-tracking/work-views
export function fetchWorkViews(): Promise<{ data: ProgressWorkView[] }> {
  return api.get("/api/progress-tracking/work-views");
}

// POST /api/progress-tracking/work-views/update
export function updateWorkView(data: {
  id: string;
  name?: string;
  scope?: "flat" | "floor" | "block";
  sort_order?: number;
}): Promise<{ success: boolean; error?: string; data?: ProgressWorkView }> {
  return api.post("/api/progress-tracking/work-views/update", data);
}

// POST /api/progress-tracking/work-views/delete
export function deleteWorkView(data: {
  id: string;
}): Promise<{ success: boolean; error?: string }> {
  return api.post("/api/progress-tracking/work-views/delete", data);
}

// POST /api/progress-tracking/categories/create
export function createCategory(data: {
  name: string;
  work_view_id: string;
  sort_order: number;
}): Promise<{ success: boolean; error?: string; data?: ProgressCategory }> {
  return api.post("/api/progress-tracking/categories/create", data);
}

// POST /api/progress-tracking/work-items/create
export function createWorkItem(data: {
  category_id: string;
  name: string;
  sort_order: number;
}): Promise<{ success: boolean; error?: string; data?: ProgressWorkItem }> {
  return api.post("/api/progress-tracking/work-items/create", data);
}

// POST /api/progress-tracking/cell-groups/create
export function createCellGroup(data: {
  block_id: string;
  floor_id: string;
  work_item_id: string;
  cell_count: number;
  unit_numbers?: string[];
}): Promise<{ success: boolean; error?: string; id?: string }> {
  return api.post("/api/progress-tracking/cell-groups/create", data);
}

// POST /api/progress-tracking/supervisors/assign
export function assignSupervisor(data: {
  supervisor_id: string;
  block_id: string;
  floor_id: string | null;
}): Promise<{ success: boolean; error?: string }> {
  return api.post("/api/progress-tracking/supervisors/assign", data);
}

// GET /api/progress-tracking/hierarchy
export function fetchHierarchy(): Promise<{
  blocks: ProgressBlock[];
  floors: ProgressFloor[];
  workViews: ProgressWorkView[];
  categories: ProgressCategory[];
  workItems: ProgressWorkItem[];
}> {
  return api.get("/api/progress-tracking/hierarchy");
}

// GET /api/progress-tracking/supervisors
export function fetchSupervisors(): Promise<{ data: { id: string; name: string }[] }> {
  return api.get("/api/progress-tracking/supervisors");
}

// GET /api/progress-tracking/my-cells
export function fetchMyCells(data?: {
  status?: string;
}): Promise<{ data: ProgressCell[] }> {
  return api.get("/api/progress-tracking/my-cells", data);
}

// POST /api/progress-tracking/cells/update
export function updateCell(data: {
  cell_id: string;
  status: "not_started" | "in_progress" | "completed" | "on_hold";
  completion_pct: number;
  remarks: string | null;
}): Promise<{ success: boolean; error?: string }> {
  return api.post("/api/progress-tracking/cells/update", data);
}

// POST /api/progress-tracking/cells/upload-photo
export function uploadCellPhoto(data: {
  cell_id: string;
  contentType: string;
  fileData: string;
  caption?: string;
}): Promise<{ success: boolean; error?: string; data?: any }> {
  return api.post("/api/progress-tracking/cells/upload-photo", data);
}

// GET /api/progress-tracking/cells/history
export function fetchCellHistory(data: {
  cell_id: string;
}): Promise<{ history: ProgressCellHistoryEntry[]; photos: ProgressCellPhoto[] }> {
  return api.get("/api/progress-tracking/cells/history", data);
}

// GET /api/progress-tracking/dashboard
export function fetchProgressDashboard(): Promise<{
  blocks: any[];
  cells: any[];
}> {
  return api.get("/api/progress-tracking/dashboard");
}
