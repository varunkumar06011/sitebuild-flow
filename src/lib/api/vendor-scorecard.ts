import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseServer } from "../supabase-server";
import { requireSessionUser } from "./session";
import { logAction } from "./audit";
import type { Role } from "../erp-data";

const ADMIN_ROLES: Role[] = ["Administrator", "A1", "A1+"];
function isAdmin(role: Role): boolean {
  return ADMIN_ROLES.includes(role);
}

// ---------------------------------------------------------------------------
// getVendorScorecard — computed 0-100 score from existing data:
//   1. Inspection pass rate (quality) — weight 30
//   2. Gate pass OTP delay (logistics) — weight 20
//   3. Payment/outstanding ratio (financial reliability) — weight 20
//   4. Safety incidents by contractor name — weight 15
//   5. Punch items assigned & resolved — weight 15
// Admin-only.
// ---------------------------------------------------------------------------
export const getVendorScorecard = createServerFn({ method: "GET" })
  .validator((input: { vendorId: string }) => input)
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    if (!isAdmin(user.role)) {
      return { success: false, error: "Only administrators can view vendor scorecards" };
    }

    const { data: vendor } = await supabaseServer
      .from("vendors")
      .select("id, name, total_amount, amount_paid, outstanding_amount, work_category")
      .eq("id", data.vendorId)
      .single();

    if (!vendor) {
      return { success: false, error: "Vendor not found" };
    }

    // 1. Quality — inspection pass rate
    // Inspections don't have a vendor_id column, so we match by inspector name
    // or activity containing the vendor name (best-effort heuristic).
    const { data: inspections } = await supabaseServer
      .from("inspections")
      .select("id, result")
      .ilike("activity", `%${(vendor as any).name}%`);

    const inspRows = (inspections ?? []) as any[];
    const inspTotal = inspRows.length;
    const inspPass = inspRows.filter((i) => i.result === "Pass").length;
    const qualityScore = inspTotal > 0 ? Math.round((inspPass / inspTotal) * 30) : 30;

    // 2. Logistics — gate pass delay (lower delay = higher score)
    const { data: gatePasses } = await supabaseServer
      .from("gate_passes")
      .select("id, requested_at, exit_time, status")
      .eq("vendor_id", data.vendorId);

    const gpRows = (gatePasses ?? []) as any[];
    let logisticsScore = 20; // full score if no gate passes
    if (gpRows.length > 0) {
      const completed = gpRows.filter((g) => g.exit_time);
      if (completed.length > 0) {
        const avgDelayHours =
          completed.reduce((sum, g) => {
            const req = new Date(g.requested_at).getTime();
            const exit = new Date(g.exit_time).getTime();
            return sum + Math.max(0, (exit - req) / (1000 * 60 * 60));
          }, 0) / completed.length;

        // Score scales: 0h = 20pts, 24h = 10pts, 72h+ = 0pts
        logisticsScore = Math.round(Math.max(0, 20 - (avgDelayHours / 72) * 20));
      }
    }

    // 3. Financial reliability — payment ratio
    const totalAmount = Number((vendor as any).total_amount ?? 0);
    const amountPaid = Number((vendor as any).amount_paid ?? 0);
    const outstanding = Number((vendor as any).outstanding_amount ?? 0);
    const financialScore = totalAmount > 0 ? Math.round((amountPaid / totalAmount) * 20) : 20;

    // 4. Safety — incidents by contractor name
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

    // 5. Punch items — resolution rate
    const { data: punchItems } = await supabaseServer
      .from("punch_items")
      .select("id, status")
      .eq("assigned_vendor_id", data.vendorId);

    const punchRows = (punchItems ?? []) as any[];
    const punchTotal = punchRows.length;
    const punchResolved = punchRows.filter(
      (p) => p.status === "Resolved" || p.status === "Verified",
    ).length;
    const punchScore = punchTotal > 0 ? Math.round((punchResolved / punchTotal) * 15) : 15;

    const totalScore = qualityScore + logisticsScore + financialScore + safetyScore + punchScore;

    const breakdown = {
      quality: {
        score: qualityScore,
        max: 30,
        label: "Inspection pass rate",
        detail: {
          total_inspections: inspTotal,
          passed: inspPass,
          pass_rate: inspTotal > 0 ? Math.round((inspPass / inspTotal) * 100) : 100,
        },
      },
      logistics: {
        score: logisticsScore,
        max: 20,
        label: "Gate pass turnaround",
        detail: {
          total_gate_passes: gpRows.length,
          completed: gpRows.filter((g) => g.exit_time).length,
        },
      },
      financial: {
        score: financialScore,
        max: 20,
        label: "Payment reliability",
        detail: {
          total_amount: totalAmount,
          amount_paid: amountPaid,
          outstanding: outstanding,
          payment_ratio: totalAmount > 0 ? Math.round((amountPaid / totalAmount) * 100) : 100,
        },
      },
      safety: {
        score: safetyScore,
        max: 15,
        label: "Safety record",
        detail: {
          total_incidents: safetyRows.length,
          incidents: safetyRows.filter((r) => r.type === "Incident").length,
          near_miss: safetyRows.filter((r) => r.type === "Near-miss").length,
        },
      },
      punch: {
        score: punchScore,
        max: 15,
        label: "Punch item resolution",
        detail: {
          total_items: punchTotal,
          resolved: punchResolved,
          resolution_rate: punchTotal > 0 ? Math.round((punchResolved / punchTotal) * 100) : 100,
        },
      },
    };

    await logAction(user, "view_vendor_scorecard", "vendors", data.vendorId, {
      vendor_name: (vendor as any).name,
      total_score: totalScore,
    });

    return {
      vendor_id: data.vendorId,
      vendor_name: (vendor as any).name,
      work_category: (vendor as any).work_category,
      total_score: Math.min(100, totalScore),
      grade:
        totalScore >= 90
          ? "A"
          : totalScore >= 75
            ? "B"
            : totalScore >= 60
              ? "C"
              : totalScore >= 40
                ? "D"
                : "F",
      breakdown,
    };
  });
