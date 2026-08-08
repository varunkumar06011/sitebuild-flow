// AI-powered anomaly detection — analyzes existing data to flag suspicious patterns.
// All detection runs on-demand and stores results in anomaly_flags for review.
import { createServerFn } from "@tanstack/react-start";
import { supabaseServer } from "../supabase-server";
import { requireSessionUser, type SessionUser } from "./session";
import { logAction } from "./audit";

type AnomalyResult = {
  anomaly_type: "high_quotation" | "duplicate_invoice" | "gate_pass_anomaly" | "budget_overrun";
  entity_id: string | null;
  entity_type: string | null;
  severity: "low" | "medium" | "high";
  title: string;
  description: string;
  metadata: Record<string, any>;
};

// ============================================================================
// Detection: High Quotations
// Flags quotations that are 20%+ above the historical average for the same material/title.
// ============================================================================
async function detectHighQuotations(): Promise<AnomalyResult[]> {
  const { data: requisitions } = await supabaseServer
    .from("requisitions")
    .select("id, pr_number, title, amount, quotations, vendor_id, date")
    .not("quotations", "eq", "[]");

  if (!requisitions || requisitions.length === 0) return [];

  // Group by title to compute historical averages
  const byTitle: Record<string, number[]> = {};
  for (const r of requisitions) {
    const quotes = Array.isArray(r.quotations) ? r.quotations : [];
    for (const q of quotes) {
      const amt = Number(q.amount ?? 0);
      if (amt > 0) {
        const key = r.title ?? "Unknown";
        if (!byTitle[key]) byTitle[key] = [];
        byTitle[key].push(amt);
      }
    }
  }

  // Compute averages
  const averages: Record<string, { avg: number; count: number }> = {};
  for (const [title, amounts] of Object.entries(byTitle)) {
    if (amounts.length >= 2) {
      averages[title] = {
        avg: amounts.reduce((s, a) => s + a, 0) / amounts.length,
        count: amounts.length,
      };
    }
  }

  const anomalies: AnomalyResult[] = [];
  for (const r of requisitions) {
    const quotes = Array.isArray(r.quotations) ? r.quotations : [];
    const avg = averages[r.title ?? ""];
    if (!avg || avg.count < 2) continue;

    for (const q of quotes) {
      const amt = Number(q.amount ?? 0);
      if (amt === 0) continue;
      const pctAbove = ((amt - avg.avg) / avg.avg) * 100;
      if (pctAbove >= 20) {
        const severity = pctAbove >= 50 ? "high" : pctAbove >= 35 ? "medium" : "low";
        anomalies.push({
          anomaly_type: "high_quotation",
          entity_id: r.id,
          entity_type: "requisition",
          severity,
          title: `High quotation on ${r.pr_number}`,
          description: `Quotation of ₹${amt.toLocaleString("en-IN")} for "${r.title}" is ${pctAbove.toFixed(0)}% above the historical average of ₹${avg.avg.toLocaleString("en-IN", { maximumFractionDigits: 0 })}.`,
          metadata: {
            pr_number: r.pr_number,
            title: r.title,
            quotation_amount: amt,
            historical_avg: Math.round(avg.avg),
            pct_above: Math.round(pctAbove),
            vendor: q.vendor ?? "Unknown",
          },
        });
      }
    }
  }

  return anomalies;
}

// ============================================================================
// Detection: Duplicate Invoices
// Flags requisitions with the same invoice_number + similar amounts from the same vendor.
// ============================================================================
async function detectDuplicateInvoices(): Promise<AnomalyResult[]> {
  const { data: requisitions } = await supabaseServer
    .from("requisitions")
    .select("id, pr_number, title, vendor_id, invoice_number, invoice_amount, invoice_date, amount")
    .not("invoice_number", "is", null);

  if (!requisitions || requisitions.length === 0) return [];

  // Group by invoice_number
  const byInvoice: Record<string, typeof requisitions> = {};
  for (const r of requisitions) {
    const key = r.invoice_number ?? "";
    if (!key) continue;
    if (!byInvoice[key]) byInvoice[key] = [];
    byInvoice[key].push(r);
  }

  const anomalies: AnomalyResult[] = [];
  for (const [invoiceNum, reqs] of Object.entries(byInvoice)) {
    if (reqs.length < 2) continue;

    // Check for same vendor + similar amounts (within 5%)
    for (let i = 0; i < reqs.length; i++) {
      for (let j = i + 1; j < reqs.length; j++) {
        const a = reqs[i]!;
        const b = reqs[j]!;
        const sameVendor = a.vendor_id === b.vendor_id;
        const amtA = Number(a.invoice_amount ?? a.amount ?? 0);
        const amtB = Number(b.invoice_amount ?? b.amount ?? 0);
        const amountDiff = Math.abs(amtA - amtB);
        const pctDiff = amtA > 0 ? (amountDiff / amtA) * 100 : 100;

        if (sameVendor && pctDiff <= 5) {
          const severity = pctDiff <= 1 ? "high" : pctDiff <= 3 ? "medium" : "low";
          anomalies.push({
            anomaly_type: "duplicate_invoice",
            entity_id: a.id,
            entity_type: "requisition",
            severity,
            title: `Possible duplicate invoice: ${invoiceNum}`,
            description: `Invoice ${invoiceNum} appears on ${a.pr_number} (₹${amtA.toLocaleString("en-IN")}) and ${b.pr_number} (₹${amtB.toLocaleString("en-IN")}) from the same vendor. Amount difference: ${pctDiff.toFixed(1)}%.`,
            metadata: {
              invoice_number: invoiceNum,
              pr_a: a.pr_number,
              pr_b: b.pr_number,
              amount_a: amtA,
              amount_b: amtB,
              pct_diff: Math.round(pctDiff * 10) / 10,
              vendor_id: a.vendor_id,
            },
          });
        }
      }
    }
  }

  return anomalies;
}

// ============================================================================
// Detection: Gate Pass Anomalies
// Flags material exiting without a matching entry, or unusual patterns.
// ============================================================================
async function detectGatePassAnomalies(): Promise<AnomalyResult[]> {
  const { data: gatePasses } = await supabaseServer
    .from("gate_passes")
    .select("id, gp_number, material, quantity, status, gate_type, created_at, requisition_id")
    .order("created_at", { ascending: false })
    .limit(200);

  if (!gatePasses || gatePasses.length === 0) return [];

  const anomalies: AnomalyResult[] = [];

  // Check for "Exit" gate passes without a matching "Entry" for the same material
  const entries = gatePasses.filter((g: any) => g.gate_type === "Entry" || g.status === "Entered");
  const exits = gatePasses.filter(
    (g: any) => g.gate_type === "Exit" || g.status === "Exited" || g.status === "Awaiting OTP",
  );

  for (const exit of exits) {
    const matchingEntry = entries.find(
      (e: any) =>
        e.material?.toLowerCase() === exit.material?.toLowerCase() &&
        new Date(e.created_at).getTime() < new Date(exit.created_at).getTime(),
    );

    if (!matchingEntry && exit.requisition_id) {
      anomalies.push({
        anomaly_type: "gate_pass_anomaly",
        entity_id: exit.id,
        entity_type: "gate_pass",
        severity: "high",
        title: `Exit without matching entry: ${exit.gp_number}`,
        description: `Gate pass ${exit.gp_number} for "${exit.material}" has an exit record but no corresponding entry record was found. This may indicate material leaving site without proper receipt.`,
        metadata: {
          gp_number: exit.gp_number,
          material: exit.material,
          quantity: exit.quantity,
          status: exit.status,
        },
      });
    }
  }

  // Check for unusual volume: more than 10 gate passes in a single day from the same vendor
  const byDateVendor: Record<string, number> = {};
  for (const gp of gatePasses) {
    const date = new Date(gp.created_at).toISOString().slice(0, 10);
    const key = `${date}`;
    byDateVendor[key] = (byDateVendor[key] ?? 0) + 1;
  }

  for (const [date, count] of Object.entries(byDateVendor)) {
    if (count > 10) {
      anomalies.push({
        anomaly_type: "gate_pass_anomaly",
        entity_id: null,
        entity_type: "gate_pass",
        severity: "medium",
        title: `Unusual gate pass volume on ${date}`,
        description: `${count} gate passes were created on ${date}. The daily average is typically much lower. This may indicate unusual activity.`,
        metadata: { date, count },
      });
    }
  }

  return anomalies;
}

// ============================================================================
// Detection: Budget Overrun Prediction
// Predicts budget overrun based on burn rate vs. budget.
// ============================================================================
async function detectBudgetOverrun(): Promise<AnomalyResult[]> {
  const { data: budgets } = await supabaseServer
    .from("budgets")
    .select("id, block, category, budget_amount, committed_amount, actual_amount")
    .gt("budget_amount", 0);

  if (!budgets || budgets.length === 0) return [];

  const anomalies: AnomalyResult[] = [];
  for (const b of budgets) {
    const budget = Number(b.budget_amount ?? 0);
    const actual = Number(b.actual_amount ?? 0);
    const committed = Number(b.committed_amount ?? 0);
    const utilization = budget > 0 ? (actual / budget) * 100 : 0;
    const committedUtil = budget > 0 ? (committed / budget) * 100 : 0;

    if (utilization > 100) {
      anomalies.push({
        anomaly_type: "budget_overrun",
        entity_id: b.id,
        entity_type: "budget",
        severity: "high",
        title: `Budget overrun: ${b.block} — ${b.category}`,
        description: `${b.block} / ${b.category} has exceeded its budget. Budget: ₹${budget.toLocaleString("en-IN")}, Actual: ₹${actual.toLocaleString("en-IN")} (${utilization.toFixed(0)}% utilization).`,
        metadata: {
          block: b.block,
          category: b.category,
          budget_amount: budget,
          actual_amount: actual,
          committed_amount: committed,
          utilization_pct: Math.round(utilization),
        },
      });
    } else if (committedUtil > 90 && committedUtil <= 100) {
      anomalies.push({
        anomaly_type: "budget_overrun",
        entity_id: b.id,
        entity_type: "budget",
        severity: "medium",
        title: `Budget at risk: ${b.block} — ${b.category}`,
        description: `${b.block} / ${b.category} is at ${committedUtil.toFixed(0)}% committed utilization. Committed: ₹${committed.toLocaleString("en-IN")} of budget ₹${budget.toLocaleString("en-IN")}. Overrun likely if all commitments are invoiced.`,
        metadata: {
          block: b.block,
          category: b.category,
          budget_amount: budget,
          committed_amount: committed,
          actual_amount: actual,
          committed_util_pct: Math.round(committedUtil),
        },
      });
    }
  }

  return anomalies;
}

// ============================================================================
// Main: Run all detections and store results
// ============================================================================
export const runAnomalyDetection = createServerFn({ method: "POST" })
  .validator((input: {}) => input)
  .handler(async () => {
    const user = await requireSessionUser();

    const [highQuotes, dupInvoices, gpAnomalies, budgetOverruns] = await Promise.all([
      detectHighQuotations(),
      detectDuplicateInvoices(),
      detectGatePassAnomalies(),
      detectBudgetOverrun(),
    ]);

    const allAnomalies = [...highQuotes, ...dupInvoices, ...gpAnomalies, ...budgetOverruns];

    // Clear previous undismissed anomalies and insert new ones
    await supabaseServer.from("anomaly_flags").delete().eq("dismissed", false);

    if (allAnomalies.length > 0) {
      const rows = allAnomalies.map((a) => ({
        anomaly_type: a.anomaly_type,
        entity_id: a.entity_id,
        entity_type: a.entity_type,
        severity: a.severity,
        title: a.title,
        description: a.description,
        metadata: a.metadata,
      }));
      await supabaseServer.from("anomaly_flags").insert(rows);
    }

    await logAction(
      user,
      "run_anomaly_detection",
      "system",
      "00000000-0000-0000-0000-000000000000",
      {
        total_detected: allAnomalies.length,
        high: allAnomalies.filter((a) => a.severity === "high").length,
        medium: allAnomalies.filter((a) => a.severity === "medium").length,
        low: allAnomalies.filter((a) => a.severity === "low").length,
      },
    );

    return {
      success: true,
      total: allAnomalies.length,
      by_type: {
        high_quotation: highQuotes.length,
        duplicate_invoice: dupInvoices.length,
        gate_pass_anomaly: gpAnomalies.length,
        budget_overrun: budgetOverruns.length,
      },
      by_severity: {
        high: allAnomalies.filter((a) => a.severity === "high").length,
        medium: allAnomalies.filter((a) => a.severity === "medium").length,
        low: allAnomalies.filter((a) => a.severity === "low").length,
      },
    };
  });

// Fetches all anomaly flags (optionally filtered by dismissed status).
export const fetchAnomalies = createServerFn({ method: "GET" })
  .validator((input: { dismissed?: boolean; type?: string; severity?: string }) => input)
  .handler(async ({ data }) => {
    await requireSessionUser();

    let query = supabaseServer
      .from("anomaly_flags")
      .select(
        "id, anomaly_type, entity_id, entity_type, severity, title, description, metadata, detected_at, dismissed, dismissed_at",
      )
      .order("detected_at", { ascending: false });

    if (data.dismissed !== undefined) query = query.eq("dismissed", data.dismissed);
    if (data.type) query = query.eq("anomaly_type", data.type);
    if (data.severity) query = query.eq("severity", data.severity);

    const { data: anomalies, error } = await query;
    if (error) return { data: [], error: error.message };
    return { data: anomalies ?? [] };
  });

// Dismisses an anomaly flag.
export const dismissAnomaly = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const user = await requireSessionUser();

    const { error } = await supabaseServer
      .from("anomaly_flags")
      .update({ dismissed: true, dismissed_by: user.id, dismissed_at: new Date().toISOString() })
      .eq("id", data.id);

    if (error) return { success: false, error: "Failed to dismiss anomaly" };

    await logAction(user, "dismiss_anomaly", "anomaly_flags", data.id, {});
    return { success: true };
  });
