// Frontend API wrapper for cash-flow calls.
import { api } from "../api-client";

// GET /api/cash-flow/fetch
export function fetchCashFlow(): Promise<{
  vendor_aging: any[];
  recent_payments: any[];
  upcoming_commitments: any[];
  summary: {
    total_outstanding: number;
    total_paid_30_days: number;
    total_upcoming: number;
    aging_buckets: { current: number; "1-30": number; "31-60": number; "61-90": number; "90+": number };
    vendor_count: number;
  };
}> {
  return api.get("/api/cash-flow/fetch");
}
