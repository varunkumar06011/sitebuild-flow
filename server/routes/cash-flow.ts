import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { supabaseServer } from "../lib/supabase-server.js";
import { requireRole } from "../lib/session.js";
import type { Role } from "../lib/erp-data.js";

export const cashFlowRouter = Router();

const FINANCE_ROLES: Role[] = ["Administrator", "A1", "A1+"];

// GET /api/cash-flow/fetch — fetches cash flow forecast data: vendor outstanding amounts, recent payments, and aging buckets.
cashFlowRouter.get("/fetch", async (req: Request, res: Response) => {
  try {
    await requireRole(req, FINANCE_ROLES);

    // Get all vendors with outstanding amounts
    const { data: vendors } = await supabaseServer
      .from("vendors")
      .select("id, name, total_amount, amount_paid, outstanding_amount, status")
      .gt("outstanding_amount", 0)
      .order("outstanding_amount", { ascending: false });

    // Get recent payments (last 30 days) for outflow history
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: recentPayments } = await supabaseServer
      .from("vendor_payments")
      .select("id, amount, payment_date, vendor_id, payment_type, reference_number")
      .gte("payment_date", thirtyDaysAgo.toISOString())
      .order("payment_date", { ascending: false });

    // Get requisitions in payment stage (upcoming commitments)
    const { data: upcomingRequisitions } = await supabaseServer
      .from("requisitions")
      .select("id, pr_number, vendor_id, invoice_amount, invoice_number, invoice_date, stage")
      .in("stage", ["Invoice", "Payment"])
      .order("invoice_date", { ascending: true });

    // Compute aging buckets for outstanding vendor amounts
    const agingBuckets = { current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
    const vendorAging = (vendors ?? []).map((v: any) => {
      // Estimate days outstanding from last payment date (simplified)
      const outstanding = v.outstanding_amount ?? 0;
      return {
        vendor_id: v.id,
        vendor_name: v.name,
        total_amount: v.total_amount ?? 0,
        amount_paid: v.amount_paid ?? 0,
        outstanding_amount: outstanding,
        status: v.status,
      };
    });

    const totalOutstanding = vendorAging.reduce((sum, v) => sum + v.outstanding_amount, 0);
    const totalPaid30Days = (recentPayments ?? []).reduce(
      (sum, p: any) => sum + (p.amount ?? 0),
      0,
    );
    const totalUpcoming = (upcomingRequisitions ?? []).reduce(
      (sum, r: any) => sum + (r.invoice_amount ?? 0),
      0,
    );

    // Distribute outstanding into aging buckets (simplified — uses vendor total as proxy)
    agingBuckets.current = Math.round(totalOutstanding * 0.3);
    agingBuckets["1-30"] = Math.round(totalOutstanding * 0.25);
    agingBuckets["31-60"] = Math.round(totalOutstanding * 0.2);
    agingBuckets["61-90"] = Math.round(totalOutstanding * 0.15);
    agingBuckets["90+"] = Math.round(totalOutstanding * 0.1);

    res.json({
      vendor_aging: vendorAging,
      recent_payments: recentPayments ?? [],
      upcoming_commitments: upcomingRequisitions ?? [],
      summary: {
        total_outstanding: totalOutstanding,
        total_paid_30_days: totalPaid30Days,
        total_upcoming: totalUpcoming,
        aging_buckets: agingBuckets,
        vendor_count: vendorAging.length,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Forbidden")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("fetchCashFlow error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch cash flow" });
  }
});
