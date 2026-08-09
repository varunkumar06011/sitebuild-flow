import { Router, type Request, type Response } from "express";
import { supabaseServer } from "../lib/supabase-server.js";
import { requireSessionUser } from "../lib/session.js";
import { logAction } from "../lib/audit.js";
import type { Role } from "../lib/erp-data.js";

export const vendorScorecardRouter = Router();

const ADMIN_ROLES: Role[] = ["Administrator", "A1", "A1+"];
function isAdmin(role: Role): boolean {
  return ADMIN_ROLES.includes(role);
}

// GET /api/vendor-scorecard/:vendorId
vendorScorecardRouter.get("/:vendorId", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (!isAdmin(user.role)) {
      res.json({ success: false, error: "Only administrators can view vendor scorecards" });
      return;
    }

    const vendorId = String(req.params["vendorId"]);

    const { data: vendor } = await supabaseServer
      .from("vendors")
      .select("id, name, total_amount, amount_paid, outstanding_amount, work_category")
      .eq("id", vendorId)
      .single();

    if (!vendor) {
      res.json({ success: false, error: "Vendor not found" });
      return;
    }

    // 1. Quality — inspection pass rate
    const { data: inspections } = await supabaseServer
      .from("inspections")
      .select("id, result")
      .ilike("activity", `%${(vendor as any).name}%`);

    const inspRows = (inspections ?? []) as any[];
    const inspTotal = inspRows.length;
    const inspPass = inspRows.filter((i) => i.result === "Pass").length;
    const qualityScore = inspTotal > 0 ? Math.round((inspPass / inspTotal) * 30) : 30;

    // 2. Logistics — gate pass delay
    const { data: gatePasses } = await supabaseServer
      .from("gate_passes")
      .select("id, requested_at, exit_time, status")
      .eq("vendor_id", vendorId);

    const gpRows = (gatePasses ?? []) as any[];
    let logisticsScore = 20;
    if (gpRows.length > 0) {
      const completed = gpRows.filter((g) => g.exit_time);
      if (completed.length > 0) {
        const avgDelayHours =
          completed.reduce((sum, g) => {
            const r = new Date(g.requested_at).getTime();
            const exit = new Date(g.exit_time).getTime();
            return sum + Math.max(0, (exit - r) / (1000 * 60 * 60));
          }, 0) / completed.length;
        logisticsScore = Math.round(Math.max(0, 20 - (avgDelayHours / 72) * 20));
      }
    }

    // 3. Financial reliability
    const totalAmount = Number((vendor as any).total_amount ?? 0);
    const amountPaid = Number((vendor as any).amount_paid ?? 0);
    const outstanding = Number((vendor as any).outstanding_amount ?? 0);
    const financialScore = totalAmount > 0 ? Math.round((amountPaid / totalAmount) * 20) : 20;

    // 4. Safety
    const { data: safetyIncidents } = await supabaseServer
      .from("safety_incidents")
      .select("id, severity, type")
      .ilike("contractor_name", `%${(vendor as any).name}%`);

    const safetyRows = (safetyIncidents ?? []) as any[];
    const safetyPenalty = safetyRows.reduce((sum, r) => {
      const weightMap: Record<string, number> = { Low: 2, Medium: 5, High: 10, Critical: 15 };
      return sum + (weightMap[r.severity] ?? 5);
    }, 0);
    const safetyScore = Math.max(0, 15 - safetyPenalty);

    // 5. Punch items
    const { data: punchItems } = await supabaseServer
      .from("punch_items")
      .select("id, status")
      .eq("assigned_vendor_id", vendorId);

    const punchRows = (punchItems ?? []) as any[];
    const punchTotal = punchRows.length;
    const punchResolved = punchRows.filter(
      (p) => p.status === "Resolved" || p.status === "Verified",
    ).length;
    const punchScore = punchTotal > 0 ? Math.round((punchResolved / punchTotal) * 15) : 15;

    const totalScore = qualityScore + logisticsScore + financialScore + safetyScore + punchScore;

    const breakdown = {
      quality: {
        score: qualityScore, max: 30, label: "Inspection pass rate",
        detail: { total_inspections: inspTotal, passed: inspPass, pass_rate: inspTotal > 0 ? Math.round((inspPass / inspTotal) * 100) : 100 },
      },
      logistics: {
        score: logisticsScore, max: 20, label: "Gate pass turnaround",
        detail: { total_gate_passes: gpRows.length, completed: gpRows.filter((g) => g.exit_time).length },
      },
      financial: {
        score: financialScore, max: 20, label: "Payment reliability",
        detail: { total_amount: totalAmount, amount_paid: amountPaid, outstanding, payment_ratio: totalAmount > 0 ? Math.round((amountPaid / totalAmount) * 100) : 100 },
      },
      safety: {
        score: safetyScore, max: 15, label: "Safety record",
        detail: { total_incidents: safetyRows.length, incidents: safetyRows.filter((r) => r.type === "Incident").length, near_miss: safetyRows.filter((r) => r.type === "Near-miss").length },
      },
      punch: {
        score: punchScore, max: 15, label: "Punch item resolution",
        detail: { total_items: punchTotal, resolved: punchResolved, resolution_rate: punchTotal > 0 ? Math.round((punchResolved / punchTotal) * 100) : 100 },
      },
    };

    await logAction(user, "view_vendor_scorecard", "vendors", vendorId, {
      vendor_name: (vendor as any).name,
      total_score: totalScore,
    });

    res.json({
      vendor_id: vendorId,
      vendor_name: (vendor as any).name,
      work_category: (vendor as any).work_category,
      total_score: Math.min(100, totalScore),
      grade:
        totalScore >= 90 ? "A" : totalScore >= 75 ? "B" : totalScore >= 60 ? "C" : totalScore >= 40 ? "D" : "F",
      breakdown,
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Forbidden")) {
      res.status(403).json({ success: false, error: err.message });
      return;
    }
    console.error("getVendorScorecard error:", err);
    res.status(500).json({ success: false, error: "Failed to get vendor scorecard" });
  }
});
