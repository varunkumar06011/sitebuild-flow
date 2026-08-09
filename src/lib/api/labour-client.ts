import { api } from "../api-client";

export function fetchAttendance(params?: {
  fromDate?: string;
  toDate?: string;
  workCategory?: string;
  contractorName?: string;
  page?: number;
  limit?: number;
}) {
  return api.get("/labour/attendance", params);
}

export function markAttendance(data: {
  date: string;
  work_category?: string;
  contractor_name: string;
  headcount_skilled?: number;
  headcount_unskilled?: number;
  notes?: string;
}) {
  return api.post("/labour/mark-attendance", data);
}

export function updateAttendance(data: {
  id: string;
  date?: string;
  work_category?: string;
  contractor_name?: string;
  headcount_skilled?: number;
  headcount_unskilled?: number;
  notes?: string;
}) {
  return api.post("/labour/update-attendance", data);
}

export function getManpowerCostSummary(params?: {
  fromDate?: string;
  toDate?: string;
  workCategory?: string;
}) {
  return api.get("/labour/manpower-cost-summary", params);
}
