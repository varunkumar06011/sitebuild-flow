// Client Portal API — read-only project visibility for the hospital client/consultant.
// All functions require a client portal account and return aggregated, read-only data.
import { createServerFn } from "@tanstack/react-start";
import { supabaseServer } from "../supabase-server";
import { requireClientAccount } from "./portal-auth";
import { logAction } from "./audit";
import type { SessionUser } from "./session";

// Builds a pseudo SessionUser from a portal account for audit logging.
function clientAuditUser(account: any): SessionUser {
  return { id: account.id, name: account.name, role: "client" as any, phone: account.phone };
}

// Fetches the project overview dashboard for the client.
export const fetchClientDashboard = createServerFn({ method: "GET" })
  .validator((input: Record<string, never>) => input)
  .handler(async () => {
    const account = await requireClientAccount();

    // Audit log the portal access
    await logAction(
      clientAuditUser(account),
      "client_portal_access",
      "portal_account",
      account.id,
      {},
    );

    // Procurement summary
    const { data: requisitions } = await supabaseServer
      .from("requisitions")
      .select("id, stage, amount");
    const totalPRs = (requisitions ?? []).length;
    const completedPRs = (requisitions ?? []).filter((r: any) => r.stage === "Completed").length;
    const totalProcured = (requisitions ?? []).reduce(
      (s: number, r: any) => s + (r.amount ?? 0),
      0,
    );

    // Vendor summary
    const { data: vendors } = await supabaseServer
      .from("vendors")
      .select("id, total_amount, amount_paid, outstanding_amount, status");
    const totalCommitted = (vendors ?? []).reduce(
      (s: number, v: any) => s + (v.total_amount ?? 0),
      0,
    );
    const totalPaid = (vendors ?? []).reduce((s: number, v: any) => s + (v.amount_paid ?? 0), 0);
    const activeVendors = (vendors ?? []).filter((v: any) => v.status === "Active").length;

    // Quality summary
    const { data: inspections } = await supabaseServer.from("inspections").select("id, result");
    const totalInspections = (inspections ?? []).length;
    const qcPass = (inspections ?? []).filter((i: any) => i.result === "Pass").length;
    const qcPassRate = totalInspections > 0 ? Math.round((qcPass / totalInspections) * 100) : 0;

    // Gate pass summary
    const { data: gatePasses } = await supabaseServer.from("gate_passes").select("id, status");
    const totalGatePasses = (gatePasses ?? []).length;
    const gpExited = (gatePasses ?? []).filter((g: any) => g.status === "Exited").length;

    // Budget summary
    const { data: budgets } = await supabaseServer
      .from("budgets")
      .select("id, budget_amount, actual_amount")
      .gt("budget_amount", 0);
    const totalBudget = (budgets ?? []).reduce(
      (s: number, b: any) => s + (b.budget_amount ?? 0),
      0,
    );
    const totalActual = (budgets ?? []).reduce(
      (s: number, b: any) => s + (b.actual_amount ?? 0),
      0,
    );
    const budgetUtilization = totalBudget > 0 ? Math.round((totalActual / totalBudget) * 100) : 0;

    // Progress summary (from progress cells)
    const { data: cells } = await supabaseServer
      .from("progress_cells")
      .select("id, status, completion_pct");
    const totalCells = (cells ?? []).length;
    const completedCells = (cells ?? []).filter((c: any) => c.status === "completed").length;
    const overallProgress =
      totalCells > 0
        ? Math.round(
            (cells ?? []).reduce((s: number, c: any) => s + Number(c.completion_pct ?? 0), 0) /
              totalCells,
          )
        : 0;

    // Material traceability
    const { data: batches } = await supabaseServer.from("batches").select("id, status");
    const totalBatches = (batches ?? []).length;
    const verifiedBatches = (batches ?? []).filter((b: any) => b.status === "Verified").length;

    return {
      data: {
        procurement: {
          total_prs: totalPRs,
          completed_prs: completedPRs,
          total_procured: totalProcured,
        },
        finance: {
          total_committed: totalCommitted,
          total_paid: totalPaid,
          outstanding: totalCommitted - totalPaid,
          active_vendors: activeVendors,
        },
        quality: {
          total_inspections: totalInspections,
          pass_rate: qcPassRate,
          passed: qcPass,
        },
        gate_pass: {
          total: totalGatePasses,
          exited: gpExited,
        },
        budget: {
          total_budget: totalBudget,
          total_actual: totalActual,
          utilization_pct: budgetUtilization,
        },
        progress: {
          total_cells: totalCells,
          completed_cells: completedCells,
          overall_progress_pct: overallProgress,
        },
        traceability: {
          total_batches: totalBatches,
          verified_batches: verifiedBatches,
        },
      },
    };
  });

// Fetches block-level progress for the client (read-only).
export const fetchClientProgress = createServerFn({ method: "GET" })
  .validator((input: Record<string, never>) => input)
  .handler(async () => {
    await requireClientAccount();

    const { data: groups } = await supabaseServer
      .from("progress_cell_groups")
      .select(
        `
        id,
        block_id,
        cell_count,
        progress_blocks!inner(name),
        progress_floors!inner(name),
        progress_work_items!inner(name, progress_categories!inner(name))
      `,
      )
      .order("id");

    if (!groups || groups.length === 0) return { data: [] };

    const groupIds = groups.map((g: any) => g.id);
    const { data: cells } = await supabaseServer
      .from("progress_cells")
      .select("id, cell_group_id, status, completion_pct")
      .in("cell_group_id", groupIds);

    const groupMap = new Map(groups.map((g: any) => [g.id, g]));

    const blockAgg = new Map<
      string,
      {
        name: string;
        total: number;
        completed: number;
        inProgress: number;
        notStarted: number;
        onHold: number;
        avgPct: number;
        count: number;
      }
    >();

    for (const c of cells ?? []) {
      const g = groupMap.get(c.cell_group_id);
      if (!g) continue;
      const blockName = g.progress_blocks?.name ?? "Unknown";
      const key = g.block_id;

      if (!blockAgg.has(key)) {
        blockAgg.set(key, {
          name: blockName,
          total: 0,
          completed: 0,
          inProgress: 0,
          notStarted: 0,
          onHold: 0,
          avgPct: 0,
          count: 0,
        });
      }
      const agg = blockAgg.get(key)!;
      agg.total++;
      agg.count++;
      agg.avgPct += Number(c.completion_pct);
      if (c.status === "completed") agg.completed++;
      else if (c.status === "in_progress") agg.inProgress++;
      else if (c.status === "not_started") agg.notStarted++;
      else if (c.status === "on_hold") agg.onHold++;
    }

    const blocks = Array.from(blockAgg.values()).map((b) => ({
      ...b,
      avgPct: b.count > 0 ? Math.round(b.avgPct / b.count) : 0,
    }));

    return { data: blocks };
  });

// Fetches budget vs actual by block for the client.
export const fetchClientBudget = createServerFn({ method: "GET" })
  .validator((input: Record<string, never>) => input)
  .handler(async () => {
    await requireClientAccount();

    const { data: budgets } = await supabaseServer
      .from("budgets")
      .select("id, block, category, budget_amount, committed_amount, actual_amount")
      .order("block", { ascending: true });

    return { data: budgets ?? [] };
  });

// Fetches QC pass rate trend for the client.
export const fetchClientQuality = createServerFn({ method: "GET" })
  .validator((input: Record<string, never>) => input)
  .handler(async () => {
    await requireClientAccount();

    const { data: inspections } = await supabaseServer
      .from("inspections")
      .select("id, result, inspection_date, material")
      .order("inspection_date", { ascending: false });

    return { data: inspections ?? [] };
  });

// Fetches gate pass summary for the client.
export const fetchClientGatePass = createServerFn({ method: "GET" })
  .validator((input: Record<string, never>) => input)
  .handler(async () => {
    await requireClientAccount();

    const { data: gatePasses } = await supabaseServer
      .from("gate_passes")
      .select("id, gp_number, material, status, created_at")
      .order("created_at", { ascending: false })
      .limit(100);

    return { data: gatePasses ?? [] };
  });
