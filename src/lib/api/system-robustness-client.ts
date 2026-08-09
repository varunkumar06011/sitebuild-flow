// Frontend API wrapper for system-robustness — calls the Express API server.
import { api } from "../api-client";

export function fetchDelegations(data: { active?: boolean }): Promise<{ data: any[]; error?: string }> {
  return api.get("/api/system-robustness/delegations", data as any);
}

export function createDelegation(data: {
  delegate_id: string;
  start_date: string;
  end_date: string;
  reason?: string;
}): Promise<{ success: boolean; error?: string; id?: string }> {
  return api.post("/api/system-robustness/delegations", data);
}

export function revokeDelegation(data: { id: string }): Promise<{ success: boolean; error?: string }> {
  return api.post("/api/system-robustness/delegations/revoke", data);
}

export function fetchPendingWithSLA(): Promise<{ data: any[]; sla_hours: number }> {
  return api.get("/api/system-robustness/sla-pending");
}

export function fetchEscalationLog(data: { unresolved_only?: boolean }): Promise<{ data: any[]; error?: string }> {
  return api.get("/api/system-robustness/escalation-log", data as any);
}

export function escalateRequisition(data: {
  requisition_id: string;
  reason?: string;
}): Promise<{ success: boolean; error?: string; new_stage?: string }> {
  return api.post("/api/system-robustness/escalate", data);
}

export function resolveEscalation(data: {
  requisition_id: string;
}): Promise<{ success: boolean; error?: string }> {
  return api.post("/api/system-robustness/resolve-escalation", data);
}

export function fetchDocumentVersions(data: {
  entity_type: string;
  entity_id: string;
  field_name?: string;
}): Promise<{ data: any[]; error?: string }> {
  return api.get("/api/system-robustness/document-versions", data as any);
}

export function recordDocumentVersion(data: {
  entity_type: string;
  entity_id: string;
  field_name: string;
  file_path: string;
  file_name?: string;
  notes?: string;
}): Promise<{ success: boolean; error?: string; id?: string; version?: number }> {
  return api.post("/api/system-robustness/document-versions", data);
}

export function fetchBackupOverview(): Promise<{ data: Array<{ table: string; count: number }>; error?: string }> {
  return api.get("/api/system-robustness/backup-overview");
}

export function exportTableData(data: {
  table: string;
  dateFrom?: string;
  dateTo?: string;
  format?: "csv" | "excel";
}): Promise<{ data: any[]; error?: string }> {
  return api.get("/api/system-robustness/export-table", data as any);
}
