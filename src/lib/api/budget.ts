// Frontend API wrapper for budget calls.
import { api } from "../api-client";

// GET /api/budget/fetch
export function fetchBudgets(data: {
  fiscalYear?: string;
}): Promise<{
  data: any[];
  total: number;
  summary: {
    total_budget: number;
    total_committed: number;
    total_paid: number;
    total_outstanding: number;
    overall_variance: number;
    overall_utilisation_pct: number;
  };
}> {
  return api.get("/api/budget/fetch", data);
}

// POST /api/budget/create
export function createBudget(data: {
  block?: string;
  category?: string;
  description: string;
  budgeted_amount: number;
  fiscal_year?: string;
  notes?: string;
}): Promise<{ success: boolean; error?: string; id?: string }> {
  return api.post("/api/budget/create", data);
}

// POST /api/budget/update
export function updateBudget(data: {
  id: string;
  block?: string;
  category?: string;
  description?: string;
  budgeted_amount?: number;
  fiscal_year?: string;
  notes?: string;
}): Promise<{ success: boolean; error?: string }> {
  return api.post("/api/budget/update", data);
}

// POST /api/budget/delete
export function deleteBudget(data: { id: string }): Promise<{ success: boolean; error?: string }> {
  return api.post("/api/budget/delete", data);
}
