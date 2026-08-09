// Frontend API wrapper for gate pass calls.
// These functions call the Express API server instead of TanStack server functions.
import { api } from "../api-client";

// Shape of a gate pass row returned from the API.
export type GatePassRow = {
  id: string;
  gp_number: string;
  material: string;
  qty: string;
  carrier: string | null;
  vehicle: string | null;
  type: "Returnable" | "Non-returnable";
  status: "Awaiting OTP" | "OTP Verified" | "Exited";
  approver_phone: string | null;
  otp_channel: "sms" | "in_app" | null;
  requested_by: string;
  requested_by_name: string | null;
  requested_at: string;
  exit_time: string | null;
  approved_by: string | null;
  approved_by_name: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  from_location: string | null;
  to_location: string | null;
  invoice_number: string | null;
  invoice_value: number | null;
  purpose: string | null;
  pdf_path: string | null;
  person_name: string | null;
  vehicle_type: string | null;
  driver_name: string | null;
  driver_mobile: string | null;
  material_movement: boolean;
  material_list: { name: string; qty: string }[];
  remarks: string | null;
  photo_proof_path: string | null;
  gp_date: string | null;
  gp_time: string | null;
  batch_id: string | null;
  requisition_id: string | null;
};

// GET /api/gate-passes/fetch
export function fetchGatePasses(data: {
  page?: number;
  limit?: number;
  status?: string;
  requestedBy?: string;
  search?: string;
}): Promise<{ data: GatePassRow[]; total: number; page: number; limit: number }> {
  return api.get("/api/gate-passes/fetch", data);
}

// POST /api/gate-passes/create
export function createGatePass(data: {
  material?: string;
  qty?: string;
  carrier?: string;
  vehicle?: string;
  type?: "Returnable" | "Non-returnable";
  approver_phone: string;
  vendor_id?: string | null;
  from_location?: string;
  to_location?: string;
  invoice_number?: string;
  invoice_value?: number;
  purpose?: string;
  person_name: string;
  vehicle_type?: string;
  driver_name?: string;
  driver_mobile?: string;
  material_movement?: boolean;
  material_list?: { name: string; qty: string }[];
  remarks?: string;
  photo_proof_path?: string | null;
  gp_date?: string;
  gp_time?: string;
  batch_id?: string | null;
  requisition_id?: string | null;
}): Promise<{ success: boolean; error?: string; id?: string; gp_number?: string }> {
  return api.post("/api/gate-passes/create", data);
}

// POST /api/gate-passes/precheck-otp
export function precheckOtpSend(data: {
  gatePassId: string;
}): Promise<{ allowed: boolean; error?: string; phone?: string }> {
  return api.post("/api/gate-passes/precheck-otp", data);
}

// POST /api/gate-passes/verify-otp
export function verifyPhoneOtp(data: {
  gatePassId: string;
  idToken: string;
}): Promise<{ success: boolean; error?: string }> {
  return api.post("/api/gate-passes/verify-otp", data);
}

// POST /api/gate-passes/record-exit
export function recordExit(data: {
  gatePassId: string;
}): Promise<{ success: boolean; error?: string; exit_time?: string }> {
  return api.post("/api/gate-passes/record-exit", data);
}

// GET /api/gate-passes/timeline
export function fetchGatePassTimeline(data: {
  gatePassId: string;
}): Promise<Array<{
  action: string;
  created_at: string;
  user_name: string;
  user_role: string | null;
  details: any;
}>> {
  return api.get("/api/gate-passes/timeline", data);
}

// GET /api/gate-passes/signed-url
export function getGatePassSignedUrl(data: {
  gatePassId: string;
}): Promise<{ success: boolean; error?: string; url?: string }> {
  return api.get("/api/gate-passes/signed-url", data);
}

// GET /api/gate-passes/admin-contacts
export function fetchAdminContacts(data: {
  search?: string;
}): Promise<{
  data: Array<{ id: string; name: string; role: string; phone: string }>;
}> {
  return api.get("/api/gate-passes/admin-contacts", data);
}

// GET /api/gate-passes/fetch-by-id
export function fetchGatePassById(data: {
  gatePassId: string;
}): Promise<{ success: boolean; error?: string; data?: any }> {
  return api.get("/api/gate-passes/fetch-by-id", data);
}
